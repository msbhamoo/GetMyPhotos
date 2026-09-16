import secrets
import time

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.core.config import settings
from app.core.errors import AppError
from app.core.utils import sha256

_ph = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)


def create_token(claims: dict, ttl_seconds: int) -> str:
    payload = {**claims, "exp": int(time.time()) + ttl_seconds}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_access(user_id) -> str:
    return create_token({"sub": str(user_id), "typ": "access"}, settings.access_ttl_min * 60)


def decode_token(token: str, typ: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise AppError("UNAUTHORIZED", 401)
    if payload.get("typ") != typ:
        raise AppError("UNAUTHORIZED", 401)
    return payload


def new_refresh_token() -> tuple[str, bytes]:
    raw = secrets.token_urlsafe(32)
    return raw, sha256(raw)


def hash_pin(pin: str) -> str:
    return _ph.hash(pin)


def verify_pin(pin_hash: str, pin: str) -> bool:
    try:
        return _ph.verify(pin_hash, pin)
    except VerifyMismatchError:
        return False
