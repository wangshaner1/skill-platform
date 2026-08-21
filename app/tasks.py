"""后台任务：生成/执行在独立线程中运行，结果与进度落库，支持断线续跑。"""

import json
import threading
import time
import uuid
from datetime import datetime

from .cache import cache_skill, get_cached_skill
from .config import settings
from .consistency import check_consistency
from .crypto import decrypt_text, encrypt_text
from .data_quality import check_data_quality
from .db import get_conn
from .llm_client import chat_completion_stream
from .schemas import SkillConfig
from .skill_executor import build_execution_context, render_template
from .skill_generator import SYSTEM_PROMPT, _extract_json
from .skill_validation import validate_skill
from .stats import incr
from .store import SkillStore


def _now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


_running = {}
_lock = threading.Lock()


def recover_stale_tasks():
    """服务重启后，把残留的 running 任务标记为失败，前端可提示重试。"""
    with get_conn() as conn:
        conn.execute(
            "UPDATE tasks SET status='failed', error='任务因服务重启而中断，请重试', updated_at=? WHERE status IN ('pending','running')",
            (_now(),),
        )


def create_task(kind, requirement=None, skill_id=None, input_data=None):
    task_id = "t" + uuid.uuid4().hex[:12]
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO tasks (id, kind, requirement, skill_id, input_data, status, progress, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'pending', '', ?, ?)
            """,
            (
                task_id,
                kind,
                requirement,
                skill_id,
                encrypt_text(json.dumps(input_data, ensure_ascii=False))
                if input_data is not None
                else None,
                now,
                now,
            ),
        )
    return get_task(task_id)


def get_task(task_id):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        return None
    task = dict(row)
    task["input_data"] = (
        json.loads(decrypt_text(task["input_data"])) if task["input_data"] else None
    )
    task["result"] = json.loads(task["result"]) if task["result"] else None
    return task


def _update(task_id, **fields):
    with get_conn() as conn:
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(
                f"UPDATE tasks SET {sets}, updated_at = ? WHERE id = ?",
                (*fields.values(), _now(), task_id),
            )
        else:
            conn.execute("UPDATE tasks SET updated_at = ? WHERE id = ?", (_now(), task_id))


def get_progress_state(task_id):
    with _lock:
        state = _running.get(task_id)
        return dict(state) if state else None


def _append_progress(task_id, text):
    with _lock:
        state = _running.get(task_id)
        if state is not None:
            state["progress"] += text


def _flush_progress(task_id):
    state = get_progress_state(task_id)
    if state:
        _update(task_id, progress=state["progress"])


def _run_generate(task_id, requirement):
    cached = get_cached_skill(requirement)
    if cached:
        _append_progress(task_id, cached["name"])
        return {
            "skill": cached,
            "validation": {"passed": True, "issues": [], "score": 100},
            "cached": True,
        }

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": requirement},
    ]
    parts = []
    last_flush = time.time()
    for chunk in chat_completion_stream(messages, temperature=0.1, max_tokens=3500):
        parts.append(chunk)
        _append_progress(task_id, chunk)
        if time.time() - last_flush >= 2:
            _flush_progress(task_id)
            last_flush = time.time()
    _flush_progress(task_id)

    raw = "".join(parts)
    data = _extract_json(raw)
    skill = SkillConfig.model_validate(data)
    skill.id = uuid.uuid4().hex[:12]
    skill.version = "v1"
    skill.created_at = _now()
    skill.requirement = requirement
    skill.model = settings.qwen_model
    result = skill.model_dump()
    validation = validate_skill(requirement, result)
    if not validation["passed"]:
        raise ValueError("语义校验未通过：" + "；".join(validation["issues"]))
    store = SkillStore()
    store.save(result)
    saved = store.get(result["id"]) or result
    cache_skill(requirement, saved)
    incr("generate_calls")
    return {"skill": saved, "validation": validation, "cached": False}


def _run_execute(task_id, skill_id, input_data):
    store = SkillStore()
    skill = store.get(skill_id)
    if not skill:
        raise ValueError("Skill 不存在")
    quality = check_data_quality(skill, input_data)
    if quality["errors"]:
        raise ValueError("输入数据质量不合格：" + "；".join(quality["errors"]))
    messages, metrics, placeholders = build_execution_context(skill, input_data)
    parts = []
    last_flush = time.time()
    for chunk in chat_completion_stream(messages, temperature=0.3, max_tokens=3500):
        parts.append(chunk)
        _append_progress(task_id, chunk)
        if time.time() - last_flush >= 2:
            _flush_progress(task_id)
            last_flush = time.time()
    _flush_progress(task_id)

    raw = "".join(parts)
    result = _extract_json(raw)
    if not isinstance(result, dict):
        raise RuntimeError("执行结果不是 JSON 对象")
    for key in placeholders:
        result.setdefault(key, "（未生成）")
    rendered = render_template(skill["output_template"], result)
    consistency = check_consistency(metrics, rendered)
    incr("execute_calls")
    return {
        "metrics": metrics,
        "markdown": rendered,
        "raw": result,
        "quality": quality,
        "consistency": consistency,
        "model": settings.qwen_model,
    }


def start_task(task_id):
    task = get_task(task_id)
    if not task or task["status"] in ("running", "done"):
        return
    with _lock:
        _running[task_id] = {"progress": task.get("progress") or "", "done": False}
    _update(task_id, status="running")

    def worker():
        try:
            if task["kind"] == "generate":
                payload = _run_generate(task_id, task["requirement"])
            else:
                payload = _run_execute(task_id, task["skill_id"], task["input_data"] or {})
            with _lock:
                state = _running.get(task_id)
                if state:
                    state["done"] = True
            _update(task_id, status="done", result=json.dumps(payload, ensure_ascii=False), error="")
        except Exception as exc:
            with _lock:
                state = _running.get(task_id)
                if state:
                    state["done"] = True
            _update(task_id, status="failed", error=str(exc))

    threading.Thread(target=worker, daemon=True).start()
