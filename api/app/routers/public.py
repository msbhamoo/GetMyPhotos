"""Guest-facing endpoints. No login needed. Selfies are processed in memory only."""
import json
import secrets
from typing import Literal

import numpy as np
from fastapi import APIRouter, Depends, File, Form, Header, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from rq.job import Job

from app.core.config import settings
from app.core.db import get_conn
from app.core.deps import current_user
from app.core.errors import AppError
from app.core.ratelimit import client_ip, hit
from app.core.redis import aredis, media_queue, sync_redis
from app.core.security import create_token, decode_token, verify_pin
from app.core.storage import key_thumb, presign_get
from app.core.utils import DEFAULT_LANG, MAYBE_MARGIN, bucket_matches, sha256
from app.face.search import SEARCH_SQL, embed_selfie
from app.services import messaging
from app.services.delivery import photo_urls, whatsapp_links
from app.services.profiles import rematch_all, store_face

router = APIRouter(prefix="/public", tags=["public"])

SEARCH_TTL = 1800
MAX_SELFIE_BYTES = 2_500_000


class UnlockIn(BaseModel):
    pin: str = Field(pattern=r"^\d{4}$")


class NotMeIn(BaseModel):
    photo_id: str


class ReportIn(BaseModel):
    token: str
    photo_id: str
    reason: Literal["remove_me", "inappropriate", "other"]
    note: str | None = Field(default=None, max_length=500)


class WhatsAppIn(BaseModel):
    mode: Literal["link", "images"] = "link"


class SaveProfileIn(BaseModel):
    consent_version: str
    lang: str = Field(default=DEFAULT_LANG, max_length=5)


async def _load_event(conn, code: str) -> dict:
    cur = await conn.execute(
        """SELECT e.id, e.code::text AS code, e.title, e.event_date, e.city, e.lang, e.status, e.pin_hash,
                  e.photo_count, e.cover_photo_id, e.match_threshold, p.wa_images
           FROM events e JOIN plans p ON p.code = e.plan_code
           WHERE e.code = %s AND e.status <> 'deleted'""",
        (code,),
    )
    ev = await cur.fetchone()
    if not ev:
        raise AppError("EVENT_NOT_FOUND", 404)
    return ev


async def _load_search(token: str) -> dict:
    raw = await aredis.get(f"search:{token}")
    if not raw:
        raise AppError("SEARCH_EXPIRED", 410)
    return json.loads(raw)


def _visible(s: dict, key: str = "matches") -> list[str]:
    hidden = set(s["hidden"])
    return [pid for pid, _ in s[key] if pid not in hidden]


def _results(s: dict) -> dict:
    return {
        "token": s["token"],
        "event": {"code": s["code"], "title": s["title"], "wa_images": s.get("wa_images", 0)},
        "matches": [photo_urls(s["event_id"], pid, s["code"]) for pid in _visible(s)],
        "maybe": [photo_urls(s["event_id"], pid, s["code"]) for pid in _visible(s, "maybe")],
    }


def _enqueue_zip(event_id: str, code: str, photo_ids: list[str], cache_key: str) -> Job:
    return media_queue.enqueue(
        "app.worker.jobs.build_zip", event_id, code, photo_ids, cache_key, job_timeout=600, result_ttl=3600
    )


@router.get("/events/{code}")
async def event_info(code: str, conn=Depends(get_conn)):
    ev = await _load_event(conn, code)
    cover = None
    if ev["cover_photo_id"] and ev["status"] in ("live", "processing"):
        cover = presign_get(key_thumb(ev["id"], ev["cover_photo_id"]))
    return {
        "code": ev["code"],
        "title": ev["title"],
        "event_date": ev["event_date"],
        "city": ev["city"],
        "lang": ev["lang"],
        "status": ev["status"],
        "photo_count": ev["photo_count"],
        "requires_pin": ev["pin_hash"] is not None,
        "cover_thumb": cover,
        "consent_version": settings.consent_version,
        "profile_consent_version": settings.profile_consent_version,
        "wa_images": ev["wa_images"] if messaging.wa_direct_enabled() else 0,
    }


@router.post("/events/{code}/unlock")
async def unlock(code: str, body: UnlockIn, request: Request, conn=Depends(get_conn)):
    ev = await _load_event(conn, code)
    await hit(f"pin:{ev['id']}:{client_ip(request)}", 5, 900)
    if not ev["pin_hash"] or not verify_pin(ev["pin_hash"], body.pin):
        raise AppError("PIN_WRONG", 403)
    return {"event_access": create_token({"typ": "event", "eid": str(ev["id"])}, 12 * 3600)}


@router.post("/events/{code}/search")
async def search(
    code: str,
    request: Request,
    selfie: UploadFile = File(...),
    consent_version: str = Form(...),
    device_id: str = Form("", max_length=64),
    lang: str = Form(DEFAULT_LANG, max_length=5),
    x_event_access: str | None = Header(None),
    conn=Depends(get_conn),
):
    ev = await _load_event(conn, code)
    if ev["status"] not in ("live", "processing"):
        raise AppError("EVENT_NOT_READY" if ev["status"] == "draft" else "EVENT_EXPIRED", 409)
    if ev["pin_hash"]:
        if not x_event_access or decode_token(x_event_access, "event").get("eid") != str(ev["id"]):
            raise AppError("PIN_REQUIRED", 401)
    if consent_version != settings.consent_version:
        raise AppError("CONSENT_REQUIRED", 400)
    ip = client_ip(request)
    await hit(f"search:{ev['id']}:{ip}", 20, 3600)

    data = await selfie.read(MAX_SELFIE_BYTES + 1)
    if len(data) > MAX_SELFIE_BYTES:
        raise AppError("IMAGE_TOO_LARGE", 413)
    try:
        emb = await run_in_threadpool(embed_selfie, data)
    finally:
        del data  # selfie bytes are never stored anywhere

    await conn.execute(
        """INSERT INTO consent_log (anon_key, event_id, action, version, lang, ip_hash)
           VALUES (%s, %s, 'search_consent', %s, %s, %s)""",
        (sha256(f"{device_id}:{ev['id']}").hex(), ev["id"], consent_version, lang, sha256(ip)),
    )
    threshold = float(ev["match_threshold"])
    cur = await conn.execute(SEARCH_SQL, {"q": emb, "event_id": ev["id"], "cutoff": threshold + MAYBE_MARGIN})
    rows = [(r["photo_id"], float(r["d"])) for r in await cur.fetchall()]
    matches, maybe = bucket_matches(rows, threshold)

    token = secrets.token_urlsafe(18)
    state = {
        "token": token,
        "event_id": str(ev["id"]),
        "code": ev["code"],
        "title": ev["title"],
        "wa_images": ev["wa_images"] if messaging.wa_direct_enabled() else 0,
        # Embedding kept only for this session (30 min) — lets the guest save a profile without a 2nd selfie
        "emb": [round(float(x), 6) for x in emb],
        "matches": matches,
        "maybe": maybe,
        "hidden": [],
    }
    await aredis.set(f"search:{token}", json.dumps(state), ex=SEARCH_TTL)
    await aredis.incr(f"stats:searches:{ev['id']}")
    if matches:
        await aredis.incr(f"stats:searches_matched:{ev['id']}")
    return {**_results(state), "expires_in": SEARCH_TTL}


@router.get("/search/{token}")
async def get_search(token: str):
    s = await _load_search(token)
    return {**_results(s), "expires_in": await aredis.ttl(f"search:{token}")}


@router.post("/search/{token}/not-me")
async def not_me(token: str, body: NotMeIn, conn=Depends(get_conn)):
    s = await _load_search(token)
    known = {pid for pid, _ in s["matches"]} | {pid for pid, _ in s["maybe"]}
    if body.photo_id not in known:
        raise AppError("PHOTO_NOT_FOUND", 404)
    if body.photo_id not in s["hidden"]:
        s["hidden"].append(body.photo_id)
        ttl = await aredis.ttl(f"search:{token}")
        await aredis.set(f"search:{token}", json.dumps(s), ex=max(ttl, 1))
        await conn.execute(
            "INSERT INTO reports (event_id, photo_id, reason) VALUES (%s, %s, 'not_me')",
            (s["event_id"], body.photo_id),
        )
    return {"ok": True}


@router.post("/reports")
async def report(body: ReportIn, request: Request, conn=Depends(get_conn)):
    await hit(f"report:{client_ip(request)}", 20, 3600)
    s = await _load_search(body.token)
    known = {pid for pid, _ in s["matches"]} | {pid for pid, _ in s["maybe"]}
    if body.photo_id not in known:
        raise AppError("PHOTO_NOT_FOUND", 404)
    await conn.execute(
        "INSERT INTO reports (event_id, photo_id, reason, note) VALUES (%s, %s, %s, %s)",
        (s["event_id"], body.photo_id, body.reason, body.note),
    )
    return {"ok": True}


@router.post("/search/{token}/zip")
async def request_zip(token: str, request: Request):
    s = await _load_search(token)
    await hit(f"zip:{client_ip(request)}", 10, 3600)
    ids = _visible(s)
    if not ids:
        raise AppError("NO_PHOTOS", 400)
    job = _enqueue_zip(s["event_id"], s["code"], ids, token)
    return {"job_id": job.id, "count": len(ids)}


@router.post("/search/{token}/whatsapp")
async def search_whatsapp(token: str, body: WhatsAppIn, request: Request, conn=Depends(get_conn)):
    s = await _load_search(token)
    await hit(f"wa:{client_ip(request)}", 10, 3600)
    event = {"id": s["event_id"], "title": s["title"]}
    return await whatsapp_links(conn, event, _visible(s), body.mode, s.get("wa_images", 0))


@router.post("/search/{token}/save-profile")
async def save_profile(
    token: str, body: SaveProfileIn, request: Request, user=Depends(current_user), conn=Depends(get_conn)
):
    """Save the face code from this search (no second selfie) and add the event to My Events."""
    if body.consent_version != settings.profile_consent_version:
        raise AppError("CONSENT_REQUIRED", 400)
    s = await _load_search(token)
    emb = np.asarray(s["emb"], dtype=np.float32)
    await store_face(conn, user["id"], emb, body.consent_version, body.lang, client_ip(request))
    await conn.execute(
        """INSERT INTO guest_events (user_id, event_id, joined_via) VALUES (%s, %s, 'qr')
           ON CONFLICT (user_id, event_id) DO NOTHING""",
        (user["id"], s["event_id"]),
    )
    matched = await rematch_all(conn, user["id"], emb)
    if s["hidden"]:
        await conn.execute(
            "UPDATE guest_matches SET hidden = true WHERE user_id = %s AND photo_id = ANY(%s::uuid[])",
            (user["id"], s["hidden"]),
        )
    return {"ok": True, "event_id": s["event_id"], "matched": matched}


async def _load_gallery(conn, gid: str) -> tuple[dict, list[str]]:
    row = await (
        await conn.execute(
            """SELECT g.photo_ids, e.id AS event_id, e.code::text AS code, e.title
               FROM shared_galleries g JOIN events e ON e.id = g.event_id
               WHERE g.id = %s AND g.expires_at > now() AND e.status IN ('live', 'processing')""",
            (gid,),
        )
    ).fetchone()
    if not row:
        raise AppError("GALLERY_NOT_FOUND", 404)
    cur = await conn.execute(
        """SELECT p.id::text AS id FROM unnest(%s::uuid[]) WITH ORDINALITY AS g(id, ord)
           JOIN photos p ON p.id = g.id AND p.status = 'done' ORDER BY g.ord""",
        (row["photo_ids"],),
    )
    return row, [r["id"] for r in await cur.fetchall()]


@router.get("/gallery/{gid}")
async def gallery(gid: str, conn=Depends(get_conn)):
    row, ids = await _load_gallery(conn, gid)
    return {
        "event": {"code": row["code"], "title": row["title"]},
        "photos": [photo_urls(row["event_id"], pid, row["code"]) for pid in ids],
    }


@router.post("/gallery/{gid}/zip")
async def gallery_zip(gid: str, request: Request, conn=Depends(get_conn)):
    await hit(f"zip:{client_ip(request)}", 10, 3600)
    row, ids = await _load_gallery(conn, gid)
    if not ids:
        raise AppError("NO_PHOTOS", 400)
    job = _enqueue_zip(str(row["event_id"]), row["code"], ids, f"g{gid}")
    return {"job_id": job.id, "count": len(ids)}


@router.get("/jobs/{job_id}")
async def job_status(job_id: str):
    try:
        job = await run_in_threadpool(Job.fetch, job_id, connection=sync_redis())
    except Exception:
        raise AppError("JOB_NOT_FOUND", 404)
    status = job.get_status(refresh=False)
    if status == "finished":
        return {"status": "done", "url": job.return_value()}
    if status == "failed":
        return {"status": "failed"}
    return {"status": "working"}
