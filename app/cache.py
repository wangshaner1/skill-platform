"""Skill 生成结果缓存：相同需求直接返回 Redis 缓存，节约 LLM 调用成本。"""

import hashlib
import json
import logging

import redis

from .config import settings
from .stats import incr


logger = logging.getLogger(__name__)

SKILL_CACHE_TTL = 60 * 60 * 24 * 30  # 默认缓存 30 天

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = redis.Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
    return _client


def normalize_requirement(requirement: str) -> str:
    return " ".join((requirement or "").strip().split())


def _cache_key(requirement: str) -> str:
    digest = hashlib.sha256(normalize_requirement(requirement).encode("utf-8")).hexdigest()
    return f"skill:req:{digest}"


def get_cached_skill(requirement: str):
    """按需求返回缓存的 Skill；Redis 不可用时返回 None。"""
    try:
        raw = _get_client().get(_cache_key(requirement))
        if raw:
            incr("cache_hits")
            return json.loads(raw)
    except Exception as exc:
        logger.warning("Redis 读取失败：%s", exc)
    incr("cache_misses")
    return None


def cache_skill(requirement: str, skill: dict, ttl: int = SKILL_CACHE_TTL) -> bool:
    """把生成的 Skill 写入 Redis；Redis 不可用时静默失败。"""
    try:
        _get_client().set(
            _cache_key(requirement),
            json.dumps(skill, ensure_ascii=False),
            ex=ttl,
        )
        return True
    except Exception as exc:
        logger.warning("Redis 写入失败：%s", exc)
        return False
