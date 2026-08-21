"""敏感信息脱敏：手机号、身份证、邮箱、银行卡号在送模型前打码。"""

import re


PHONE_RE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
ID_RE = re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)")
EMAIL_RE = re.compile(r"([\w.+-]+)@([\w-]+\.[\w.-]+)")
BANK_RE = re.compile(r"(?<!\d)\d{16,19}(?!\d)")


def _mask_text(text):
    text = PHONE_RE.sub(lambda m: m.group(0)[:3] + "****" + m.group(0)[-4:], text)
    text = ID_RE.sub(lambda m: m.group(0)[:6] + "********" + m.group(0)[-4:], text)
    text = EMAIL_RE.sub(lambda m: m.group(1)[:1] + "***@" + m.group(2), text)
    text = BANK_RE.sub(lambda m: m.group(0)[:4] + "********" + m.group(0)[-4:], text)
    return text


def mask_sensitive_data(value):
    if isinstance(value, str):
        return _mask_text(value)
    if isinstance(value, list):
        return [mask_sensitive_data(item) for item in value]
    if isinstance(value, dict):
        return {k: mask_sensitive_data(v) for k, v in value.items()}
    return value
