"""Guest profile face codes and per-event matching (always scoped to events the guest joined)."""
from app.core.crypto import decrypt_embedding, encrypt_embedding
from app.core.utils import sha256
from app.face.search import SEARCH_SQL

MATCH_SQL = (
    "INSERT INTO guest_matches (user_id, event_id, photo_id, distance) "
    "SELECT %(user_id)s, %(event_id)s, m.photo_id::uuid, m.d FROM (" + SEARCH_SQL + ") m "
    "ON CONFLICT (user_id, photo_id) DO NOTHING"
)


async def load_face(conn, user_id):
    row = await (await conn.execute("SELECT embedding_enc FROM guest_faces WHERE user_id = %s", (user_id,))).fetchone()
    return decrypt_embedding(row["embedding_enc"]) if row else None


async def store_face(conn, user_id, embedding, consent_version: str, lang: str, ip: str) -> None:
    async with conn.transaction():
        await conn.execute(
            """INSERT INTO guest_faces (user_id, embedding_enc, consent_version, consent_at)
               VALUES (%s, %s, %s, now())
               ON CONFLICT (user_id) DO UPDATE
               SET embedding_enc = EXCLUDED.embedding_enc, consent_version = EXCLUDED.consent_version,
                   consent_at = now(), updated_at = now()""",
            (user_id, encrypt_embedding(embedding), consent_version),
        )
        # A new face code replaces old automatic matches; the guest's own "Not me" choices stay
        await conn.execute("DELETE FROM guest_matches WHERE user_id = %s AND NOT hidden", (user_id,))
        await conn.execute(
            """INSERT INTO consent_log (user_id, action, version, lang, ip_hash)
               VALUES (%s, 'profile_consent', %s, %s, %s)""",
            (user_id, consent_version, lang, sha256(ip)),
        )


async def match_event(conn, user_id, event_id, embedding, threshold: float) -> int:
    cur = await conn.execute(
        MATCH_SQL, {"user_id": user_id, "event_id": event_id, "q": embedding, "cutoff": threshold}
    )
    return cur.rowcount or 0


async def rematch_all(conn, user_id, embedding) -> int:
    cur = await conn.execute(
        """SELECT e.id, e.match_threshold FROM guest_events ge JOIN events e ON e.id = ge.event_id
           WHERE ge.user_id = %s AND e.status IN ('live', 'processing')""",
        (user_id,),
    )
    total = 0
    for ev in await cur.fetchall():
        total += await match_event(conn, user_id, ev["id"], embedding, float(ev["match_threshold"]))
    return total
