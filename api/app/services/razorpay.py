import httpx

from app.core.config import settings
from app.core.errors import AppError
from app.core.utils import signature_ok


def enabled() -> bool:
    return bool(settings.razorpay_key_id and settings.razorpay_key_secret)


async def create_order(amount_paise: int, receipt: str, notes: dict) -> str:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                "https://api.razorpay.com/v1/orders",
                auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
                json={"amount": amount_paise, "currency": "INR", "receipt": receipt, "notes": notes},
            )
    except httpx.HTTPError:
        raise AppError("PAYMENT_PROVIDER_ERROR", 502)
    if r.status_code >= 300:
        raise AppError("PAYMENT_PROVIDER_ERROR", 502)
    return r.json()["id"]


def verify_checkout(order_id: str, payment_id: str, signature: str) -> bool:
    return signature_ok(settings.razorpay_key_secret, f"{order_id}|{payment_id}", signature)


def verify_webhook(body: bytes, signature: str | None) -> bool:
    return signature_ok(settings.razorpay_webhook_secret, body, signature)
