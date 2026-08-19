"""生成后语义校验：规则检查 + 需求主题一致性，拦截跑题或残缺的 Skill。"""

import re


DOMAIN_KEYWORDS = [
    "抖音",
    "直播",
    "电商",
    "店铺",
    "销售",
    "客户",
    "用户",
    "增长",
    "零售",
    "门店",
    "复盘",
    "运营",
    "分析",
    "经营",
    "库存",
    "会员",
]

PLACEHOLDER_RE = re.compile(r"\{\{\s*([\w\u4e00-\u9fff]+)\s*\}\}")


def extract_topics(requirement: str):
    return [kw for kw in DOMAIN_KEYWORDS if kw in (requirement or "")]


def rule_checks(skill: dict):
    issues = []
    if not skill.get("name"):
        issues.append("缺少 Skill 名称")
    if not skill.get("description"):
        issues.append("缺少 Skill 描述")
    if not skill.get("use_cases"):
        issues.append("缺少使用场景")
    if not skill.get("input_schema"):
        issues.append("缺少输入数据定义")
    elif len(skill["input_schema"]) < 3:
        issues.append(f"输入字段过少（{len(skill['input_schema'])} 个，建议至少 3 个）")
    if len(skill.get("analysis_steps") or []) < 4:
        issues.append(f"分析流程少于 4 步（当前 {len(skill.get('analysis_steps') or [])} 步）")
    if not skill.get("agent_prompt"):
        issues.append("缺少 Agent Prompt")
    template = skill.get("output_template") or ""
    if not template:
        issues.append("缺少输出结果模板")
    else:
        placeholders = set(PLACEHOLDER_RE.findall(template))
        if len(placeholders) < 5:
            issues.append(f"输出模板占位符不足 5 个（当前 {len(placeholders)} 个）")
    return issues


def validate_skill(requirement: str, skill: dict):
    """返回 {passed, issues, score}。score 满分 100，每项问题扣 20 分。"""
    issues = rule_checks(skill)

    topics = extract_topics(requirement)
    if topics:
        hay = (
            skill.get("name", "")
            + skill.get("description", "")
            + "".join(skill.get("use_cases", []))
        )
        missing = [t for t in topics if t not in hay]
        if missing:
            issues.append(f"内容与需求主题不符（缺少：{'、'.join(missing)}）")

    return {
        "passed": not issues,
        "issues": issues,
        "score": max(0, 100 - len(issues) * 20),
    }
