from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.db import get_conn
from app.core.deps import current_user, require_member
from app.core.errors import AppError
from app.core.redis import aredis, default_queue
from app.core.security import hash_pin
from app.core.storage import key_thumb, key_web, presign_get
from app.core.utils import DEFAULT_LANG, LANGS, STRICTNESS, event_code, strictness_for
from app.services.billing import active_subscription, attach_event
from app.services.qrcard import render_card

router = APIRouter(prefix="/events", tags=["events"])

PUBLIC_COLS = """id, code::text AS code, title, event_date, city, lang, plan_code, status, extended,
                 photo_count, face_count, match_threshold, expires_at, went_live_at, created_at,
                 (pin_hash IS NOT NULL) AS has_pin"""


class EventIn(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    event_date: date | None = None
    city: str | None = Field(default=None, max_length=60)
    lang: str = DEFAULT_LANG
    pin: str | None = Field(default=None, pattern=r"^\d{4}$")


class EventPatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=120)
    event_date: date | None = None
    city: str | None = Field(default=None, max_length=60)
    lang: str | None = None
    pin: str | None = Field(default=None, pattern=r"^(\d{4})?$")  # "" clears the PIN
    strictness: Literal["strict", "normal", "loose"] | None = None


def guest_url(code: str) -> str:
    return f"{settings.guest_base_url}/e/{code}"


def serialize(ev: dict) -> dict:
    out = {k: ev[k] for k in ev if k not in ("pin_hash", "match_threshold")}
    out["strictness"] = strictness_for(ev["match_threshold"])
    out["guest_url"] = guest_url(ev["code"])
    return out


@router.post("")
async def create_event(body: EventIn, user=Depends(current_user), conn=Depends(get_conn)):
    if body.lang not in LANGS:
        raise AppError("BAD_LANG", 400)

    sub = await active_subscription(conn, user["id"])
    use_sub = bool(sub and sub["events_used"] < sub["max_events"])
    if not use_sub:
        cur = await conn.execute(
            """SELECT count(*) AS n FROM events
               WHERE owner_id = %s AND plan_code = 'free' AND status NOT IN ('expired', 'deleted')""",
            (user["id"],),
        )
        free_limit = await (await conn.execute("SELECT max_events FROM plans WHERE code = 'free'")).fetchone()
        if (await cur.fetchone())["n"] >= free_limit["max_events"]:
            raise AppError("FREE_EVENT_LIMIT", 402)

    pin_hash = hash_pin(body.pin) if body.pin else None
    async with conn.transaction():
        ev = None
        for _ in range(6):
            cur = await conn.execute(
                """INSERT INTO events (code, pin_hash, owner_id, title, event_date, city, lang)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (code) DO NOTHING
                   RETURNING id""",
                (event_code(), pin_hash, user["id"], body.title.strip(), body.event_date, body.city, body.lang),
            )
            ev = await cur.fetchone()
            if ev:
                break
        if not ev:
            raise AppError("CODE_GENERATION_FAILED", 500)
        await conn.execute(
            "INSERT INTO event_members (event_id, user_id, role) VALUES (%s, %s, 'owner')", (ev["id"], user["id"])
        )
        if use_sub:
            await attach_event(conn, ev["id"], sub)
        ev = await (await conn.execute(f"SELECT {PUBLIC_COLS} FROM events WHERE id = %s", (ev["id"],))).fetchone()
    return serialize(ev)


@router.get("")
async def list_events(user=Depends(current_user), conn=Depends(get_conn)):
    cur = await conn.execute(
        f"""SELECT {PUBLIC_COLS}, m.role, cover_photo_id FROM events e
            JOIN event_members m ON m.event_id = e.id AND m.user_id = %s
            WHERE e.status <> 'deleted'
            ORDER BY e.created_at DESC""",
        (user["id"],),
    )
    out = []
    for ev in await cur.fetchall():
        cover = ev.pop("cover_photo_id")
        item = serialize(ev)
        item["cover_thumb"] = presign_get(key_thumb(ev["id"], cover)) if cover else None
        out.append(item)
    return out


@router.get("/{event_id}")
async def get_event(event_id: UUID, user=Depends(current_user), conn=Depends(get_conn)):
    ev = await require_member(conn, event_id, user["id"])
    cur = await conn.execute(
        "SELECT status, count(*) AS n FROM photos WHERE event_id = %s GROUP BY status", (event_id,)
    )
    by_status = {r["status"]: r["n"] for r in await cur.fetchall()}
    cur = await conn.execute(
        "SELECT count(*) AS n FROM reports WHERE event_id = %s AND status = 'open'", (event_id,)
    )
    open_reports = (await cur.fetchone())["n"]
    plan = await (await conn.execute("SELECT * FROM plans WHERE code = %s", (ev["plan_code"],))).fetchone()
    result = serialize({k: v for k, v in ev.items() if k not in ("owner_id", "subscription_id", "cover_photo_id")})
    result["stats"] = {
        "photos": by_status,
        "open_reports": open_reports,
        "searches": int(await aredis.get(f"stats:searches:{event_id}") or 0),
        "searches_matched": int(await aredis.get(f"stats:searches_matched:{event_id}") or 0),
    }
    result["limits"] = {"max_photos": plan["max_photos"], "retention_days": plan["retention_days"]}
    result["plan"] = {
        "code": plan["code"],
        "kind": plan["kind"],
        "price_paise": plan["price_paise"],
        "wa_images": plan["wa_images"],
        "max_uploaders": plan["max_uploaders"],
        "original_download": plan["original_download"],
    }
    return result


@router.patch("/{event_id}")
async def update_event(event_id: UUID, body: EventPatch, user=Depends(current_user), conn=Depends(get_conn)):
    await require_member(conn, event_id, user["id"], roles=("owner",))
    fields = body.model_dump(exclude_unset=True)
    updates: dict = {}
    for k in ("title", "event_date", "city"):
        if k in fields:
            updates[k] = fields[k]
    if fields.get("lang") is not None:
        if fields["lang"] not in LANGS:
            raise AppError("BAD_LANG", 400)
        updates["lang"] = fields["lang"]
    if "pin" in fields:
        updates["pin_hash"] = hash_pin(fields["pin"]) if fields["pin"] else None
    if fields.get("strictness"):
        updates["match_threshold"] = STRICTNESS[fields["strictness"]]
    if updates:
        sets = ", ".join(f"{k} = %({k})s" for k in updates)
        await conn.execute(f"UPDATE events SET {sets} WHERE id = %(id)s", {**updates, "id": event_id})
    cur = await conn.execute(f"SELECT {PUBLIC_COLS} FROM events WHERE id = %s", (event_id,))
    return serialize(await cur.fetchone())


@router.delete("/{event_id}")
async def delete_event(event_id: UUID, user=Depends(current_user), conn=Depends(get_conn)):
    await require_member(conn, event_id, user["id"], roles=("owner",))
    await conn.execute("UPDATE events SET status = 'deleted' WHERE id = %s", (event_id,))
    default_queue.enqueue("app.worker.jobs.purge_event", str(event_id), job_timeout=1800)
    return {"ok": True}


@router.post("/{event_id}/attach-subscription")
async def attach_subscription(event_id: UUID, user=Depends(current_user), conn=Depends(get_conn)):
    ev = await require_member(conn, event_id, user["id"], roles=("owner",))
    if ev["plan_code"] != "free":
        raise AppError("ALREADY_UPGRADED", 409)
    if ev["status"] in ("expired", "deleted"):
        raise AppError("EVENT_CLOSED", 409)
    async with conn.transaction():
        sub = await active_subscription(conn, user["id"])
        if not sub:
            raise AppError("NO_SUBSCRIPTION", 402)
        await attach_event(conn, event_id, sub)
    return {"ok": True}


@router.get("/{event_id}/qr.png")
async def qr_card(event_id: UUID, user=Depends(current_user), conn=Depends(get_conn)):
    ev = await require_member(conn, event_id, user["id"])
    date_label = ev["event_date"].strftime("%d %b %Y") if ev["event_date"] else ""
    png = render_card(ev["title"], guest_url(ev["code"]), ev["code"], bool(ev["pin_hash"]), date_label)
    return Response(
        png,
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="GetMyPhotos-{ev["code"]}.png"'},
    )


@router.get("/{event_id}/reports")
async def list_reports(event_id: UUID, user=Depends(current_user), conn=Depends(get_conn)):
    await require_member(conn, event_id, user["id"], roles=("owner",))
    cur = await conn.execute(
        """SELECT r.id, r.photo_id, r.reason, r.note, r.status, r.created_at, p.status AS photo_status
           FROM reports r LEFT JOIN photos p ON p.id = r.photo_id
           WHERE r.event_id = %s ORDER BY r.status = 'open' DESC, r.created_at DESC LIMIT 200""",
        (event_id,),
    )
    rows = await cur.fetchall()
    for r in rows:
        r["thumb"] = presign_get(key_thumb(event_id, r["photo_id"])) if r["photo_id"] else None
    return rows


@router.post("/{event_id}/reports/{report_id}/dismiss")
async def dismiss_report(event_id: UUID, report_id: UUID, user=Depends(current_user), conn=Depends(get_conn)):
    await require_member(conn, event_id, user["id"], roles=("owner",))
    await conn.execute(
        "UPDATE reports SET status = 'dismissed' WHERE id = %s AND event_id = %s", (report_id, event_id)
    )
    return {"ok": True}


@router.post("/{event_id}/photos/{photo_id}/hide")
async def hide_photo(event_id: UUID, photo_id: UUID, user=Depends(current_user), conn=Depends(get_conn)):
    await require_member(conn, event_id, user["id"], roles=("owner",))
    async with conn.transaction():
        await conn.execute(
            "UPDATE photos SET status = 'hidden' WHERE id = %s AND event_id = %s", (photo_id, event_id)
        )
        await conn.execute(
            "UPDATE reports SET status = 'actioned' WHERE photo_id = %s AND status = 'open'", (photo_id,)
        )
    return {"ok": True}


@router.get("/{event_id}/photos")
async def list_event_photos(
    event_id: UUID,
    limit: int = 60,
    offset: int = 0,
    status: str | None = None,
    user=Depends(current_user),
    conn=Depends(get_conn),
):
    await require_member(conn, event_id, user["id"])
    where = "WHERE event_id = %s"
    params = [event_id]
    if status and status != "all":
        where += " AND status = %s"
        params.append(status)
    else:
        where += " AND status != 'deleted'"

    count_cur = await conn.execute(f"SELECT count(*) AS total FROM photos {where}", tuple(params))
    total = (await count_cur.fetchone())["total"]

    cur = await conn.execute(
        f"""SELECT id, width, height, face_count, status, created_at, taken_at
           FROM photos {where}
           ORDER BY created_at DESC LIMIT %s OFFSET %s""",
        tuple(params + [min(limit, 100), offset]),
    )
    rows = await cur.fetchall()
    photos = []
    for r in rows:
        photos.append({
            "id": str(r["id"]),
            "width": r["width"],
            "height": r["height"],
            "face_count": r["face_count"],
            "status": r["status"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "taken_at": r["taken_at"].isoformat() if r["taken_at"] else None,
            "thumb_url": presign_get(key_thumb(event_id, r["id"])),
            "web_url": presign_get(key_web(event_id, r["id"])),
        })
    return {"total": total, "photos": photos, "limit": limit, "offset": offset}


@router.delete("/{event_id}/photos/{photo_id}")
async def delete_photo(event_id: UUID, photo_id: UUID, user=Depends(current_user), conn=Depends(get_conn)):
    await require_member(conn, event_id, user["id"], roles=("owner",))
    async with conn.transaction():
        await conn.execute("DELETE FROM faces WHERE photo_id = %s", (photo_id,))
        cur = await conn.execute(
            "DELETE FROM photos WHERE id = %s AND event_id = %s RETURNING face_count", (photo_id, event_id)
        )
        row = await cur.fetchone()
        if row:
            await conn.execute(
                """UPDATE events SET photo_count = GREATEST(0, photo_count - 1),
                       face_count = GREATEST(0, face_count - %s)
                   WHERE id = %s""",
                (row["face_count"], event_id),
            )
    return {"ok": True}

