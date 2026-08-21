"""输入数据质量门禁：类型、必填、异常值检查。"""


def check_data_quality(skill_dict: dict, input_data: dict):
    schema = skill_dict.get("input_schema") or []
    errors = []
    warnings = []
    for field in schema:
        name = field.get("name")
        ftype = field.get("type")
        if not name:
            continue
        value = input_data.get(name)
        if field.get("required") and (value is None or value == ""):
            errors.append(f"缺少必填字段：{name}")
            continue
        if value is None or value == "":
            continue
        if ftype == "number":
            try:
                num = float(value)
                if num < 0:
                    warnings.append(f"字段「{name}」为负数（{num}），请确认数据是否正常")
            except (TypeError, ValueError):
                errors.append(f"字段「{name}」应为数字，实际为 {type(value).__name__}")
        elif ftype == "list":
            if not isinstance(value, list) or not value:
                warnings.append(f"字段「{name}」的列表为空或格式不正确")
        elif ftype == "object":
            if not isinstance(value, dict):
                errors.append(f"字段「{name}」应为对象，实际为 {type(value).__name__}")
        elif ftype == "string":
            if not isinstance(value, str):
                errors.append(f"字段「{name}」应为文本，实际为 {type(value).__name__}")
    return {"passed": not errors, "errors": errors, "warnings": warnings}
