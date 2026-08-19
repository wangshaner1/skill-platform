"""需求澄清：信息不足时向用户追问，减少无效生成。"""

import json

from .llm_client import chat_completion
from .skill_validation import extract_topics


SYSTEM_PROMPT = """你是需求澄清助手。
用户想创建一个企业岗位 Skill，但需求描述可能信息不足。请根据需求提出 1-3 个最关键的业务问题，
用于补充：分析对象、数据来源/统计周期、输出形式或业务口径。
必须只返回一个 JSON 对象：{"questions": ["问题1", "问题2", "问题3"]}
问题要具体、可回答，不要重复需求里已有的信息。不要输出解释或 Markdown。"""


DEFAULT_QUESTIONS = [
    "分析对象是什么（店铺/团队/门店/产品）？",
    "数据来源和统计周期是什么？",
    "输出形式有要求吗（如周报、月报、一页汇报）？",
]


def _extract_json(text: str):
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        return json.loads(text[start : end + 1])


def should_clarify(requirement: str) -> bool:
    """规则预判：已包含明确业务主题且描述完整时不再追问，省一次 LLM 调用。"""
    text = (requirement or "").strip()
    if len(text) < 8:
        return True
    return not extract_topics(text)


def clarify_requirement(requirement: str):
    if not should_clarify(requirement):
        return {"need": False, "questions": []}
    try:
        raw = chat_completion(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": requirement},
            ],
            temperature=0.2,
            max_tokens=600,
        )
        data = _extract_json(raw)
        questions = data.get("questions", [])[:3]
    except Exception:
        questions = list(DEFAULT_QUESTIONS)
    return {"need": bool(questions), "questions": questions}
