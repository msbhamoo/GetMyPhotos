"""Owners invite photographers (uploaders) to an event by WhatsApp link."""
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.config import settings
from app.core.db import get_conn
from app.core.deps import current_user, require_member
from app.core.errors import AppError
from app.core.redis import notify_queue
from app.core.utils import normalize_phone, sha256

router = APIRouter(tags=["invites"])
INVITE_DAYS = 7


class InviteIn(BaseModel):
    phone: str | None = None


def _invite_url(raw: str) -> str:
    return f"{settings.dashboard_base_url}/invite/{raw}"


@router.post("/events/{event_id}/invites")
async def create_invite(event_id: UUID, body: InviteIn, user=Depends(current_user), conn=Depends(get_conn)):
    ev = await require_member(conn, event_id, user["id"], roles=("owner",))
    phone = None
    if body.phone:
        phone = normalize_phone(body.phone)
        if not phone:
            raise AppError("BAD_PHONE", 400)

    plan = await (await conn.execute("SELECT max_uploaders FROM plans WHERE code = %s", (ev["plan_code"],))).fetchone()
    cur = await conn.execute(
        """SELECT (SELECT count(*) FROM event_members WHERE event_id = %(e)s AND role = 'uploader')
                + (SELECT count(*) FROM event_invites
                   WHERE event_id = %(e)s AND used_at IS NULL AND expires_at > now()) AS n""",
        {"e": event_id},
    )
    if (await cur.fetchone())["n"] >= plan["max_uploaders"]:
        raise AppError("UPLOADER_LIMIT", 402)

    raw = secrets.token_urlsafe(24)
    expires = datetime.now(timezone.utc) + timedelta(days=INVITE_DAYS)
    row = await (
        await conn.execute(
            """INSERT INTO event_invites (event_id, token_hash, phone, role, expires_at, created_by)
               VALUES (%s, %s, %s, 'uploader', %s, %s) RETURNING id""",
            (event_id, sha256(raw), phone, expires, user["id"]),
        )
    ).fetchone()
    url = _invite_url(raw)
    if phone:
        notify_queue.enqueue(
            "app.worker.jobs.send_invite", phone, ev["lang"], user["name"] or user["phone"], ev["title"], url
        )
    return {"id": row["id"], "url": url, "phone": phone, "expires_at": expires}


@router.get("/events/{event_id}/members")
async def members(event_id: UUID, user=Depends(current_user), conn=Depends(get_conn)):
    await require_member(conn, event_id, user["id"])
    cur = await conn.execute(
        """SELECT u.id, u.name, u.phone, u.studio_name, m.role, m.added_at
           FROM event_members m JOIN users u ON u.id = m.user_id
           WHERE m.event_id = %s ORDER BY m.role = 'owner' DESC, m.added_at""",
        (event_id,),
    )
    result = {"members": await cur.fetchall()}
    cur = await conn.execute(
        """SELECT id, phone, expires_at, created_at FROM event_invites
           WHERE event_id = %s AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC""",
        (event_id,),
    )
    result["invites"] = await cur.fetchall()
    return result


@router.delete("/events/{event_id}/members/{member_id}")
async def remove_member(event_id: UUID, member_id: UUID, user=Depends(current_user), conn=Depends(get_conn)):
    await require_member(conn, event_id, user["id"], roles=("owner",))
    await conn.execute(
        "DELETE FROM event_members WHERE event_id = %s AND user_id = %s AND role = 'uploader'", (event_id, member_id)
    )
    return {"ok": True}


@router.delete("/events/{event_id}/invites/{invite_id}")
async def cancel_invite(event_id: UUID, invite_id: UUID, user=Depends(current_user), conn=Depends(get_conn)):
    await require_member(conn, event_id, user["id"], roles=("owner",))
    await conn.execute(
        "DELETE FROM event_invites WHERE id = %s AND event_id = %s AND used_at IS NULL", (invite_id, event_id)
    )
    return {"ok": True}


async def _load_invite(conn, token: str) -> dict:
    cur = await conn.execute(
        """SELECT i.*, e.title, e.status AS event_status, COALESCE(u.studio_name, u.name) AS inviter
           FROM event_invites i JOIN events e ON e.id = i.event_id LEFT JOIN users u ON u.id = i.created_by
           WHERE i.token_hash = %s""",
        (sha256(token),),
    )
    inv = await cur.fetchone()
    if not inv or inv["event_status"] == "deleted":
        raise AppError("INVITE_NOT_FOUND", 404)
    return inv


@router.get("/invites/{token}")
async def invite_info(token: str, conn=Depends(get_conn)):
    inv = await _load_invite(conn, token)
    valid = inv["used_at"] is None and inv["expires_at"] > datetime.now(timezone.utc)
    return {"event_title": inv["title"], "inviter": inv["inviter"], "valid": valid, "role": inv["role"]}


@router.post("/invites/{token}/accept")
async def accept_invite(token: str, user=Depends(current_user), conn=Depends(get_conn)):
    async with conn.transaction():
        inv = await _load_invite(conn, token)
        if inv["used_at"] is not None or inv["expires_at"] <= datetime.now(timezone.utc):
            raise AppError("INVITE_EXPIRED", 410)
        if inv["phone"] and inv["phone"] != user["phone"]:
            raise AppError("INVITE_PHONE_MISMATCH", 403)
        await conn.execute(
            """INSERT INTO event_members (event_id, user_id, role) VALUES (%s, %s, %s)
               ON CONFLICT (event_id, user_id) DO NOTHING""",
            (inv["event_id"], user["id"], inv["role"]),
        )
        await conn.execute(
            "UPDATE event_invites SET used_by = %s, used_at = now() WHERE id = %s", (user["id"], inv["id"])
        )
    return {"event_id": inv["event_id"]}
