import requests
import json

from .config import settings
from .stats import incr


_SESSION = requests.Session()
_SESSION.trust_env = False


def chat_completion(messages, temperature=0.2, max_tokens=4096):
    """调用阿里云百炼 OpenAI 兼容接口。"""
    if not settings.qwen_api_key:
        raise RuntimeError("缺少 QWEN_API_KEY，请在 .env 中配置")

    incr("llm_calls")
    url = settings.qwen_base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.qwen_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.qwen_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    resp = _SESSION.post(url, headers=headers, json=payload, timeout=180)
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def chat_completion_stream(messages, temperature=0.2, max_tokens=4096):
    """流式调用阿里云百炼 OpenAI 兼容接口，逐段 yield 文本。"""
    if not settings.qwen_api_key:
        raise RuntimeError("缺少 QWEN_API_KEY，请在 .env 中配置")

    incr("llm_calls")
    url = settings.qwen_base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.qwen_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.qwen_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }

    with _SESSION.post(url, headers=headers, json=payload, stream=True, timeout=300) as resp:
        if resp.status_code != 200:
            raise RuntimeError(f"LLM 调用失败：{resp.status_code} {resp.text[:800]}")
        for line in resp.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                obj = json.loads(data)
            except json.JSONDecodeError:
                continue
            try:
                delta = obj["choices"][0]["delta"].get("content")
            except (KeyError, IndexError, TypeError):
                delta = None
            if delta:
                yield delta
