"""Plan pricing and applying successful payments. All writes are idempotent."""
from app.core.config import settings
from app.core.deps import require_member
from app.core.errors import AppError

ACTIVE_SUB_SQL = """
SELECT s.*, p.max_events, p.max_photos, p.retention_days
FROM subscriptions s JOIN plans p ON p.code = s.plan_code
WHERE s.user_id = %s AND s.ends_at > now()
ORDER BY s.ends_at DESC LIMIT 1
"""


async def active_subscription(conn, user_id) -> dict | None:
    return await (await conn.execute(ACTIVE_SUB_SQL, (user_id,))).fetchone()


async def get_plan(conn, code: str | None, kind: str | None = None) -> dict:
    plan = await (await conn.execute("SELECT * FROM plans WHERE code = %s AND active", (code,))).fetchone()
    if not plan or (kind and plan["kind"] != kind):
        raise AppError("BAD_PLAN", 400)
    return plan


async def attach_event(conn, event_id, sub: dict) -> None:
    """Move an event onto an annual subscription (uses one of its event slots)."""
    if sub["events_used"] >= sub["max_events"]:
        raise AppError("SUBSCRIPTION_EVENT_LIMIT", 402)
    await conn.execute(
        """UPDATE events SET plan_code = %(plan)s, subscription_id = %(sub)s,
               expires_at = CASE WHEN went_live_at IS NULL THEN NULL
                            ELSE LEAST(now() + interval '365 days', %(ends)s::timestamptz + interval '30 days') END
           WHERE id = %(event)s""",
        {"plan": sub["plan_code"], "sub": sub["id"], "ends": sub["ends_at"], "event": event_id},
    )
    await conn.execute("UPDATE subscriptions SET events_used = events_used + 1 WHERE id = %s", (sub["id"],))


async def quote(conn, user_id, purpose: str, plan_code: str | None, event_id) -> tuple[int, str, str | None]:
    """Return (amount_paise, description, plan_code) or raise if the purchase isn't allowed."""
    if purpose == "annual":
        plan = await get_plan(conn, plan_code, "annual")
        if event_id:
            ev = await require_member(conn, event_id, user_id, roles=("owner",))
            if ev["plan_code"] != "free":
                raise AppError("ALREADY_UPGRADED", 409)
        return plan["price_paise"], f"Photographer Annual ₹{plan['price_paise'] // 100}", plan["code"]

    if not event_id:
        raise AppError("EVENT_REQUIRED", 400)
    ev = await require_member(conn, event_id, user_id, roles=("owner",))
    if ev["status"] in ("expired", "deleted"):
        raise AppError("EVENT_CLOSED", 409)
    current = await get_plan(conn, ev["plan_code"])

    if purpose == "pass":
        plan = await get_plan(conn, plan_code, "pass")
        if current["kind"] == "free":
            amount = plan["price_paise"]
        elif current["kind"] == "pass" and plan["price_paise"] > current["price_paise"]:
            amount = plan["price_paise"] - current["price_paise"]  # pay only the difference
        else:
            raise AppError("ALREADY_UPGRADED", 409)
        return amount, f"Event Pass — {ev['title'][:40]}", plan["code"]

    if purpose == "extend":
        if current["kind"] != "pass" or ev["extended"]:
            raise AppError("EXTEND_NOT_ALLOWED", 409)
        return settings.extend_price_paise, f"1 saal tak photos — {ev['title'][:40]}", None

    raise AppError("BAD_PURPOSE", 400)


async def apply_payment(conn, order_id: str, payment_id: str) -> dict:
    async with conn.transaction():
        p = await (
            await conn.execute("SELECT * FROM payments WHERE razorpay_order_id = %s FOR UPDATE", (order_id,))
        ).fetchone()
        if not p:
            raise AppError("ORDER_NOT_FOUND", 404)
        if p["status"] == "paid":
            return p
        await conn.execute(
            "UPDATE payments SET status = 'paid', razorpay_payment_id = %s, paid_at = now() WHERE id = %s",
            (payment_id, p["id"]),
        )

        if p["purpose"] == "pass":
            await conn.execute(
                """UPDATE events e SET plan_code = p.code, subscription_id = NULL,
                       expires_at = CASE WHEN e.went_live_at IS NULL THEN NULL
                                    ELSE now() + make_interval(days => p.retention_days
                                         + CASE WHEN e.extended THEN %(extra)s ELSE 0 END) END
                   FROM plans p WHERE p.code = %(plan)s AND e.id = %(event)s""",
                {"plan": p["plan_code"], "event": p["event_id"], "extra": settings.extend_days},
            )

        elif p["purpose"] == "extend":
            await conn.execute(
                """UPDATE events SET extended = true,
                       expires_at = CASE WHEN expires_at IS NULL THEN NULL
                                    ELSE expires_at + make_interval(days => %s) END
                   WHERE id = %s""",
                (settings.extend_days, p["event_id"]),
            )

        elif p["purpose"] == "annual":
            sub = await (
                await conn.execute(
                    """INSERT INTO subscriptions (user_id, plan_code, starts_at, ends_at)
                       VALUES (%(user)s, %(plan)s, now(),
                               GREATEST(now(), COALESCE((SELECT max(ends_at) FROM subscriptions
                                                         WHERE user_id = %(user)s), now()))
                               + interval '1 year')
                       RETURNING *""",
                    {"user": p["user_id"], "plan": p["plan_code"]},
                )
            ).fetchone()
            # Renewal keeps existing annual events alive up to the new end date
            await conn.execute(
                """UPDATE events SET expires_at = LEAST(COALESCE(went_live_at, now()) + interval '365 days',
                                                       %s::timestamptz + interval '30 days')
                   WHERE owner_id = %s AND subscription_id IS NOT NULL AND status IN ('live', 'processing')
                     AND went_live_at IS NOT NULL""",
                (sub["ends_at"], p["user_id"]),
            )
            if p["event_id"]:
                full = await active_subscription(conn, p["user_id"])
                ev = await (await conn.execute("SELECT plan_code FROM events WHERE id = %s", (p["event_id"],))).fetchone()
                if full and ev and ev["plan_code"] == "free":
                    await attach_event(conn, p["event_id"], full)
        return p
