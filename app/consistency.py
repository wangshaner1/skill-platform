"""结论一致性检查：已计算指标是否真实出现在报告中，防止 LLM 编造/遗漏。"""

import re


NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")


def _numbers_in(text):
    return [float(n) for n in NUMBER_RE.findall(str(text).replace(",", ""))]


def check_consistency(metrics: dict, markdown: str):
    nums = _numbers_in(markdown)
    checked = []
    missing = []
    for key, value in (metrics or {}).items():
        if value is None:
            continue
        try:
            target = round(float(value), 2)
        except (TypeError, ValueError):
            continue
        found = any(abs(round(n, 2) - target) < 0.01 for n in nums)
        item = f"{key}={value}"
        if found:
            checked.append(item)
        else:
            missing.append(item)
    return {
        "passed": not missing,
        "checked": checked,
        "missing": missing,
    }
