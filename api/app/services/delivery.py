"""Photo URLs, shareable galleries and WhatsApp delivery links."""
import json
import secrets
from urllib.parse import quote

from app.core.config import settings
from app.core.errors import AppError
from app.core.redis import aredis
from app.core.storage import key_thumb, key_web, presign_get
from app.core.utils import event_code
from app.services import messaging

WA_REF_TTL = 86400


def photo_urls(event_id, photo_id: str, code: str) -> dict:
    photo_id = str(photo_id)
    return {
        "id": photo_id,
        "thumb": presign_get(key_thumb(event_id, photo_id)),
        "web": presign_get(key_web(event_id, photo_id)),
        "dl": presign_get(key_web(event_id, photo_id), download_name=f"GetMyPhotos-{code}-{photo_id[:8]}.jpg"),
    }


async def create_gallery(conn, event_id, photo_ids: list[str]) -> str:
    gid = secrets.token_urlsafe(12)
    await conn.execute(
        """INSERT INTO shared_galleries (id, event_id, photo_ids, expires_at)
           SELECT %s, e.id, %s::uuid[], LEAST(COALESCE(e.expires_at, 'infinity'), now() + interval '30 days')
           FROM events e WHERE e.id = %s""",
        (gid, photo_ids, event_id),
    )
    return gid


async def whatsapp_links(conn, event: dict, photo_ids: list[str], mode: str, wa_images: int) -> dict:
    """
    Direct mode (business number configured): guest taps a wa.me link that pre-fills "PHOTOS ABC123"
    to our number. Their message opens a free service window; the webhook replies with the gallery
    link and, if the plan allows, up to `wa_images` photos.
    Fallback: a wa.me share link with the gallery URL that the guest sends to themselves or family.
    """
    if not photo_ids:
        raise AppError("NO_PHOTOS", 400)
    gid = await create_gallery(conn, event["id"], photo_ids)
    gallery_url = f"{settings.guest_base_url}/g/{gid}"

    if messaging.wa_direct_enabled():
        ref = event_code(6)
        n_images = min(wa_images, len(photo_ids)) if mode == "images" else 0
        payload = {
            "title": event["title"],
            "gallery_url": gallery_url,
            "count": len(photo_ids),
            "event_id": str(event["id"]),
            "image_ids": [str(p) for p in photo_ids[:n_images]],
        }
        await aredis.set(f"wa:ref:{ref}", json.dumps(payload), ex=WA_REF_TTL)
        return {
            "wa_link": f"https://wa.me/{settings.wa_business_number}?text={quote('PHOTOS ' + ref)}",
            "gallery_url": gallery_url,
            "direct": True,
            "images": n_images,
        }

    text = f"📸 {event['title']} — meri photos: {gallery_url}"
    return {"wa_link": f"https://wa.me/?text={quote(text)}", "gallery_url": gallery_url, "direct": False, "images": 0}
