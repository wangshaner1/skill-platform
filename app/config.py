import os
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Settings:
    qwen_api_key: str = os.getenv("QWEN_API_KEY", "")
    qwen_base_url: str = os.getenv(
        "QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
    )
    qwen_model: str = os.getenv("QWEN_MODEL", "qwen3.7-plus")
    redis_url: str = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    data_dir: Path = BASE_DIR / "data"
    static_dir: Path = BASE_DIR / "static"


settings = Settings()
