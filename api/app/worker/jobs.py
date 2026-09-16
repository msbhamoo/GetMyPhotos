"""RQ jobs. Run with: rq worker face media notify default -w rq.worker.SimpleWorker --with-scheduler"""
import io
import logging
import os
import tempfile
import zipfile
from datetime import timedelta

from PIL import Image
from rq import Queue

from app.core import storage
from app.core.config import settings
from app.core.crypto import decrypt_embedding
from app.core.redis import sync_redis
from app.face.engine import decode_image, get_engine
from app.services import messaging
from app.services.profiles import MATCH_SQL
from app.worker.db import pool

log = logging.getLogger("gmp.worker")
MATCH_DEBOUNCE_SECONDS = 60


def _finalize_event(conn, event_id) -> None:
    """Flip processing → live once nothing is waiting; start the retention clock on first go-live."""
    conn.execute(
        """UPDATE events e SET status = 'live', went_live_at = COALESCE(e.went_live_at, now()),
               expires_at = COALESCE(e.expires_at, LEAST(
                   now() + make_interval(days => p.retention_days
                                         + CASE WHEN e.extended THEN %(extra)s ELSE 0 END),
                   COALESCE((SELECT s.ends_at + interval '30 days' FROM subscriptions s
                             WHERE s.id = e.subscription_id), 'infinity'::timestamptz)))
           FROM plans p
           WHERE e.id = %(event)s AND p.code = e.plan_code AND e.status = 'processing'
             AND NOT EXISTS (SELECT 1 FROM photos
                             WHERE event_id = e.id AND status IN ('uploaded', 'processing'))""",
        {"event": event_id, "extra": settings.extend_days},
    )


def _schedule_profile_matching(conn, event_id) -> None:
    """Debounced: one matching run per event per minute while photos keep arriving."""
    if not conn.execute("SELECT 1 FROM guest_events WHERE event_id = %s LIMIT 1", (event_id,)).fetchone():
        return
    r = sync_redis()
    if r.set(f"match:debounce:{event_id}", 1, nx=True, ex=MATCH_DEBOUNCE_SECONDS):
        Queue("default", connection=r).enqueue_in(
            timedelta(seconds=MATCH_DEBOUNCE_SECONDS), "app.worker.jobs.match_event_profiles", str(event_id)
        )


def index_photo(photo_id: str) -> int:
    with pool.connection() as conn:
        p = conn.execute(
            """SELECT p.id, p.event_id, p.status, e.status AS event_status
               FROM photos p JOIN events e ON e.id = p.event_id WHERE p.id = %s""",
            (photo_id,),
        ).fetchone()
        if not p or p["status"] not in ("uploaded", "processing"):
            return 0
        if p["event_status"] in ("expired", "deleted"):
            return 0
        conn.execute("UPDATE photos SET status = 'processing' WHERE id = %s", (photo_id,))

        try:
            img = decode_image(storage.get_bytes(storage.key_web(p["event_id"], photo_id)), max_side=1600)
            faces = get_engine().detect(img)
        except Exception:
            log.exception("index failed for photo %s", photo_id)
            conn.execute("UPDATE photos SET status = 'failed' WHERE id = %s", (photo_id,))
            _finalize_event(conn, p["event_id"])
            return 0

        with conn.transaction():
            conn.execute("DELETE FROM faces WHERE photo_id = %s", (photo_id,))
            with conn.cursor() as cur:
                cur.executemany(
                    """INSERT INTO faces (event_id, photo_id, bbox, det_score, quality, embedding)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    [(p["event_id"], photo_id, f.bbox, f.det_score, f.size_px, f.embedding) for f in faces],
                )
            conn.execute(
                "UPDATE photos SET status = 'done', face_count = %s WHERE id = %s", (len(faces), photo_id)
            )
            conn.execute(
                """UPDATE events SET photo_count = photo_count + 1, face_count = face_count + %s,
                       cover_photo_id = COALESCE(cover_photo_id, %s)
                   WHERE id = %s""",
                (len(faces), photo_id, p["event_id"]),
            )
        _finalize_event(conn, p["event_id"])
        if faces:
            _schedule_profile_matching(conn, p["event_id"])
        return len(faces)


def match_event_profiles(event_id: str) -> int:
    """Match every profile guest who joined this event against its photos; notify about new ones."""
    total = 0
    with pool.connection() as conn:
        ev = conn.execute(
            "SELECT id, code::text AS code, title, match_threshold, status FROM events WHERE id = %s", (event_id,)
        ).fetchone()
        if not ev or ev["status"] not in ("live", "processing"):
            return 0
        guests = conn.execute(
            """SELECT ge.user_id, ge.last_notified_at, gf.embedding_enc, u.phone, u.lang
               FROM guest_events ge
               JOIN guest_faces gf ON gf.user_id = ge.user_id
               JOIN users u ON u.id = ge.user_id AND u.deleted_at IS NULL
               WHERE ge.event_id = %s""",
            (event_id,),
        ).fetchall()
        for g in guests:
            cur = conn.execute(
                MATCH_SQL,
                {
                    "user_id": g["user_id"],
                    "event_id": event_id,
                    "q": decrypt_embedding(g["embedding_enc"]),
                    "cutoff": float(ev["match_threshold"]),
                },
            )
            new = cur.rowcount or 0
            total += new
            if new and messaging.wa_enabled():
                row = conn.execute(
                    """UPDATE guest_events SET last_notified_at = now()
                       WHERE user_id = %s AND event_id = %s
                         AND (last_notified_at IS NULL OR last_notified_at < now() - interval '24 hours')
                       RETURNING 1""",
                    (g["user_id"], event_id),
                ).fetchone()
                if row:
                    url = f"{settings.guest_base_url}/me/e/{event_id}"
                    msg_id = messaging.wa_template(
                        g["phone"], settings.wa_new_photos_template, g["lang"], [ev["title"], new, url]
                    )
                    _log_wa(conn, g["phone"], "new_photos", msg_id, event_id, g["user_id"])
    return total


def build_zip(event_id: str, code: str, photo_ids: list[str], cache_key: str) -> str:
    fd, path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    try:
        # Photos are already compressed, so store without re-deflating
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as zf:
            for i, pid in enumerate(photo_ids, 1):
                try:
                    data = storage.get_bytes(storage.key_web(event_id, pid))
                except Exception:
                    log.warning("zip: missing object for photo %s", pid)
                    continue
                ext = "webp" if data[8:12] == b"WEBP" else "jpg"
                zf.writestr(f"GetMyPhotos-{code}-{i:03d}.{ext}", data)
        key = storage.key_zip(event_id, cache_key)
        storage.upload_file(path, key, "application/zip")
        return storage.presign_get(key, expires=86400, download_name=f"GetMyPhotos-{code}.zip")
    finally:
        os.remove(path)


def _to_jpeg(data: bytes) -> bytes:
    img = Image.open(io.BytesIO(data)).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85, optimize=True)
    return buf.getvalue()


def _log_wa(conn, phone, kind, msg_id, event_id=None, user_id=None) -> None:
    conn.execute(
        """INSERT INTO wa_messages (user_id, phone, event_id, kind, wa_msg_id, status)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (user_id, phone, event_id, kind, msg_id, "sent" if msg_id else "failed"),
    )


def send_wa_gallery(phone: str, ref: dict) -> None:
    """Runs inside the guest-initiated 24h service window, so free-form messages are allowed."""
    text = (
        f"📸 {ref['title']}\n"
        f"Aapki {ref['count']} photos yahan hain 👇\n{ref['gallery_url']}\n\n"
        "— GetMyPhotos"
    )
    with pool.connection() as conn:
        _log_wa(conn, phone, "gallery_link", messaging.wa_text(phone, text), ref["event_id"])
        for pid in ref.get("image_ids", []):
            try:
                jpeg = _to_jpeg(storage.get_bytes(storage.key_web(ref["event_id"], pid)))
            except Exception:
                log.warning("wa image: cannot load photo %s", pid)
                continue
            _log_wa(conn, phone, "image", messaging.wa_image(phone, jpeg), ref["event_id"])


def send_wa_help(phone: str) -> None:
    messaging.wa_text(
        phone,
        "Namaste 🙏 Photos paane ke liye GetMyPhotos page pe “WhatsApp pe bhejo” button dabayein, "
        "phir yahan aaya message Send karein.",
    )


def send_invite(phone: str, lang: str, inviter: str, title: str, url: str) -> None:
    msg_id = messaging.wa_template(phone, settings.wa_invite_template, lang, [inviter, title, url])
    with pool.connection() as conn:
        _log_wa(conn, phone, "invite", msg_id)


def purge_event(event_id: str) -> None:
    """Delete every photo, face and file of an event. Keeps the event row for history."""
    removed = storage.delete_prefix(f"events/{event_id}/")
    with pool.connection() as conn, conn.transaction():
        conn.execute("DELETE FROM shared_galleries WHERE event_id = %s", (event_id,))
        conn.execute("DELETE FROM guest_matches WHERE event_id = %s", (event_id,))
        conn.execute("DELETE FROM faces WHERE event_id = %s", (event_id,))
        conn.execute("DELETE FROM reports WHERE event_id = %s", (event_id,))
        conn.execute("DELETE FROM photos WHERE event_id = %s", (event_id,))
        conn.execute("UPDATE events SET cover_photo_id = NULL, face_count = 0 WHERE id = %s", (event_id,))
    log.info("purged event %s (%d objects)", event_id, removed)
