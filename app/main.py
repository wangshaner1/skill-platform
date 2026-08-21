import json
import logging
import re
import time
import uuid
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .audit import log_action
from .cache import cache_skill, get_cached_skill
from .clarifier import clarify_requirement
from .config import settings
from .data_quality import check_data_quality
from .llm_client import chat_completion_stream
from .sample_data import SAMPLE_INPUT, SAMPLE_REQUIREMENT
from .schemas import SkillConfig
from .skill_executor import build_execution_context, execute_skill, validate_input_data
from .skill_generator import SYSTEM_PROMPT, _extract_json, generate_skill
from .skill_validation import validate_skill
from .store import SkillStore
from .stats import incr, snapshot
from .tasks import (
    create_task,
    get_progress_state,
    get_task,
    recover_stale_tasks,
    start_task,
)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("skill-platform")


app = FastAPI(title="DataAgent Skill 平台")
store = SkillStore()
SAMPLE_CACHE_FILE = settings.data_dir / "sample_data_cache.json"
recover_stale_tasks()


@app.middleware("http")
async def log_requests(request, call_next):
    start = time.time()
    response = await call_next(request)
    logger.info(
        "%s %s -> %s (%.0fms)",
        request.method,
        request.url.path,
        response.status_code,
        (time.time() - start) * 1000,
    )
    return response


class GenerateRequest(BaseModel):
    requirement: str = Field(..., min_length=1, max_length=500)


class ExecuteRequest(BaseModel):
    input_data: dict


class ImportRequest(BaseModel):
    content: str = Field(..., max_length=200000)


class SampleGenerateRequest(BaseModel):
    skill_id: str = Field(..., min_length=1, max_length=64)


class TaskRequest(BaseModel):
    kind: str = Field(..., pattern="^(generate|execute)$")
    requirement: str = Field(default="", max_length=500)
    skill_id: str = Field(default="", max_length=64)
    input_data: dict = None


def sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/stats")
def api_stats():
    stats = snapshot()
    hits = stats.get("cache_hits", 0)
    misses = stats.get("cache_misses", 0)
    total = hits + misses
    stats["cache_hit_rate"] = round(hits / total * 100, 2) if total else 0
    return stats


@app.post("/api/tasks")
def api_create_task(req: TaskRequest):
    if req.kind == "generate" and not req.requirement.strip():
        raise HTTPException(status_code=400, detail="生成任务缺少需求")
    if req.kind == "execute" and not req.skill_id:
        raise HTTPException(status_code=400, detail="执行任务缺少 Skill ID")
    task = create_task(
        req.kind,
        requirement=req.requirement,
        skill_id=req.skill_id,
        input_data=req.input_data,
    )
    start_task(task["id"])
    return get_task(task["id"])


@app.get("/api/tasks/{task_id}")
def api_get_task(task_id: str):
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


@app.get("/api/tasks/{task_id}/stream")
def api_task_stream(task_id: str):
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    def gen():
        offset = 0
        last_ping = time.time()
        try:
            while True:
                current = get_task(task_id)
                state = (
                    get_progress_state(task_id)
                    if current and current["status"] == "running"
                    else None
                )
                progress = (
                    state["progress"]
                    if state is not None
                    else (current.get("progress") or "")
                )
                if len(progress) > offset:
                    yield sse({"type": "delta", "content": progress[offset:]})
                    offset = len(progress)

                status = current["status"] if current else "failed"
                if status == "done":
                    payload = current["result"] or {}
                    yield sse({"type": "result", "kind": current["kind"], **payload})
                    return
                if status == "failed":
                    yield sse({"type": "error", "message": current.get("error") or "任务失败"})
                    return

                if time.time() - last_ping >= 15:
                    yield ": ping\n\n"
                    last_ping = time.time()
                time.sleep(0.5)
        except GeneratorExit:
            return

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/api/skills/generate")
def api_generate(req: GenerateRequest):
    incr("generate_calls")
    try:
        result = generate_skill(req.requirement, store=store)
        log_action("generate", requirement=req.requirement, skill_id=result.get("id"))
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/clarify")
def api_clarify(req: GenerateRequest):
    incr("clarify_calls")
    return clarify_requirement(req.requirement)


@app.post("/api/skills/generate/stream")
def api_generate_stream(req: GenerateRequest):
    incr("generate_calls")
    cached = get_cached_skill(req.requirement)
    if cached:
        def gen_cached():
            log_action("generate", requirement=req.requirement, skill_id=cached.get("id"), cached=True)
            yield sse({"type": "result", "skill": cached, "cached": True})

        return StreamingResponse(gen_cached(), media_type="text/event-stream")

    def gen():
        try:
            messages = [{"role": "system", "content": SYSTEM_PROMPT}]
            messages.append({"role": "user", "content": req.requirement})
            parts = []
            for chunk in chat_completion_stream(messages, temperature=0.1, max_tokens=3500):
                parts.append(chunk)
                yield sse({"type": "delta", "content": chunk})

            raw = "".join(parts)
            data = _extract_json(raw)
            skill = SkillConfig.model_validate(data)
            skill.id = uuid.uuid4().hex[:12]
            skill.version = "v1"
            skill.created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            skill.requirement = req.requirement
            result = skill.model_dump()
            validation = validate_skill(req.requirement, result)
            if not validation["passed"]:
                raise ValueError("语义校验未通过：" + "；".join(validation["issues"]))
            cache_skill(req.requirement, result)
            store.save(result)
            log_action("generate", requirement=req.requirement, skill_id=result.get("id"), cached=False)
            yield sse(
                {
                    "type": "result",
                    "skill": result,
                    "cached": False,
                    "validation": validation,
                }
            )
        except Exception as exc:
            yield sse({"type": "error", "message": str(exc)})

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/api/skills/import")
def api_import_skill(req: ImportRequest):
    """导入导出的 Skill：支持直接粘贴 JSON，或包含 ```json 代码块的 Markdown。"""
    try:
        incr("import_calls")
        text = req.content.strip()
        data = None
        if text.startswith("{"):
            data = json.loads(text)
        else:
            block = re.search(r"```json\s*(\{.*?\})\s*```", text, re.S)
            if block:
                data = json.loads(block.group(1))
            else:
                fallback = re.search(r"\{.*\}", text, re.S)
                if not fallback:
                    raise ValueError("未找到 Skill 配置")
                data = json.loads(fallback.group(0))

        skill = SkillConfig.model_validate(data)
        skill.id = uuid.uuid4().hex[:12]
        skill.version = skill.version or "v1"
        skill.created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        result = skill.model_dump()
        store.save(result)
        log_action("import", skill_id=result.get("id"))
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"导入失败：{exc}")


@app.get("/api/skills")
def api_list():
    return store.list()


@app.get("/api/skills/{skill_id}")
def api_get(skill_id: str):
    skill = store.get(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    return skill


@app.get("/api/skills/{skill_id}/versions")
def api_versions(skill_id: str):
    skill = store.get(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    return store.get_versions(skill_id)


@app.post("/api/skills/{skill_id}/publish")
def api_publish(skill_id: str):
    skill = store.get(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    store.set_status(skill_id, "published")
    updated = store.get(skill_id)
    if updated.get("requirement"):
        cache_skill(updated["requirement"], updated)
    log_action("publish", requirement=updated.get("requirement", ""), skill_id=skill_id)
    return updated


@app.post("/api/skills/{skill_id}/execute")
def api_execute(skill_id: str, req: ExecuteRequest):
    incr("execute_calls")
    skill = store.get(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    missing = validate_input_data(skill, req.input_data)
    if missing:
        raise HTTPException(status_code=400, detail="输入数据缺少必填字段：" + "、".join(missing))
    quality = check_data_quality(skill, req.input_data)
    if quality["errors"]:
        raise HTTPException(status_code=400, detail="输入数据质量不合格：" + "；".join(quality["errors"]))
    try:
        return execute_skill(skill, req.input_data)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/skills/{skill_id}/execute/stream")
def api_execute_stream(skill_id: str, req: ExecuteRequest):
    incr("execute_calls")
    skill = store.get(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    missing = validate_input_data(skill, req.input_data)
    if missing:
        raise HTTPException(status_code=400, detail="输入数据缺少必填字段：" + "、".join(missing))
    quality = check_data_quality(skill, req.input_data)
    if quality["errors"]:
        raise HTTPException(status_code=400, detail="输入数据质量不合格：" + "；".join(quality["errors"]))

    def gen():
        try:
            messages, metrics, _ = build_execution_context(skill, req.input_data)
            yield sse({"type": "quality", "warnings": quality["warnings"]})
            yield sse({"type": "metrics", "metrics": metrics})
            for chunk in chat_completion_stream(messages, temperature=0.3, max_tokens=3500):
                yield sse({"type": "delta", "content": chunk})
            yield sse({"type": "done"})
        except Exception as exc:
            yield sse({"type": "error", "message": str(exc)})

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/api/sample")
def api_sample():
    return {"requirement": SAMPLE_REQUIREMENT, "input_data": SAMPLE_INPUT}


@app.get("/api/sample/by_requirement")
def api_sample_by_requirement(requirement: str):
    if SAMPLE_CACHE_FILE.exists():
        try:
            cache = json.loads(SAMPLE_CACHE_FILE.read_text(encoding="utf-8"))
            if requirement in cache:
                return {"input_data": cache[requirement]}
        except Exception:
            pass
    from .sample_data import get_sample_input

    return {"input_data": get_sample_input(requirement)}


@app.post("/api/sample/generate")
def api_sample_generate(req: SampleGenerateRequest):
    skill = store.get(req.skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")

    # 按 Skill ID 键控示例数据缓存：不同版本的输入定义不同，不能按需求复用
    cache_key = skill["id"]
    cache = {}
    if SAMPLE_CACHE_FILE.exists():
        try:
            cache = json.loads(SAMPLE_CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            cache = {}
    if cache_key in cache:
        return {"input_data": cache[cache_key], "generated": False}

    from .sample_generator import generate_sample_data

    data = generate_sample_data(skill)
    cache[cache_key] = data
    SAMPLE_CACHE_FILE.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"input_data": data, "generated": True}


app.mount("/", StaticFiles(directory=str(settings.static_dir), html=True), name="static")
