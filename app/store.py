"""Skill 资产存储：SQLite + 版本历史。"""

import json
import uuid
from datetime import datetime
from pathlib import Path

from .config import settings
from .db import get_conn, init_db


def _now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _next_version(version):
    num = 0
    if version and str(version).startswith("v"):
        try:
            num = int(str(version)[1:])
        except ValueError:
            num = 0
    return f"v{num + 1}"


class SkillStore:
    def __init__(self, path=None):
        self.path = Path(path) if path else settings.data_dir / "skills.db"
        init_db()
        self._migrate_json()

    def _migrate_json(self):
        """首次运行时把历史 JSON 数据导入 SQLite。"""
        json_file = settings.data_dir / "skills.json"
        if not json_file.exists():
            return
        with get_conn() as conn:
            count = conn.execute("SELECT COUNT(*) AS c FROM skills").fetchone()["c"]
            if count:
                return
        try:
            items = json.loads(json_file.read_text(encoding="utf-8"))
        except Exception:
            return
        for item in items:
            self.save(item)

    def list(self):
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT data FROM skills ORDER BY updated_at DESC, created_at DESC"
            ).fetchall()
        return [json.loads(row["data"]) for row in rows]

    def get(self, skill_id):
        with get_conn() as conn:
            row = conn.execute(
                "SELECT data FROM skills WHERE id = ?", (skill_id,)
            ).fetchone()
        return json.loads(row["data"]) if row else None

    def save(self, skill):
        skill = dict(skill)
        skill["id"] = skill.get("id") or uuid.uuid4().hex[:12]
        now = _now()
        with get_conn() as conn:
            row = conn.execute(
                "SELECT data, version FROM skills WHERE id = ?", (skill["id"],)
            ).fetchone()
            if row:
                conn.execute(
                    "INSERT INTO skill_versions (skill_id, version, data, saved_at) VALUES (?, ?, ?, ?)",
                    (skill["id"], row["version"], row["data"], now),
                )
                version = _next_version(row["version"])
            else:
                version = skill.get("version") or "v1"

            skill["version"] = version
            skill["created_at"] = skill.get("created_at") or now
            skill["updated_at"] = now
            skill["status"] = skill.get("status", "published")
            conn.execute(
                """
                INSERT INTO skills (id, name, data, requirement, version, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    data = excluded.data,
                    requirement = excluded.requirement,
                    version = excluded.version,
                    status = excluded.status,
                    updated_at = excluded.updated_at
                """,
                (
                    skill["id"],
                    skill["name"],
                    json.dumps(skill, ensure_ascii=False),
                    skill.get("requirement"),
                    version,
                    skill["status"],
                    skill["created_at"],
                    now,
                ),
            )
        return skill

    def get_versions(self, skill_id):
        versions = []
        with get_conn() as conn:
            current = conn.execute(
                "SELECT data, version, updated_at AS saved_at FROM skills WHERE id = ?",
                (skill_id,),
            ).fetchone()
            if current:
                versions.append(
                    {
                        "version": current["version"],
                        "saved_at": current["saved_at"],
                        "skill": json.loads(current["data"]),
                    }
                )
            rows = conn.execute(
                "SELECT data, version, saved_at FROM skill_versions WHERE skill_id = ? ORDER BY id DESC",
                (skill_id,),
            ).fetchall()
            for row in rows:
                versions.append(
                    {
                        "version": row["version"],
                        "saved_at": row["saved_at"],
                        "skill": json.loads(row["data"]),
                    }
                )
        return versions
