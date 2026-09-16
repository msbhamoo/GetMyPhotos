import hmac
import json
import logging
import secrets

from app.core.config import settings
from app.core.errors import AppError
from app.core.ratelimit import hit
from app.core.redis import aredis
from app.core.utils import mask_phone, sha256
from app.services import messaging

log = logging.getLogger("gmp.otp")
OTP_TTL = 300
MAX_TRIES = 5


def _digest(phone: str, code: str) -> str:
    return sha256(f"{settings.jwt_secret}:{phone}:{code}").hex()


async def send_otp(phone: str, channel: str, lang: str) -> dict:
    """Send via WhatsApp first, SMS as fallback. Returns {'sent_via', 'dev_code'?}."""
    await hit(f"otp:{phone}", 3, 600)
    code = f"{secrets.randbelow(10**6):06d}"
    await aredis.set(f"otp:{phone}", json.dumps({"h": _digest(phone, code), "tries": 0}), ex=OTP_TTL)

    if settings.dev_otp:
        log.warning("DEV OTP for %s: %s", mask_phone(phone), code)
        return {"sent_via": "dev", "dev_code": code if settings.is_dev else None}

    if channel == "wa" and messaging.wa_enabled() and await messaging.send_wa_otp(phone, code, lang):
        return {"sent_via": "wa"}
    if messaging.sms_enabled() and await messaging.send_sms_otp(phone, code):
        return {"sent_via": "sms"}
    raise AppError("OTP_SEND_FAILED", 502)


async def verify_otp(phone: str, code: str) -> None:
    raw = await aredis.get(f"otp:{phone}")
    if not raw:
        raise AppError("OTP_EXPIRED", 400)
    data = json.loads(raw)
    if data["tries"] >= MAX_TRIES:
        await aredis.delete(f"otp:{phone}")
        raise AppError("OTP_EXPIRED", 400)
    if not hmac.compare_digest(data["h"], _digest(phone, code.strip())):
        data["tries"] += 1
        ttl = await aredis.ttl(f"otp:{phone}")
        await aredis.set(f"otp:{phone}", json.dumps(data), ex=max(ttl, 1))
        raise AppError("OTP_WRONG", 400)
    await aredis.delete(f"otp:{phone}")
