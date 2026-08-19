"""按 Skill 的输入数据定义生成一份可直接使用的实例数据。"""

import json

from .llm_client import chat_completion


SYSTEM_PROMPT = """你是数据构造专家。
根据给定 Skill 的输入数据定义，生成一份真实感强、可直接用于分析演示的实例数据。
必须只返回一个 JSON 对象，不要输出 Markdown 代码块、解释或多余文字。
要求：
1. 字段名必须严格对应输入数据定义中的 name，类型必须与 type 一致（string/number/list/object）。
2. 数值要合理且内部自洽：如金额约等于数量×单价、漏斗逐级递减、比率在 0-100% 区间。
3. 业务字段要贴合 Skill 的场景，中文表达，可读性好。
4. list 类型给出 3-4 条子项，object 类型给出 2-4 个键。"""


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


def _fallback_value(field_type):
    if field_type == "number":
        return 0
    if field_type == "list":
        return []
    if field_type == "object":
        return {}
    return "示例值"


def generate_sample_data(skill: dict):
    """生成与 Skill 输入定义匹配的实例数据，缺字段时用默认值兜底。"""
    schema = skill.get("input_schema", [])
    user_prompt = (
        f"Skill 名称：{skill.get('name')}\n"
        f"Skill 描述：{skill.get('description')}\n"
        f"输入数据定义：\n{json.dumps(schema, ensure_ascii=False, indent=2)}\n\n"
        "请只返回符合上述定义的 JSON 实例数据。"
    )
    raw = chat_completion(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.4,
        max_tokens=2500,
    )
    data = _extract_json(raw)
    if not isinstance(data, dict):
        raise RuntimeError("实例数据生成结果不是 JSON 对象")

    for field in schema:
        name = field.get("name")
        if name and name not in data:
            data[name] = _fallback_value(field.get("type", "string"))
    return data

