from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.core.db import get_conn
from app.core.deps import current_user, require_member
from app.core.errors import AppError
from app.core.redis import face_queue
from app.core.storage import key_thumb, key_web, presign_put
from app.worker.jobs import index_photo

router = APIRouter(prefix="/events/{event_id}/uploads", tags=["uploads"])


class FileIn(BaseModel):
    client_hash: str = Field(pattern=r"^[a-f0-9]{40}$")
    mime: Literal["image/webp", "image/jpeg"] = "image/webp"
    size_web: int = Field(gt=0, le=6_000_000)
    size_thumb: int = Field(gt=0, le=600_000)


class PresignIn(BaseModel):
    files: list[FileIn] = Field(min_length=1, max_length=50)


class DoneIn(BaseModel):
    photo_id: UUID
    width: int = Field(gt=0, le=10000)
    height: int = Field(gt=0, le=10000)
    taken_at: datetime | None = None


class CompleteIn(BaseModel):
    photos: list[DoneIn] = Field(min_length=1, max_length=50)


def _check_open(ev: dict) -> None:
    if ev["status"] in ("expired", "deleted"):
        raise AppError("EVENT_CLOSED", 409)


@router.post("/presign")
async def presign(event_id: UUID, body: PresignIn, user=Depends(current_user), conn=Depends(get_conn)):
    ev = await require_member(conn, event_id, user["id"])
    _check_open(ev)
    plan = await (await conn.execute("SELECT max_photos FROM plans WHERE code = %s", (ev["plan_code"],))).fetchone()
    cur = await conn.execute(
        "SELECT count(*) AS n FROM photos WHERE event_id = %s AND status NOT IN ('failed', 'pending')", (event_id,)
    )
    remaining = plan["max_photos"] - (await cur.fetchone())["n"]

    results = []
    for f in body.files:
        cur = await conn.execute(
            "SELECT id, status FROM photos WHERE event_id = %s AND client_hash = %s", (event_id, f.client_hash)
        )
        existing = await cur.fetchone()
        if existing and existing["status"] not in ("pending", "failed"):
            results.append({"client_hash": f.client_hash, "duplicate": True})
            continue
        if remaining <= 0:
            results.append({"client_hash": f.client_hash, "error": "PHOTO_LIMIT"})
            continue
        if existing:
            photo_id = existing["id"]
            await conn.execute(
                "UPDATE photos SET status = 'pending', mime = %s, bytes_web = %s WHERE id = %s",
                (f.mime, f.size_web, photo_id),
            )
        else:
            cur = await conn.execute(
                """INSERT INTO photos (event_id, uploaded_by, client_hash, mime, bytes_web)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (event_id, client_hash) DO UPDATE SET mime = EXCLUDED.mime
                   RETURNING id""",
                (event_id, user["id"], f.client_hash, f.mime, f.size_web),
            )
            photo_id = (await cur.fetchone())["id"]
        remaining -= 1
        results.append({
            "client_hash": f.client_hash,
            "photo_id": str(photo_id),
            "web_url": presign_put(key_web(event_id, photo_id), f.mime),
            "thumb_url": presign_put(key_thumb(event_id, photo_id), f.mime),
        })
    return {"files": results, "remaining": max(remaining, 0)}


@router.post("/complete")
async def complete(
    event_id: UUID,
    body: CompleteIn,
    background_tasks: BackgroundTasks,
    user=Depends(current_user),
    conn=Depends(get_conn),
):
    ev = await require_member(conn, event_id, user["id"])
    _check_open(ev)
    done = []
    async with conn.transaction():
        for p in body.photos:
            cur = await conn.execute(
                """UPDATE photos SET status = 'uploaded', width = %s, height = %s, taken_at = %s
                   WHERE id = %s AND event_id = %s AND status = 'pending' RETURNING id""",
                (p.width, p.height, p.taken_at, p.photo_id, event_id),
            )
            if await cur.fetchone():
                done.append(str(p.photo_id))
        if done:
            await conn.execute(
                "UPDATE events SET status = 'processing' WHERE id = %s AND status IN ('draft', 'live')", (event_id,)
            )
    for photo_id in done:
        face_queue.enqueue("app.worker.jobs.index_photo", photo_id, job_timeout=300, retry=None)
        background_tasks.add_task(run_in_threadpool, index_photo, photo_id)
    return {"accepted": done}


@router.get("/progress")
async def progress(event_id: UUID, user=Depends(current_user), conn=Depends(get_conn)):
    ev = await require_member(conn, event_id, user["id"])
    cur = await conn.execute(
        "SELECT status, count(*) AS n FROM photos WHERE event_id = %s GROUP BY status", (event_id,)
    )
    counts = {r["status"]: r["n"] for r in await cur.fetchall()}
    return {"event_status": ev["status"], "counts": counts, "faces": ev["face_count"]}
