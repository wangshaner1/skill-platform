"""SQLite 数据库连接与建表（Skill 资产 + 版本历史）。"""

import sqlite3

from .config import settings


DB_PATH = settings.data_dir / "skills.db"


def get_conn():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS skills (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                data TEXT NOT NULL,
                requirement TEXT,
                version TEXT,
                status TEXT DEFAULT 'published',
                created_at TEXT,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS skill_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                skill_id TEXT NOT NULL,
                version TEXT,
                data TEXT,
                saved_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_skill_versions_skill
                ON skill_versions(skill_id);
            """
        )
