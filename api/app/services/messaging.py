"""Outbound WhatsApp (Meta Cloud API) and SMS (MSG91) senders.

Async helpers are used by the API (OTP); sync helpers by RQ workers.
"""
import logging

import httpx

from app.core.config import settings
from app.core.utils import mask_phone

log = logging.getLogger("gmp.messaging")
GRAPH = "https://graph.facebook.com/v21.0"


def wa_enabled() -> bool:
    return bool(settings.wa_token and settings.wa_phone_number_id)


def wa_direct_enabled() -> bool:
    """Guests can message our business number to receive photos."""
    return wa_enabled() and bool(settings.wa_business_number)


def sms_enabled() -> bool:
    return bool(settings.msg91_auth_key and settings.msg91_template_id)


def _to(phone: str) -> str:
    return phone.lstrip("+")


def _template(name: str, lang: str, params: list, button_param: str | None = None) -> dict:
    components = [{"type": "body", "parameters": [{"type": "text", "text": str(p)} for p in params]}]
    if button_param is not None:
        components.append(
            {"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": button_param}]}
        )
    return {"type": "template", "template": {"name": name, "language": {"code": lang}, "components": components}}


# ---------- async (API) ----------
async def send_wa_otp(phone: str, code: str, lang: str) -> bool:
    body = {"messaging_product": "whatsapp", "to": _to(phone), **_template(settings.wa_otp_template, lang, [code], code)}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.post(
                f"{GRAPH}/{settings.wa_phone_number_id}/messages",
                json=body,
                headers={"Authorization": f"Bearer {settings.wa_token}"},
            )
        if r.status_code >= 300:
            log.warning("WA OTP failed for %s: %s", mask_phone(phone), r.text[:300])
            return False
        return True
    except httpx.HTTPError as e:
        log.warning("WA OTP error for %s: %s", mask_phone(phone), e)
        return False


async def send_sms_otp(phone: str, code: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.post(
                "https://control.msg91.com/api/v5/otp",
                params={"template_id": settings.msg91_template_id, "mobile": _to(phone), "otp": code},
                headers={"authkey": settings.msg91_auth_key},
            )
        ok = r.status_code < 300 and r.json().get("type") == "success"
        if not ok:
            log.warning("SMS OTP failed for %s: %s", mask_phone(phone), r.text[:300])
        return ok
    except (httpx.HTTPError, ValueError) as e:
        log.warning("SMS OTP error for %s: %s", mask_phone(phone), e)
        return False


# ---------- sync (workers) ----------
def _client() -> httpx.Client:
    return httpx.Client(timeout=20, headers={"Authorization": f"Bearer {settings.wa_token}"})


def wa_send(phone: str, payload: dict) -> str | None:
    """Returns the WhatsApp message id, or None on failure."""
    if not wa_enabled():
        log.info("WA disabled; would send %s to %s", payload.get("type"), mask_phone(phone))
        return None
    body = {"messaging_product": "whatsapp", "to": _to(phone), **payload}
    try:
        with _client() as c:
            r = c.post(f"{GRAPH}/{settings.wa_phone_number_id}/messages", json=body)
        if r.status_code >= 300:
            log.warning("WA %s failed for %s: %s", payload.get("type"), mask_phone(phone), r.text[:300])
            return None
        return (r.json().get("messages") or [{}])[0].get("id")
    except httpx.HTTPError as e:
        log.warning("WA error for %s: %s", mask_phone(phone), e)
        return None


def wa_text(phone: str, text: str) -> str | None:
    return wa_send(phone, {"type": "text", "text": {"body": text, "preview_url": True}})


def wa_template(phone: str, name: str, lang: str, params: list) -> str | None:
    return wa_send(phone, _template(name, lang, params))


def wa_image(phone: str, jpeg: bytes, caption: str | None = None) -> str | None:
    """Upload a JPEG to WhatsApp media, then send it. (WhatsApp does not accept WebP photos.)"""
    if not wa_enabled():
        return None
    try:
        with _client() as c:
            r = c.post(
                f"{GRAPH}/{settings.wa_phone_number_id}/media",
                data={"messaging_product": "whatsapp", "type": "image/jpeg"},
                files={"file": ("photo.jpg", jpeg, "image/jpeg")},
            )
        if r.status_code >= 300:
            log.warning("WA media upload failed: %s", r.text[:300])
            return None
        image = {"id": r.json()["id"]}
    except httpx.HTTPError as e:
        log.warning("WA media error: %s", e)
        return None
    if caption:
        image["caption"] = caption
    return wa_send(phone, {"type": "image", "image": image})
