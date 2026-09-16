"""Logged-in guest: face code profile and "My Events"."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Header, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.db import get_conn
from app.core.deps import current_user
from app.core.errors import AppError
from app.core.ratelimit import client_ip, hit
from app.core.redis import media_queue
from app.core.security import decode_token, verify_pin
from app.core.storage import key_thumb, presign_get
from app.core.utils import DEFAULT_LANG, sha256
from app.face.search import embed_selfie
from app.services import messaging
from app.services.delivery import photo_urls, whatsapp_links
from app.services.profiles import load_face, match_event, rematch_all, store_face

router = APIRouter(prefix="/guest", tags=["guest"])
MAX_SELFIE_BYTES = 2_500_000


class JoinIn(BaseModel):
    code: str = Field(min_length=4, max_length=12)
    pin: str | None = Field(default=None, pattern=r"^\d{4}$")
    via: Literal["qr", "code"] = "code"


class PhotoIn(BaseModel):
    photo_id: UUID


class WhatsAppIn(BaseModel):
    mode: Literal["link", "images"] = "link"


async def _joined_event(conn, user_id, event_id) -> dict:
    cur = await conn.execute(
        """SELECT e.id, e.code::text AS code, e.title, e.status, e.match_threshold, p.wa_images
           FROM guest_events ge JOIN events e ON e.id = ge.event_id JOIN plans p ON p.code = e.plan_code
           WHERE ge.user_id = %s AND ge.event_id = %s AND e.status <> 'deleted'""",
        (user_id, event_id),
    )
    ev = await cur.fetchone()
    if not ev:
        raise AppError("EVENT_NOT_FOUND", 404)
    return ev


async def _visible_matches(conn, user_id, event_id) -> list[str]:
    cur = await conn.execute(
        """SELECT gm.photo_id::text AS id FROM guest_matches gm
           JOIN photos p ON p.id = gm.photo_id AND p.status = 'done'
           WHERE gm.user_id = %s AND gm.event_id = %s AND NOT gm.hidden
           ORDER BY gm.distance LIMIT 500""",
        (user_id, event_id),
    )
    return [r["id"] for r in await cur.fetchall()]


@router.get("/profile")
async def profile(user=Depends(current_user), conn=Depends(get_conn)):
    face = await (
        await conn.execute("SELECT consent_at FROM guest_faces WHERE user_id = %s", (user["id"],))
    ).fetchone()
    events = await (
        await conn.execute("SELECT count(*) AS n FROM guest_events WHERE user_id = %s", (user["id"],))
    ).fetchone()
    return {
        "phone": user["phone"],
        "has_face": face is not None,
        "consent_at": face["consent_at"] if face else None,
        "events": events["n"],
        "consent_version": settings.profile_consent_version,
    }


@router.post("/face")
async def set_face(
    request: Request,
    selfie: UploadFile = File(...),
    consent_version: str = Form(...),
    lang: str = Form(DEFAULT_LANG, max_length=5),
    user=Depends(current_user),
    conn=Depends(get_conn),
):
    if consent_version != settings.profile_consent_version:
        raise AppError("CONSENT_REQUIRED", 400)
    await hit(f"guestface:{user['id']}", 10, 3600)
    data = await selfie.read(MAX_SELFIE_BYTES + 1)
    if len(data) > MAX_SELFIE_BYTES:
        raise AppError("IMAGE_TOO_LARGE", 413)
    try:
        emb = await run_in_threadpool(embed_selfie, data)
    finally:
        del data
    await store_face(conn, user["id"], emb, consent_version, lang, client_ip(request))
    matched = await rematch_all(conn, user["id"], emb)
    return {"has_face": True, "matched": matched}


@router.delete("/face")
async def delete_face(request: Request, user=Depends(current_user), conn=Depends(get_conn)):
    async with conn.transaction():
        await conn.execute("DELETE FROM guest_faces WHERE user_id = %s", (user["id"],))
        await conn.execute("DELETE FROM guest_matches WHERE user_id = %s", (user["id"],))
        await conn.execute(
            """INSERT INTO consent_log (user_id, action, version, lang, ip_hash)
               VALUES (%s, 'profile_delete', %s, %s, %s)""",
            (user["id"], settings.profile_consent_version, user["lang"], sha256(client_ip(request))),
        )
    return {"ok": True}


@router.get("/events")
async def my_events(user=Depends(current_user), conn=Depends(get_conn)):
    cur = await conn.execute(
        """SELECT e.id, e.code::text AS code, e.title, e.event_date, e.city, e.status, e.cover_photo_id,
                  ge.joined_at,
                  count(gm.photo_id) FILTER (WHERE NOT gm.hidden) AS photo_count,
                  count(gm.photo_id) FILTER (WHERE NOT gm.hidden AND gm.created_at > ge.last_viewed_at) AS new_count
           FROM guest_events ge
           JOIN events e ON e.id = ge.event_id AND e.status <> 'deleted'
           LEFT JOIN guest_matches gm ON gm.user_id = ge.user_id AND gm.event_id = e.id
                AND EXISTS (SELECT 1 FROM photos p WHERE p.id = gm.photo_id AND p.status = 'done')
           WHERE ge.user_id = %s
           GROUP BY e.id, ge.joined_at
           ORDER BY ge.joined_at DESC""",
        (user["id"],),
    )
    out = []
    for ev in await cur.fetchall():
        cover = ev.pop("cover_photo_id")
        ev["cover_thumb"] = (
            presign_get(key_thumb(ev["id"], cover)) if cover and ev["status"] in ("live", "processing") else None
        )
        out.append(ev)
    return out


@router.post("/events")
async def join_event(
    body: JoinIn,
    request: Request,
    x_event_access: str | None = Header(None),
    user=Depends(current_user),
    conn=Depends(get_conn),
):
    await hit(f"guestjoin:{user['id']}", 30, 3600)
    ev = await (
        await conn.execute(
            """SELECT id, status, pin_hash, match_threshold FROM events
               WHERE code = %s AND status <> 'deleted'""",
            (body.code.upper(),),
        )
    ).fetchone()
    if not ev:
        raise AppError("EVENT_NOT_FOUND", 404)
    if ev["status"] == "expired":
        raise AppError("EVENT_EXPIRED", 409)

    if ev["pin_hash"]:
        unlocked = False
        if x_event_access:
            try:
                unlocked = decode_token(x_event_access, "event").get("eid") == str(ev["id"])
            except AppError:
                unlocked = False
        if not unlocked:
            if not body.pin:
                raise AppError("PIN_REQUIRED", 401)
            await hit(f"pin:{ev['id']}:{client_ip(request)}", 5, 900)
            if not verify_pin(ev["pin_hash"], body.pin):
                raise AppError("PIN_WRONG", 403)

    await conn.execute(
        """INSERT INTO guest_events (user_id, event_id, joined_via) VALUES (%s, %s, %s)
           ON CONFLICT (user_id, event_id) DO NOTHING""",
        (user["id"], ev["id"], body.via),
    )
    emb = await load_face(conn, user["id"])
    matched = 0
    if emb is not None and ev["status"] in ("live", "processing"):
        matched = await match_event(conn, user["id"], ev["id"], emb, float(ev["match_threshold"]))
    return {"event_id": ev["id"], "matched": matched, "has_face": emb is not None}


@router.delete("/events/{event_id}")
async def leave_event(event_id: UUID, user=Depends(current_user), conn=Depends(get_conn)):
    async with conn.transaction():
        await conn.execute("DELETE FROM guest_matches WHERE user_id = %s AND event_id = %s", (user["id"], event_id))
        await conn.execute("DELETE FROM guest_events WHERE user_id = %s AND event_id = %s", (user["id"], event_id))
    return {"ok": True}


@router.get("/events/{event_id}/photos")
async def event_photos(event_id: UUID, user=Depends(current_user), conn=Depends(get_conn)):
    ev = await _joined_event(conn, user["id"], event_id)
    event = {
        "id": ev["id"],
        "code": ev["code"],
        "title": ev["title"],
        "status": ev["status"],
        "wa_images": ev["wa_images"],
        "wa_direct": messaging.wa_direct_enabled(),
    }
    if ev["status"] not in ("live", "processing"):
        return {"event": event, "photos": []}
    ids = await _visible_matches(conn, user["id"], event_id)
    await conn.execute(
        "UPDATE guest_events SET last_viewed_at = now() WHERE user_id = %s AND event_id = %s", (user["id"], event_id)
    )
    return {"event": event, "photos": [photo_urls(ev["id"], pid, ev["code"]) for pid in ids]}


@router.post("/events/{event_id}/not-me")
async def not_me(event_id: UUID, body: PhotoIn, user=Depends(current_user), conn=Depends(get_conn)):
    await _joined_event(conn, user["id"], event_id)
    cur = await conn.execute(
        """UPDATE guest_matches SET hidden = true
           WHERE user_id = %s AND event_id = %s AND photo_id = %s AND NOT hidden RETURNING photo_id""",
        (user["id"], event_id, body.photo_id),
    )
    if await cur.fetchone():
        await conn.execute(
            "INSERT INTO reports (event_id, photo_id, reporter_id, reason) VALUES (%s, %s, %s, 'not_me')",
            (event_id, body.photo_id, user["id"]),
        )
    return {"ok": True}


@router.post("/events/{event_id}/zip")
async def zip_photos(event_id: UUID, user=Depends(current_user), conn=Depends(get_conn)):
    ev = await _joined_event(conn, user["id"], event_id)
    ids = await _visible_matches(conn, user["id"], event_id)
    if not ids:
        raise AppError("NO_PHOTOS", 400)
    job = media_queue.enqueue(
        "app.worker.jobs.build_zip", str(ev["id"]), ev["code"], ids, f"u{user['id'].hex[:16]}",
        job_timeout=600, result_ttl=3600,
    )
    return {"job_id": job.id, "count": len(ids)}


@router.post("/events/{event_id}/whatsapp")
async def whatsapp(event_id: UUID, body: WhatsAppIn, user=Depends(current_user), conn=Depends(get_conn)):
    ev = await _joined_event(conn, user["id"], event_id)
    ids = await _visible_matches(conn, user["id"], event_id)
    return await whatsapp_links(conn, ev, ids, body.mode, ev["wa_images"])
