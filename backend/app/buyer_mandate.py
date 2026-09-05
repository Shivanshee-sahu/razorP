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
        raise ValueError(
            "max_order_amount must be greater than 0"
        )

    if max_item_price is not None and max_item_price <= 0:
        raise ValueError(
            "max_item_price must be greater than 0"
        )

    if max_daily_spend is not None and max_daily_spend <= 0:
        raise ValueError(
            "max_daily_spend must be greater than 0"
        )

    mandate_id = f"mandate_{uuid4().hex[:12]}"
    timestamp = now()

    categories_json = json.dumps(
        allowed_categories or []
    )

    with connect() as conn:

        # ----------------------------------------------------
        # MAKE SURE CART EXISTS
        # ----------------------------------------------------

        cart = conn.execute(
            """
            SELECT id
            FROM carts
            WHERE id=?
            """,
            (cart_id,)
        ).fetchone()

        if not cart:
            raise HTTPException(
                status_code=404,
                detail=f"Cart '{cart_id}' not found"
            )

        # ----------------------------------------------------
        # CREATE MANDATE
        # ----------------------------------------------------

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

    # --------------------------------------------------------
    # PARSE CATEGORIES
    # --------------------------------------------------------

    try:
        mandate["allowed_categories"] = json.loads(
            mandate.get("allowed_categories") or "[]"
        )
    except Exception:
        mandate["allowed_categories"] = []

    # --------------------------------------------------------
    # NORMALIZE BOOLEAN VALUES
    # --------------------------------------------------------

    mandate["enabled"] = bool(
        mandate.get("enabled")
    )

    mandate["auto_pay_enabled"] = bool(
        mandate.get("auto_pay_enabled")
    )

    return mandate


# ============================================================
# GET ACTIVE MANDATE FOR CART
# ============================================================

def get_cart_mandate(
    cart_id: str
) -> dict | None:

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

    # --------------------------------------------------------
    # PARSE CATEGORIES
    # --------------------------------------------------------

    try:
        mandate["allowed_categories"] = json.loads(
            mandate.get("allowed_categories") or "[]"
        )
    except Exception:
        mandate["allowed_categories"] = []

    # --------------------------------------------------------
    # NORMALIZE BOOLEAN VALUES
    # --------------------------------------------------------

    mandate["enabled"] = bool(
        mandate.get("enabled")
    )

    mandate["auto_pay_enabled"] = bool(
        mandate.get("auto_pay_enabled")
    )

    return mandate


# ============================================================
# ENABLE MANDATE
# ============================================================

def enable_mandate(
    mandate_id: str
) -> dict:

    with connect() as conn:

        result = conn.execute(
            """
            UPDATE buyer_mandates
            SET enabled=1,
                updated_at=?
            WHERE id=?
            """,
            (
                now(),
                mandate_id
            )
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

def disable_mandate(
    mandate_id: str
) -> dict:

    with connect() as conn:

        result = conn.execute(
            """
            UPDATE buyer_mandates
            SET enabled=0,
                updated_at=?
            WHERE id=?
            """,
            (
                now(),
                mandate_id
            )
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

def check_expiration(
    mandate: dict
) -> tuple[bool, str]:

    expires_at = mandate.get("expires_at")

    # No expiration configured
    if not expires_at:
        return True, "Mandate has no expiration."

    try:

        expiry = datetime.fromisoformat(
            str(expires_at).replace(
                "Z",
                "+00:00"
            )
        )

        # Treat timezone-less timestamps as UTC
        if expiry.tzinfo is None:
            expiry = expiry.replace(
                tzinfo=timezone.utc
            )

        if datetime.now(timezone.utc) >= expiry:
            return (
                False,
                "Buyer mandate has expired."
            )

    except (ValueError, TypeError):

        return (
            False,
            "Buyer mandate has an invalid expiration date."
        )

    return True, "Mandate is active."


# ============================================================
# DAILY SPENDING
# ============================================================

def get_daily_spend(
    cart_id: str
) -> int:

    today = (
        datetime.now(timezone.utc)
        .date()
        .isoformat()
    )

    with connect() as conn:

        row = conn.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM orders
            WHERE cart_id=?
              AND status='PAID'
              AND substr(created_at, 1, 10)=?
            """,
            (
                cart_id,
                today
            )
        ).fetchone()

    return int(
        row["total"] or 0
    )


# ============================================================
# CATEGORY CHECK
# ============================================================

def validate_categories(
    mandate: dict,
    categories: list[str]
) -> tuple[bool, str]:

    allowed = (
        mandate.get("allowed_categories")
        or []
    )

    # --------------------------------------------------------
    # EMPTY LIST = NO CATEGORY RESTRICTION
    # --------------------------------------------------------

    if not allowed:
        return (
            True,
            "No category restriction configured."
        )

    # --------------------------------------------------------
    # NORMALIZE ALLOWED CATEGORIES
    # --------------------------------------------------------

    allowed_normalized = {
        str(category)
        .strip()
        .lower()
        for category in allowed
        if str(category).strip()
    }

    # --------------------------------------------------------
    # CHECK EVERY CATEGORY
    # --------------------------------------------------------

    for category in categories:

        normalized = str(
            category or ""
        ).strip().lower()

        if normalized not in allowed_normalized:

            return (
                False,
                f"Category '{category}' is not allowed "
                f"by buyer mandate."
            )

    return (
        True,
        "All categories are allowed."
    )


# ============================================================
# COMPLETE MANDATE VALIDATION
# ============================================================

def validate_mandate(
    mandate: dict,
    amount: int,
    categories: list[str] | None = None,
    item_prices: list[int] | None = None,
    require_auto_pay: bool = False,
) -> dict:

    violations = []

    # ========================================================
    # ENABLED
    # ========================================================

    if not mandate.get("enabled"):

        violations.append(
            "Buyer mandate is disabled."
        )

    # ========================================================
    # EXPIRATION
    # ========================================================

    valid_expiry, expiry_reason = check_expiration(
        mandate
    )

    if not valid_expiry:

        violations.append(
            expiry_reason
        )

    # ========================================================
    # AUTO PAYMENT
    # ========================================================
    #
    # Normal/manual Razorpay checkout does NOT require
    # auto_pay_enabled.
    #
    # Autonomous AI Buyer checkout DOES require it.
    #
    # ========================================================

    if (
        require_auto_pay
        and not mandate.get("auto_pay_enabled")
    ):

        violations.append(
            "Autonomous payment is not enabled."
        )

    # ========================================================
    # MAX ORDER AMOUNT
    # ========================================================

    max_order_amount = mandate.get(
        "max_order_amount"
    )

    if (
        max_order_amount is not None
        and amount > max_order_amount
    ):

        violations.append(
            f"Order amount INR {amount:,} exceeds "
            f"mandate limit INR "
            f"{max_order_amount:,}."
        )

    # ========================================================
    # MAX ITEM PRICE
    # ========================================================

    max_item_price = mandate.get(
        "max_item_price"
    )

    if max_item_price is not None:

        for price in item_prices or []:

            if price > max_item_price:

                violations.append(
                    f"Item price INR {price:,} exceeds "
                    f"mandate item limit INR "
                    f"{max_item_price:,}."
                )

    # ========================================================
    # CATEGORY
    # ========================================================

    category_ok, category_reason = (
        validate_categories(
            mandate,
            categories or []
        )
    )

    if not category_ok:

        violations.append(
            category_reason
        )

    # ========================================================
    # DAILY SPENDING
    # ========================================================
    #
    # IMPORTANT:
    # Daily spending is checked ONLY when validating the
    # actual proposed purchase.
    #
    # It is intentionally NOT checked while filtering the
    # catalog because catalog discovery should not hide
    # otherwise valid products.
    #
    # ========================================================

    max_daily_spend = mandate.get(
        "max_daily_spend"
    )

    if max_daily_spend is not None:

        current_daily_spend = get_daily_spend(
            mandate["cart_id"]
        )

        potential_daily_spend = (
            current_daily_spend + amount
        )

        if potential_daily_spend > max_daily_spend:

            violations.append(
                f"Daily spending limit exceeded. "
                f"Already spent INR "
                f"{current_daily_spend:,}; "
                f"this order would reach INR "
                f"{potential_daily_spend:,}, "
                f"while the limit is INR "
                f"{max_daily_spend:,}."
            )

    # ========================================================
    # FINAL RESULT
    # ========================================================

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


# ============================================================
# FILTER CATALOG AGAINST MANDATE
# ============================================================

def filter_catalog_by_mandate(
    catalog_items: list[dict],
    mandate: dict,
    current_cart_total: int = 0
) -> tuple[list[dict], list[dict]]:
    """
    Filter catalog items against the buyer mandate.

    This function determines which products are eligible
    for consideration by the AI Buyer.

    It checks:

    - stock
    - maximum item price
    - allowed categories
    - maximum order amount
    - mandate expiration
    - mandate enabled status

    IMPORTANT:

    Daily spending is NOT checked here.

    Daily spending is checked later when the AI Buyer
    has selected an actual product/cart and calls
    validate_mandate(...).

    auto_pay_enabled is also NOT checked here.

    Returns:
        (
            eligible_items,
            ineligible_items
        )
    """

    eligible = []
    ineligible = []

    # ========================================================
    # MANDATE LIMITS
    # ========================================================

    max_order_amount = mandate.get(
        "max_order_amount"
    )

    max_item_price = mandate.get(
        "max_item_price"
    )

    allowed_categories = (
        mandate.get("allowed_categories")
        or []
    )

    # ========================================================
    # NORMALIZE CATEGORIES
    # ========================================================

    allowed_normalized = {
        str(category)
        .strip()
        .lower()
        for category in allowed_categories
        if str(category).strip()
    }

    # ========================================================
    # MANDATE STATUS
    # ========================================================

    valid_expiry, _ = check_expiration(
        mandate
    )

    mandate_enabled = bool(
        mandate.get("enabled")
    )

    # ========================================================
    # PROCESS EVERY CATALOG ITEM
    # ========================================================

    for item in catalog_items:

        # ----------------------------------------------------
        # PRICE
        # ----------------------------------------------------

        raw_price = (
            item.get("price")
            if item.get("price") is not None
            else item.get("price_inr", 0)
        )

        try:
            price = float(
                raw_price or 0
            )
        except (TypeError, ValueError):
            price = 0.0

        # ----------------------------------------------------
        # CATEGORY
        # ----------------------------------------------------

        category = str(
            item.get("category") or ""
        ).strip().lower()

        # ----------------------------------------------------
        # STOCK
        # ----------------------------------------------------

        try:
            stock = int(
                item.get("stock", 0) or 0
            )
        except (TypeError, ValueError):
            stock = 0

        # ----------------------------------------------------
        # REASONS
        # ----------------------------------------------------

        reasons = []

        # ====================================================
        # STOCK CHECK
        # ====================================================

        if stock <= 0:

            reasons.append(
                "OUT_OF_STOCK"
            )

        # ====================================================
        # MAX ITEM PRICE CHECK
        # ====================================================

        if (
            max_item_price is not None
            and price > max_item_price
        ):

            reasons.append(
                f"ITEM_PRICE_EXCEEDS_LIMIT_"
                f"{max_item_price}"
            )

        # ====================================================
        # CATEGORY CHECK
        # ====================================================

        if allowed_normalized:

            category_allowed = any(
                allowed_category in category
                or category in allowed_category
                for allowed_category
                in allowed_normalized
            )

            if not category_allowed:

                reasons.append(
                    f"CATEGORY_NOT_ALLOWED_"
                    f"{category or 'unknown'}"
                )

        # ====================================================
        # MAX ORDER AMOUNT CHECK
        # ====================================================

        if max_order_amount is not None:

            potential_total = (
                current_cart_total + price
            )

            if potential_total > max_order_amount:

                reasons.append(
                    f"WOULD_EXCEED_ORDER_LIMIT_"
                    f"{max_order_amount}"
                )

        # ====================================================
        # EXPIRATION CHECK
        # ====================================================

        if not valid_expiry:

            reasons.append(
                "MANDATE_EXPIRED"
            )

        # ====================================================
        # ENABLED CHECK
        # ====================================================

        if not mandate_enabled:

            reasons.append(
                "MANDATE_DISABLED"
            )

        # ====================================================
        # FINAL PRODUCT DECISION
        # ====================================================

        if reasons:

            ineligible.append({
                **item,
                "ineligibility_reasons": reasons
            })

        else:

            eligible.append(item)

    # ========================================================
    # RETURN
    # ========================================================

    return (
        eligible,
        ineligible
    )