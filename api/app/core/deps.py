from fastapi import Depends, Header

from app.core.db import get_conn
from app.core.errors import AppError
from app.core.security import decode_token

USER_COLS = "id, phone, name, lang, studio_name, is_admin, created_at"


async def current_user(authorization: str | None = Header(None), conn=Depends(get_conn)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AppError("UNAUTHORIZED", 401)
    payload = decode_token(authorization[7:], "access")
    cur = await conn.execute(
        f"SELECT {USER_COLS} FROM users WHERE id = %s AND deleted_at IS NULL", (payload["sub"],)
    )
    user = await cur.fetchone()
    if not user:
        raise AppError("UNAUTHORIZED", 401)
    return user


async def require_member(conn, event_id, user_id, roles=("owner", "uploader")) -> dict:
    cur = await conn.execute(
        """SELECT e.*, m.role FROM events e
           JOIN event_members m ON m.event_id = e.id AND m.user_id = %s
           WHERE e.id = %s AND e.status <> 'deleted'""",
        (user_id, event_id),
    )
    ev = await cur.fetchone()
    if not ev:
        raise AppError("EVENT_NOT_FOUND", 404)
    if ev["role"] not in roles:
        raise AppError("FORBIDDEN", 403)
    return ev
