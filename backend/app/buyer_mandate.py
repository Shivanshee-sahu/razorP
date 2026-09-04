"""
Buyer Mandate Service

Controls what the AI Buyer is authorized to do autonomously.

The mandate is separate from merchant policy:
- Buyer mandate = what the customer allows the AI to do.
- Merchant policy = what the merchant allows the AI to do.
"""

import json
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException

from app.db import connect


# ============================================================
# TIME
# ============================================================

def now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ============================================================
# CREATE MANDATE
# ============================================================

def create_mandate(
    cart_id: str,
    max_order_amount: int,
    max_item_price: int | None = None,
    max_daily_spend: int | None = None,
    allowed_categories: list[str] | None = None,
    auto_pay_enabled: bool = False,
    expires_at: str | None = None,
) -> dict:

    if max_order_amount <= 0:
        raise ValueError("max_order_amount must be greater than 0")

    if max_item_price is not None and max_item_price <= 0:
        raise ValueError("max_item_price must be greater than 0")

    if max_daily_spend is not None and max_daily_spend <= 0:
        raise ValueError("max_daily_spend must be greater than 0")

    mandate_id = f"mandate_{uuid4().hex[:12]}"
    timestamp = now()

    categories_json = json.dumps(
        allowed_categories or []
    )

    with connect() as conn:

        # Make sure cart exists
        cart = conn.execute(
            "SELECT id FROM carts WHERE id=?",
            (cart_id,)
        ).fetchone()

        if not cart:
            raise HTTPException(
                status_code=404,
                detail=f"Cart '{cart_id}' not found"
            )

        conn.execute(
            """
            INSERT INTO buyer_mandates (
                id,
                cart_id,
                enabled,
                max_order_amount,
                max_item_price,
                max_daily_spend,
                allowed_categories,
                auto_pay_enabled,
                expires_at,
                created_at,
                updated_at
            )
            VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                mandate_id,
                cart_id,
                max_order_amount,
                max_item_price,
                max_daily_spend,
                categories_json,
                1 if auto_pay_enabled else 0,
                expires_at,
                timestamp,
                timestamp,
            )
        )

    return get_mandate(mandate_id)


# ============================================================
# GET MANDATE
# ============================================================

def get_mandate(mandate_id: str) -> dict:

    with connect() as conn:

        row = conn.execute(
            """
            SELECT *
            FROM buyer_mandates
            WHERE id=?
            """,
            (mandate_id,)
        ).fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Buyer mandate not found"
        )

    mandate = dict(row)

    try:
        mandate["allowed_categories"] = json.loads(
            mandate.get("allowed_categories") or "[]"
        )
    except Exception:
        mandate["allowed_categories"] = []

    mandate["enabled"] = bool(mandate["enabled"])
    mandate["auto_pay_enabled"] = bool(
        mandate["auto_pay_enabled"]
    )

    return mandate


# ============================================================
# GET ACTIVE MANDATE FOR CART
# ============================================================

def get_cart_mandate(cart_id: str) -> dict | None:

    with connect() as conn:

        row = conn.execute(
            """
            SELECT *
            FROM buyer_mandates
            WHERE cart_id=?
              AND enabled=1
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (cart_id,)
        ).fetchone()

    if not row:
        return None

    mandate = dict(row)

    try:
        mandate["allowed_categories"] = json.loads(
            mandate.get("allowed_categories") or "[]"
        )
    except Exception:
        mandate["allowed_categories"] = []

    mandate["enabled"] = bool(mandate["enabled"])
    mandate["auto_pay_enabled"] = bool(
        mandate["auto_pay_enabled"]
    )

    return mandate


# ============================================================
# ENABLE MANDATE
# ============================================================

def enable_mandate(mandate_id: str) -> dict:

    with connect() as conn:

        result = conn.execute(
            """
            UPDATE buyer_mandates
            SET enabled=1,
                updated_at=?
            WHERE id=?
            """,
            (now(), mandate_id)
        )

        if result.rowcount == 0:
            raise HTTPException(
                status_code=404,
                detail="Buyer mandate not found"
            )

    return get_mandate(mandate_id)


# ============================================================
# DISABLE MANDATE
# ============================================================

def disable_mandate(mandate_id: str) -> dict:

    with connect() as conn:

        result = conn.execute(
            """
            UPDATE buyer_mandates
            SET enabled=0,
                updated_at=?
            WHERE id=?
            """,
            (now(), mandate_id)
        )

        if result.rowcount == 0:
            raise HTTPException(
                status_code=404,
                detail="Buyer mandate not found"
            )

    return get_mandate(mandate_id)


# ============================================================
# EXPIRATION CHECK
# ============================================================

def check_expiration(mandate: dict) -> tuple[bool, str]:

    expires_at = mandate.get("expires_at")

    if not expires_at:
        return True, "Mandate has no expiration."

    try:
        expiry = datetime.fromisoformat(
            expires_at.replace("Z", "+00:00")
        )

        if expiry.tzinfo is None:
            expiry = expiry.replace(
                tzinfo=timezone.utc
            )

        if datetime.now(timezone.utc) >= expiry:
            return False, "Buyer mandate has expired."

    except ValueError:
        return False, "Buyer mandate has an invalid expiration date."

    return True, "Mandate is active."


# ============================================================
# DAILY SPENDING
# ============================================================

def get_daily_spend(cart_id: str) -> int:

    today = datetime.now(
        timezone.utc
    ).date().isoformat()

    with connect() as conn:

        row = conn.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM orders
            WHERE cart_id=?
              AND status='PAID'
              AND substr(created_at, 1, 10)=?
            """,
            (cart_id, today)
        ).fetchone()

    return int(row["total"] or 0)


# ============================================================
# CATEGORY CHECK
# ============================================================

def validate_categories(
    mandate: dict,
    categories: list[str]
) -> tuple[bool, str]:

    allowed = mandate.get("allowed_categories") or []

    # Empty list means all categories are allowed.
    if not allowed:
        return True, "No category restriction configured."

    allowed_normalized = {
        str(category).strip().lower()
        for category in allowed
    }

    for category in categories:

        normalized = str(
            category or ""
        ).strip().lower()

        if normalized not in allowed_normalized:
            return (
                False,
                f"Category '{category}' is not allowed by buyer mandate."
            )

    return True, "All categories are allowed."


# ============================================================
# COMPLETE MANDATE VALIDATION
# ============================================================

def validate_mandate(
    mandate: dict,
    amount: int,
    categories: list[str] | None = None,
    item_prices: list[int] | None = None,
) -> dict:

    violations = []

    # --------------------------------------------------------
    # ENABLED
    # --------------------------------------------------------

    if not mandate.get("enabled"):
        violations.append(
            "Buyer mandate is disabled."
        )

    # --------------------------------------------------------
    # EXPIRATION
    # --------------------------------------------------------

    valid_expiry, expiry_reason = check_expiration(
        mandate
    )

    if not valid_expiry:
        violations.append(expiry_reason)

    # --------------------------------------------------------
    # AUTO PAYMENT
    # --------------------------------------------------------

    if not mandate.get("auto_pay_enabled"):
        violations.append(
            "Autonomous payment is not enabled."
        )

    # --------------------------------------------------------
    # MAX ORDER AMOUNT
    # --------------------------------------------------------

    max_order_amount = mandate.get(
        "max_order_amount"
    )

    if (
        max_order_amount is not None
        and amount > max_order_amount
    ):
        violations.append(
            f"Order amount ₹{amount:,} exceeds "
            f"mandate limit ₹{max_order_amount:,}."
        )

    # --------------------------------------------------------
    # MAX ITEM PRICE
    # --------------------------------------------------------

    max_item_price = mandate.get(
        "max_item_price"
    )

    if max_item_price is not None:

        for price in item_prices or []:

            if price > max_item_price:
                violations.append(
                    f"Item price ₹{price:,} exceeds "
                    f"mandate item limit ₹{max_item_price:,}."
                )

    # --------------------------------------------------------
    # CATEGORY
    # --------------------------------------------------------

    category_ok, category_reason = validate_categories(
        mandate,
        categories or []
    )

    if not category_ok:
        violations.append(category_reason)

    # --------------------------------------------------------
    # DAILY SPENDING
    # --------------------------------------------------------

    max_daily_spend = mandate.get(
        "max_daily_spend"
    )

    if max_daily_spend is not None:

        current_daily_spend = get_daily_spend(
            mandate["cart_id"]
        )

        if (
            current_daily_spend + amount
            > max_daily_spend
        ):
            violations.append(
                f"Daily spending limit exceeded. "
                f"Already spent ₹{current_daily_spend:,}; "
                f"this order would reach "
                f"₹{current_daily_spend + amount:,}, "
                f"while the limit is ₹{max_daily_spend:,}."
            )

    # --------------------------------------------------------
    # FINAL RESULT
    # --------------------------------------------------------

    if violations:

        return {
            "approved": False,
            "status": "MANDATE_REJECTED",
            "violations": violations,
        }

    return {
        "approved": True,
        "status": "MANDATE_APPROVED",
        "violations": [],
    }