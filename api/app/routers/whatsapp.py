"""Inbound WhatsApp: guest sends "PHOTOS ABC123" → we reply with their gallery (and photos)."""
import json
import logging

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import PlainTextResponse

from app.core.config import settings
from app.core.errors import AppError
from app.core.redis import aredis, notify_queue
from app.core.utils import mask_phone, parse_wa_ref, signature_ok

router = APIRouter(tags=["whatsapp"])
log = logging.getLogger("gmp.whatsapp")


@router.get("/webhooks/whatsapp")
async def verify(
    mode: str = Query(None, alias="hub.mode"),
    token: str = Query(None, alias="hub.verify_token"),
    challenge: str = Query("", alias="hub.challenge"),
):
    if mode == "subscribe" and settings.wa_verify_token and token == settings.wa_verify_token:
        return PlainTextResponse(challenge)
    raise AppError("FORBIDDEN", 403)


@router.post("/webhooks/whatsapp")
async def inbound(request: Request, x_hub_signature_256: str | None = Header(None)):
    body = await request.body()
    signature = (x_hub_signature_256 or "").removeprefix("sha256=")
    if not signature_ok(settings.wa_app_secret, body, signature):
        raise AppError("BAD_SIGNATURE", 400)

    data = json.loads(body)
    for entry in data.get("entry", []):
        for change in entry.get("changes", []):
            for msg in change.get("value", {}).get("messages", []) or []:
                phone = "+" + msg.get("from", "")
                text = (msg.get("text") or {}).get("body", "") if msg.get("type") == "text" else ""
                # One reply burst per phone per minute is plenty; ignore floods
                if not await aredis.set(f"wa:inbound:{phone}:{text[:40]}", 1, nx=True, ex=60):
                    continue
                ref = parse_wa_ref(text)
                payload = await aredis.get(f"wa:ref:{ref}") if ref else None
                if payload:
                    notify_queue.enqueue("app.worker.jobs.send_wa_gallery", phone, json.loads(payload), job_timeout=600)
                else:
                    log.info("WA message without valid ref from %s", mask_phone(phone))
                    notify_queue.enqueue("app.worker.jobs.send_wa_help", phone)
    return {"ok": True}
