"""输入数据加密存储：任务中的业务数据在库中为密文，读取时解密。"""

from cryptography.fernet import Fernet

from .config import settings


KEY_FILE = settings.data_dir / "keys" / "enc.key"
_fernet = None


def _get_fernet():
    global _fernet
    if _fernet is None:
        KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        if KEY_FILE.exists():
            key = KEY_FILE.read_text(encoding="utf-8").strip()
        else:
            key = Fernet.generate_key().decode("utf-8")
            KEY_FILE.write_text(key, encoding="utf-8")
        _fernet = Fernet(key.encode("utf-8"))
    return _fernet


def encrypt_text(text):
    if not text:
        return text
    return _get_fernet().encrypt(text.encode("utf-8")).decode("utf-8")


def decrypt_text(token):
    if not token:
        return token
    try:
        return _get_fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except Exception:
        return token
