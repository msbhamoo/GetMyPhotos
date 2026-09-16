import json
import logging
import secrets
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel

from app.core.config import settings
from app.core.db import get_conn
from app.core.deps import current_user
from app.core.errors import AppError
from app.services import razorpay
from app.services.billing import active_subscription, apply_payment, quote

router = APIRouter(tags=["billing"])
log = logging.getLogger("gmp.billing")


class OrderIn(BaseModel):
    purpose: Literal["pass", "annual", "extend"]
    plan_code: str | None = None
    event_id: UUID | None = None


class VerifyIn(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@router.get("/billing/plans")
async def plans(conn=Depends(get_conn)):
    cur = await conn.execute("SELECT * FROM plans WHERE active ORDER BY kind, price_paise")
    return {
        "plans": await cur.fetchall(),
        "extend": {"price_paise": settings.extend_price_paise, "days": settings.extend_days},
    }


@router.get("/billing/me")
async def my_billing(user=Depends(current_user), conn=Depends(get_conn)):
    sub = await active_subscription(conn, user["id"])
    cur = await conn.execute(
        """SELECT p.id, p.purpose, p.plan_code, p.amount_paise, p.status, p.created_at, p.paid_at,
                  e.title AS event_title
           FROM payments p LEFT JOIN events e ON e.id = p.event_id
           WHERE p.user_id = %s AND p.status <> 'created'
           ORDER BY p.created_at DESC LIMIT 50""",
        (user["id"],),
    )
    return {"subscription": sub, "payments": await cur.fetchall()}


@router.post("/billing/orders")
async def create_order(body: OrderIn, user=Depends(current_user), conn=Depends(get_conn)):
    amount, description, plan_code = await quote(conn, user["id"], body.purpose, body.plan_code, body.event_id)
    receipt = secrets.token_hex(8)
    notes = {"user_id": str(user["id"]), "purpose": body.purpose, "event_id": str(body.event_id or "")}

    if razorpay.enabled():
        order_id, dev = await razorpay.create_order(amount, receipt, notes), False
    elif settings.is_dev:
        order_id, dev = f"dev_{receipt}", True
    else:
        raise AppError("PAYMENTS_DISABLED", 503)

    await conn.execute(
        """INSERT INTO payments (user_id, event_id, purpose, plan_code, amount_paise, razorpay_order_id, notes)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (user["id"], body.event_id, body.purpose, plan_code, amount, order_id, json.dumps(notes)),
    )
    return {
        "order_id": order_id,
        "amount": amount,
        "currency": "INR",
        "key_id": settings.razorpay_key_id,
        "description": description,
        "phone": user["phone"],
        "dev": dev,
    }


@router.post("/billing/verify")
async def verify(body: VerifyIn, user=Depends(current_user), conn=Depends(get_conn)):
    row = await (
        await conn.execute(
            "SELECT user_id FROM payments WHERE razorpay_order_id = %s", (body.razorpay_order_id,)
        )
    ).fetchone()
    if not row or row["user_id"] != user["id"]:
        raise AppError("ORDER_NOT_FOUND", 404)

    simulated = body.razorpay_order_id.startswith("dev_") and settings.is_dev and not razorpay.enabled()
    if not simulated and not razorpay.verify_checkout(
        body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature
    ):
        raise AppError("PAYMENT_SIGNATURE_INVALID", 400)

    p = await apply_payment(conn, body.razorpay_order_id, body.razorpay_payment_id)
    return {"ok": True, "purpose": p["purpose"], "event_id": p["event_id"]}


@router.post("/webhooks/razorpay")
async def razorpay_webhook(
    request: Request, x_razorpay_signature: str | None = Header(None), conn=Depends(get_conn)
):
    body = await request.body()
    if not razorpay.verify_webhook(body, x_razorpay_signature):
        raise AppError("BAD_SIGNATURE", 400)
    data = json.loads(body)
    event = data.get("event")
    payload = data.get("payload", {})

    if event in ("payment.captured", "order.paid"):
        entity = payload.get("payment", {}).get("entity", {})
        try:
            await apply_payment(conn, entity["order_id"], entity["id"])
        except AppError as e:
            if e.code != "ORDER_NOT_FOUND":
                raise
            log.warning("webhook for unknown order %s", entity.get("order_id"))
    elif event == "refund.processed":
        payment_id = payload.get("refund", {}).get("entity", {}).get("payment_id")
        await conn.execute(
            "UPDATE payments SET status = 'refunded' WHERE razorpay_payment_id = %s", (payment_id,)
        )
    return {"ok": True}
