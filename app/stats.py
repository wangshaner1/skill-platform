"""轻量运行统计：LLM 调用、缓存命中率、各接口调用次数。"""

import threading


_stats = {
    "llm_calls": 0,
    "cache_hits": 0,
    "cache_misses": 0,
    "generate_calls": 0,
    "execute_calls": 0,
    "import_calls": 0,
    "clarify_calls": 0,
}
_lock = threading.Lock()


def incr(key: str, n: int = 1):
    with _lock:
        _stats[key] = _stats.get(key, 0) + n


def snapshot():
    with _lock:
        return dict(_stats)
