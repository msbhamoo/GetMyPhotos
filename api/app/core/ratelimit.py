from fastapi import Request

from app.core.errors import AppError
from app.core.redis import aredis


async def hit(key: str, limit: int, window_seconds: int) -> None:
    """Fixed-window counter. Raises RATE_LIMITED once `limit` is exceeded."""
    n = await aredis.incr(f"rl:{key}")
    if n == 1:
        await aredis.expire(f"rl:{key}", window_seconds)
    if n > limit:
        raise AppError("RATE_LIMITED", 429)


def client_ip(request: Request) -> str:
    # Behind Cloudflare the real client IP is in CF-Connecting-IP
    return (
        request.headers.get("cf-connecting-ip")
        or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "0.0.0.0")
    )
