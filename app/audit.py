"""审计日志：记录关键操作（需求只记录哈希，不落原文）。"""

import hashlib
import json
import time

from .config import settings


AUDIT_FILE = settings.data_dir / "audit.log"


def log_action(action, requirement="", skill_id="", cached=None, **extra):
    record = {
        "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
        "action": action,
        "requirement_hash": hashlib.sha256((requirement or "").encode("utf-8")).hexdigest()[:16],
        "skill_id": skill_id or "",
        "cached": cached,
    }
    record.update(extra)
    try:
        with open(AUDIT_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass
