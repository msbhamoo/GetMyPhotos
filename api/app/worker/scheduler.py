"""Periodic maintenance loop: retention expiry, abandoned uploads, old ZIPs."""
import logging
import time

from rq import Queue

from app.core import storage
from app.core.redis import sync_redis
from app.worker.db import pool

log = logging.getLogger("gmp.scheduler")
INTERVAL = 3600


def expire_events(queue: Queue) -> None:
    with pool.connection() as conn:
        rows = conn.execute(
            """UPDATE events SET status = 'expired'
               WHERE status IN ('live', 'processing') AND expires_at < now()
               RETURNING id""",
        ).fetchall()
    for r in rows:
        queue.enqueue("app.worker.jobs.purge_event", str(r["id"]), job_timeout=1800)
    if rows:
        log.info("expired %d events", len(rows))


def cleanup_pending() -> None:
    """Presigned but never completed uploads older than a day."""
    with pool.connection() as conn:
        rows = conn.execute(
            """DELETE FROM photos WHERE status = 'pending' AND created_at < now() - interval '1 day'
               RETURNING id, event_id""",
        ).fetchall()
    for r in rows:
        storage.delete_prefix(storage.key_web(r["event_id"], r["id"]))
        storage.delete_prefix(storage.key_thumb(r["event_id"], r["id"]))


def cleanup_galleries() -> None:
    with pool.connection() as conn:
        conn.execute("DELETE FROM shared_galleries WHERE expires_at < now()")


def cleanup_zips() -> None:
    with pool.connection() as conn:
        events = conn.execute(
            "SELECT id FROM events WHERE status IN ('live', 'processing')"
        ).fetchall()
    cutoff = time.time() - 86400
    for ev in events:
        prefix = f"events/{ev['id']}/zip/"
        paginator = storage._internal.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=storage.BUCKET, Prefix=prefix):
            for obj in page.get("Contents", []):
                if obj["LastModified"].timestamp() < cutoff:
                    storage._internal.delete_object(Bucket=storage.BUCKET, Key=obj["Key"])


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    queue = Queue("default", connection=sync_redis())
    while True:
        for task in (lambda: expire_events(queue), cleanup_pending, cleanup_galleries, cleanup_zips):
            try:
                task()
            except Exception:
                log.exception("scheduler task failed")
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
