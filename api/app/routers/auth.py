from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Cookie, Depends, Request, Response
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.db import get_conn
from app.core.deps import USER_COLS, current_user
from app.core.errors import AppError
from app.core.ratelimit import client_ip, hit
from app.core.security import create_access, new_refresh_token
from app.core.utils import DEFAULT_LANG, LANGS, normalize_phone, sha256
from app.services.otp import send_otp, verify_otp

router = APIRouter(tags=["auth"])
COOKIE = "gmp_rt"


class SendIn(BaseModel):
    phone: str
    channel: Literal["wa", "sms"] = "wa"
    lang: str = DEFAULT_LANG


class VerifyIn(BaseModel):
    phone: str
    code: str = Field(pattern=r"^\s*\d{6}\s*$")


class MePatch(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    lang: str | None = None
    studio_name: str | None = Field(default=None, max_length=80)


def _phone(raw: str) -> str:
    phone = normalize_phone(raw)
    if not phone:
        raise AppError("BAD_PHONE", 400)
    return phone


def _set_cookie(response: Response, raw: str) -> None:
    response.set_cookie(
        COOKIE,
        raw,
        max_age=settings.refresh_ttl_days * 86400,
        httponly=True,
        secure=not settings.is_dev,
        samesite="lax" if settings.is_dev else "none",
        path="/v1/auth",
    )


async def _issue_session(conn, response: Response, user_id, request: Request) -> str:
    raw, digest = new_refresh_token()
    await conn.execute(
        "INSERT INTO sessions (user_id, token_hash, device, expires_at) VALUES (%s, %s, %s, %s)",
        (
            user_id,
            digest,
            request.headers.get("user-agent", "")[:200],
            datetime.now(timezone.utc) + timedelta(days=settings.refresh_ttl_days),
        ),
    )
    _set_cookie(response, raw)
    return create_access(user_id)


@router.post("/auth/otp/send")
async def otp_send(body: SendIn, request: Request):
    phone = _phone(body.phone)
    await hit(f"otp-ip:{client_ip(request)}", 10, 3600)
    result = await send_otp(phone, body.channel, body.lang if body.lang in LANGS else DEFAULT_LANG)
    return {**result, "resend_after": 30}


@router.post("/auth/otp/verify")
async def otp_verify(body: VerifyIn, request: Request, response: Response, conn=Depends(get_conn)):
    phone = _phone(body.phone)
    await verify_otp(phone, body.code)
    cur = await conn.execute(
        f"""INSERT INTO users (phone) VALUES (%s)
            ON CONFLICT (phone) DO UPDATE SET deleted_at = NULL
            RETURNING {USER_COLS}, (xmax = 0) AS is_new""",
        (phone,),
    )
    user = await cur.fetchone()
    access = await _issue_session(conn, response, user["id"], request)
    is_new = user.pop("is_new")
    return {"access": access, "user": user, "is_new": is_new}


@router.post("/auth/refresh")
async def refresh(request: Request, response: Response, gmp_rt: str | None = Cookie(None), conn=Depends(get_conn)):
    if not gmp_rt:
        raise AppError("UNAUTHORIZED", 401)
    cur = await conn.execute(
        """DELETE FROM sessions WHERE token_hash = %s AND expires_at > now()
           RETURNING user_id""",
        (sha256(gmp_rt),),
    )
    row = await cur.fetchone()
    if not row:
        response.delete_cookie(COOKIE, path="/v1/auth")
        raise AppError("UNAUTHORIZED", 401)
    cur = await conn.execute(
        f"SELECT {USER_COLS} FROM users WHERE id = %s AND deleted_at IS NULL", (row["user_id"],)
    )
    user = await cur.fetchone()
    if not user:
        raise AppError("UNAUTHORIZED", 401)
    access = await _issue_session(conn, response, user["id"], request)
    return {"access": access, "user": user}


@router.post("/auth/logout")
async def logout(response: Response, gmp_rt: str | None = Cookie(None), conn=Depends(get_conn)):
    if gmp_rt:
        await conn.execute("DELETE FROM sessions WHERE token_hash = %s", (sha256(gmp_rt),))
    response.delete_cookie(COOKIE, path="/v1/auth")
    return {"ok": True}


@router.get("/me")
async def me(user=Depends(current_user)):
    return user


@router.patch("/me")
async def update_me(body: MePatch, user=Depends(current_user), conn=Depends(get_conn)):
    fields = body.model_dump(exclude_none=True)
    if "lang" in fields and fields["lang"] not in LANGS:
        raise AppError("BAD_LANG", 400)
    if not fields:
        return user
    sets = ", ".join(f"{k} = %({k})s" for k in fields)
    cur = await conn.execute(
        f"UPDATE users SET {sets} WHERE id = %(id)s RETURNING {USER_COLS}", {**fields, "id": user["id"]}
    )
    return await cur.fetchone()
