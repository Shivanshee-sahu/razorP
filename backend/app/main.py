import json
import os
import re
import sqlite3
import traceback
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4
from app.buyer_mandate import (
    create_mandate,
    get_mandate,
    get_cart_mandate,
    enable_mandate,
    disable_mandate,
    validate_mandate,
    filter_catalog_by_mandate,
    get_daily_spend,
)
import razorpay
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.db import connect, rows, seed
from app.services.grok_client import suggest
from app.services.razorpay_client import (
    create_order,
    verify_payment,
)
from app.services.validator import gate_addons, validate_discount
from app.services.recommendation_engine import calculate_match_score, extract_requirements
from app.services.notification_service import notification_service
from io import BytesIO

from fastapi.responses import StreamingResponse

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
)
# ========================================================
# POLICY & AGENT PERMISSION CONFIGURATION
# ========================================================

POLICY_CONFIG = {
    "max_discount_pct": 15,
    "max_auto_approve_amount": 2000,

    "allowed_actions": [
        "suggest_addon",
        "apply_discount",
        "create_order"
    ],

    "requires_human_approval_above": 2000,

    # Existing controls
    "max_ai_addons": 3,
    "max_cart_increase_pct": 30
}

AGENT_PERMISSIONS = {
    "GrowthAgent": [
        "READ_CATALOG",
        "READ_CART",
        "RECOMMEND_PRODUCTS",
        "APPLY_DISCOUNT",
        "MODIFY_CART"
    ],
    "AIBuyer": [
        "READ_CATALOG",
        "RECOMMEND_PRODUCTS",
        "MODIFY_CART"
    ]
}

def check_permission(agent_name: str, action: str) -> bool:
    return action in AGENT_PERMISSIONS.get(agent_name, [])

def now() -> str:
    return datetime.now(timezone.utc).isoformat()

def log(conn, cart_id, stage, kind, detail, amount=None):
    try:
        conn.execute(
            "INSERT INTO audit_log (cart_id,stage,kind,detail,amount,created_at) VALUES (?,?,?,?,?,?)",
            (cart_id, stage, kind, detail, amount, now())
        )
    except Exception:
        pass

def cart_data(conn, cart_id: str) -> dict:
    raw_cart = conn.execute("SELECT * FROM carts WHERE id=?", (cart_id,)).fetchone()
    if not raw_cart:
        raise HTTPException(404, f"Cart '{cart_id}' not found")
    
    cart_dict = dict(raw_cart)

    try:
        raw_items = conn.execute("""
            SELECT ci.product_id, ci.qty, ci.unit_price, c.* 
            FROM cart_items ci 
            LEFT JOIN catalog c ON c.id = ci.product_id 
            WHERE ci.cart_id = ?
        """, (cart_id,)).fetchall()
    except Exception:
        raw_items = []

    items = []
    for item_row in raw_items:
        item = dict(item_row)
        price = item.get("unit_price") or item.get("price")
        if price is None:
            price = item.get("price_inr", 0)

        items.append({
            "product_id": item.get("product_id") or item.get("id"),
            "qty": item.get("qty", 1),
            "name": item.get("name", "Item"),
            "price": price,
            "stock": item.get("stock", 0),
            "image_url": item.get("image_url", "")
        })

    subtotal = sum(item["price"] * item["qty"] for item in items)
    discount = cart_dict.get("discount_pct", 0) or 0
    
    return {
        "id": cart_id,
        "items": items,
        "subtotal": subtotal,
        "discount_pct": discount,
        "total": round(subtotal * (1 - discount / 100)),
        "recovery_status": cart_dict.get("recovery_status", "none")
    }

def apply_action(conn, cart_id: str, payload: dict) -> None:
    for addon in payload.get("addons", []):
        conn.execute(
            "INSERT INTO cart_items(cart_id,product_id,qty) VALUES (?,?,?) "
            "ON CONFLICT(cart_id,product_id) DO UPDATE SET qty=qty+excluded.qty",
            (cart_id, addon["product_id"], addon["qty"])
        )
    conn.execute("UPDATE carts SET discount_pct=? WHERE id=?", (payload.get("discount_pct", 0), cart_id))


def validate_approval_payload(conn, cart_id: str, payload: dict) -> tuple[bool, str, dict]:
    """Revalidate a queued proposal against current DB state before execution."""
    cart = cart_data(conn, cart_id)
    if not cart["items"]:
        return False, "Cart is empty; queued action cannot be applied.", cart
    if payload.get("current_subtotal") is not None and round(float(payload["current_subtotal"]), 2) != round(float(cart["subtotal"]), 2):
        return False, "Cart changed after this proposal was created. Please run Growth AI again.", cart
    if len(payload.get("addons", [])) > POLICY_CONFIG["max_ai_addons"]:
        return False, "Proposal exceeds the maximum addon count.", cart
    cart_ids = {item["product_id"] for item in cart["items"]}
    catalog = {row["id"]: dict(row) for row in conn.execute("SELECT * FROM catalog").fetchall()}
    addon_total = 0
    for addon in payload.get("addons", []):
        product = catalog.get(addon.get("product_id"))
        qty = addon.get("qty")
        if not product or product["id"] in cart_ids:
            return False, f"Product {addon.get('product_id')} is unavailable or already in the cart.", cart
        if not isinstance(qty, int) or qty < 1 or qty > min(20, product["stock"]):
            return False, f"Stock or quantity changed for {product['name']}.", cart
        addon_total += product["price"] * qty
    max_amount = max(2000, cart["subtotal"] * POLICY_CONFIG["max_cart_increase_pct"] / 100)
    if addon_total > max_amount:
        return False, "Proposal exceeds the maximum cart increase policy.", cart
    discount = validate_discount(float(payload.get("discount_pct", 0)))
    if discount["status"] == "blocked":
        return False, discount["reason"], cart
    return True, "Queued proposal revalidated successfully.", cart

def evaluate_discount_rules_internal(conn, discount_pct: float, addon_value: float) -> dict:
    """Internal function to evaluate discount rules for auto-approval."""
    rules = conn.execute(
        "SELECT * FROM discount_rules WHERE active=1 ORDER BY id DESC"
    ).fetchall()
    
    for rule in rules:
        if (discount_pct <= rule["condition_discount_pct"] and 
            addon_value <= rule["condition_addon_value"]):
            return {
                "auto_approve": bool(rule["auto_approve"]),
                "matched_rule": rule["name"],
                "rule_id": rule["id"]
            }
    
    return {"auto_approve": False, "matched_rule": None}

@asynccontextmanager
async def lifespan(_: FastAPI):
    seed()
    with connect() as conn:
        conn.execute("INSERT OR IGNORE INTO carts(id,created_at) VALUES ('demo-cart',?)", (now(),))
        
        # Create or update system-defined buyer mandate for demo-cart
        import json
        existing_mandate = conn.execute(
            "SELECT id FROM buyer_mandates WHERE cart_id='demo-cart' AND enabled=1"
        ).fetchone()
        
        mandate_id = existing_mandate[0] if existing_mandate else f"mandate_{uuid4().hex[:12]}"
        timestamp = now()
        categories_json = json.dumps(["cookware", "kitchen", "kitchen tools", "utensils"])
        
        if existing_mandate:
            # Update existing mandate to system-defined values
            conn.execute(
                """
                UPDATE buyer_mandates
                SET max_order_amount=?, max_item_price=?, max_daily_spend=?, 
                    allowed_categories=?, auto_pay_enabled=?, updated_at=?
                WHERE id=?
                """,
                (2000, 1500, 5000, categories_json, 1, timestamp, mandate_id)
            )
            print("[SYSTEM] Updated system-defined buyer mandate for demo-cart")
        else:
            # Create new mandate
            conn.execute(
                """
                INSERT INTO buyer_mandates (
                    id, cart_id, enabled, max_order_amount, max_item_price, 
                    max_daily_spend, allowed_categories, auto_pay_enabled, 
                    created_at, updated_at
                )
                VALUES (?, ?, 1, ?, ?, ?, ?, 1, ?, ?)
                """,
                (mandate_id, "demo-cart", 2000, 1500, 5000, categories_json, timestamp, timestamp)
            )
            print("[SYSTEM] Created system-defined buyer mandate for demo-cart")
    yield

app = FastAPI(title="Copper & Char Growth Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def catch_all_exceptions(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "traceback": traceback.format_exc()}
    )

# ========================================================
# PYDANTIC SCHEMAS
# ========================================================
class BuyerMandateInput(BaseModel):
    cart_id: str = "demo-cart"

    max_order_amount: int = Field(
        gt=0,
        le=1000000
    )

    max_item_price: int | None = Field(
        default=None,
        gt=0
    )

    max_daily_spend: int | None = Field(
        default=None,
        gt=0
    )

    allowed_categories: list[str] = Field(
        default_factory=list
    )

    auto_pay_enabled: bool = False

    expires_at: str | None = None
class CartItemInput(BaseModel):
    product_id: str
    qty: int = Field(ge=0, le=20)

class AgentInput(BaseModel):
    cart_id: str

class VerifyInput(BaseModel):
    cart_id: str
    order_id: str
    payment_id: str | None = None
    signature: str | None = None
    status: str = "success"
    reason: str | None = None

class BuyerRequestInput(BaseModel):
    request: str
    cart_id: str = "demo-cart"
    mandate_id: str | None = None

class BuyerCartItemInput(BaseModel):
    product_id: str
    quantity: int = Field(default=1, ge=1)

class BuyerAddToCartInput(BaseModel):
    cart_id: str = "demo-cart"
    items: list[BuyerCartItemInput]

class GrowthSelectionInput(BaseModel):
    cart_id: str = "demo-cart"
    items: list["GrowthSelectionItem"]

class GrowthSelectionItem(BaseModel):
    product_id: str
    quantity: int = Field(default=1, ge=1, le=20)
    requested_discount_pct: float = Field(default=0, ge=0, le=100)

class GrowthApprovalRequestInput(BaseModel):
    cart_id: str = "demo-cart"
    product_id: str
    qty: int = Field(default=1, ge=1, le=20)
    requested_discount_pct: float = Field(default=0, ge=0, le=100)

class MerchantApprovalInput(BaseModel):
    approved_discount_pct: float = Field(default=0, ge=0, le=100)

class MerchantRejectInput(BaseModel):
    reason: str = Field(default="Merchant rejected this commercial request.", max_length=300)

class SavedCartInput(BaseModel):
    cart_id: str = "demo-cart"
    name: str = Field(min_length=1, max_length=100)

class WishlistInput(BaseModel):
    cart_id: str = "demo-cart"
    product_id: str

class ReviewInput(BaseModel):
    order_id: str
    product_id: str
    customer_id: str = "demo-cart"
    rating: int = Field(ge=1, le=5)
    review_text: str = Field(default="", max_length=1000)

class SupportTicketInput(BaseModel):
    cart_id: str = "demo-cart"
    category: str = Field(min_length=1, max_length=50)
    message: str = Field(min_length=1, max_length=1000)

class SupportTicketUpdateInput(BaseModel):
    status: str = Field(min_length=1, max_length=20)
    response: str = Field(default="", max_length=1000)

class DiscountRuleInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    condition_discount_pct: float = Field(ge=0, le=100)
    condition_addon_value: float = Field(ge=0)
    auto_approve: bool = False

class CatalogProductInput(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=1000)
    category: str = Field(min_length=1, max_length=80)
    price: float = Field(gt=0)
    stock: int = Field(ge=0)
    active: bool = True
    ai_buyer_enabled: bool = True
    growth_agent_enabled: bool = True
    max_ai_discount_pct: float = Field(default=10, ge=0, le=100)
    max_recommended_qty: int = Field(default=1, ge=1, le=20)
    image_url: str = ""

# ========================================================
# PUBLIC & CATALOG ROUTES
# ========================================================

@app.get("/")
def root():
    return {"status": "online", "service": "Copper & Char API"}

@app.get("/api/health")
def health():
    database_status = "ok"
    try:
        with connect() as conn:
            conn.execute("SELECT 1").fetchone()
    except Exception:
        database_status = "unavailable"
    return {
        "status": "ok" if database_status == "ok" else "degraded",
        "database": database_status,
        "groq": "configured" if os.getenv("GROQ_API_KEY") else "fallback",
        "razorpay": "configured" if os.getenv("RAZORPAY_KEY_ID") else "test configuration missing",
        "policy": "active",
    }

@app.get("/api/catalog")
def catalog():
    with connect() as conn:
        return rows(conn.execute("SELECT * FROM catalog WHERE active=1 ORDER BY name").fetchall())

@app.get("/api/merchant/catalog")
def merchant_catalog():
    with connect() as conn:
        return rows(conn.execute("SELECT * FROM catalog ORDER BY name").fetchall())

@app.post("/api/merchant/catalog")
def create_merchant_product(product: CatalogProductInput):
    product_id = f"cc_{uuid4().hex[:8]}"
    with connect() as conn:
        conn.execute("INSERT INTO catalog (id,name,category,price,stock,description,image_url,active,ai_buyer_enabled,growth_agent_enabled,max_ai_discount_pct,max_recommended_qty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (product_id, product.name, product.category, product.price, product.stock, product.description, product.image_url, int(product.active), int(product.ai_buyer_enabled), int(product.growth_agent_enabled), product.max_ai_discount_pct, product.max_recommended_qty))
        log(conn, "N/A", "Catalog", "created", f"Merchant created product {product.name}.")
        return dict(conn.execute("SELECT * FROM catalog WHERE id=?", (product_id,)).fetchone())

@app.put("/api/merchant/catalog/{product_id}")
def update_merchant_product(product_id: str, product: CatalogProductInput):
    with connect() as conn:
        existing = conn.execute("SELECT id FROM catalog WHERE id=?", (product_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Product not found")
        conn.execute("UPDATE catalog SET name=?,description=?,category=?,price=?,stock=?,image_url=?,active=?,ai_buyer_enabled=?,growth_agent_enabled=?,max_ai_discount_pct=?,max_recommended_qty=? WHERE id=?", (product.name, product.description, product.category, product.price, product.stock, product.image_url, int(product.active), int(product.ai_buyer_enabled), int(product.growth_agent_enabled), product.max_ai_discount_pct, product.max_recommended_qty, product_id))
        log(conn, "N/A", "Catalog", "updated", f"Merchant updated product {product.name} ({product_id}).")
        return dict(conn.execute("SELECT * FROM catalog WHERE id=?", (product_id,)).fetchone())

@app.delete("/api/merchant/catalog/{product_id}")
def delete_merchant_product(product_id: str):
    with connect() as conn:
        existing = conn.execute("SELECT name FROM catalog WHERE id=?", (product_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Product not found")
        conn.execute("UPDATE catalog SET active=0, ai_buyer_enabled=0, growth_agent_enabled=0 WHERE id=?", (product_id,))
        log(conn, "N/A", "Catalog", "disabled", f"Merchant disabled product {existing['name']} ({product_id}).")
        return {"status": "disabled", "product_id": product_id}

@app.get("/api/cart/{cart_id}")
def get_cart(cart_id: str):
    with connect() as conn:
        return cart_data(conn, cart_id)


@app.post("/api/cart/{cart_id}/items")
def update_cart(cart_id: str, item: CartItemInput):
    with connect() as conn:

        # Make sure cart exists
        cart_data(conn, cart_id)

        # --------------------------------------------------------
        # Load product
        # --------------------------------------------------------
        product = conn.execute(
            """
            SELECT stock, price
            FROM catalog
            WHERE id=?
            """,
            (item.product_id,)
        ).fetchone()

        if not product:
            raise HTTPException(
                status_code=404,
                detail="Product not found"
            )

        prod_dict = dict(product)

        # --------------------------------------------------------
        # Check Growth Agent approval
        # --------------------------------------------------------
        growth_approval = conn.execute(
            """
            SELECT status
            FROM growth_approval_requests
            WHERE cart_id=?
              AND product_id=?
            ORDER BY id DESC
            LIMIT 1
            """,
            (cart_id, item.product_id),
        ).fetchone()

        if (
            item.qty > 0
            and growth_approval
            and growth_approval["status"] != "APPROVED"
        ):
            raise HTTPException(
                status_code=403,
                detail=(
                    "Merchant approval required before this "
                    "Growth add-on can be added."
                )
            )

        # --------------------------------------------------------
        # Check stock
        # --------------------------------------------------------
        if item.qty > prod_dict.get("stock", 0):
            raise HTTPException(
                status_code=400,
                detail="Requested quantity exceeds stock"
            )

        # --------------------------------------------------------
        # Remove item
        # --------------------------------------------------------
        if item.qty == 0:

            conn.execute(
                """
                DELETE FROM cart_items
                WHERE cart_id=?
                  AND product_id=?
                """,
                (cart_id, item.product_id)
            )

        # --------------------------------------------------------
        # Add/update item
        # --------------------------------------------------------
        else:

            approved = conn.execute(
                """
                SELECT final_price
                FROM growth_approval_requests
                WHERE cart_id=?
                  AND product_id=?
                  AND status='APPROVED'
                ORDER BY id DESC
                LIMIT 1
                """,
                (cart_id, item.product_id)
            ).fetchone()

            unit_price = (
                approved["final_price"]
                if approved
                else prod_dict["price"]
            )

            conn.execute(
                """
                INSERT INTO cart_items
                    (cart_id, product_id, qty, unit_price)
                VALUES (?, ?, ?, ?)

                ON CONFLICT(cart_id, product_id)
                DO UPDATE SET
                    qty=excluded.qty,
                    unit_price=excluded.unit_price
                """,
                (
                    cart_id,
                    item.product_id,
                    item.qty,
                    unit_price
                )
            )

        return cart_data(conn, cart_id)


# ============================================================
# AI BUYER ENDPOINTS
# ============================================================


# ============================================================
# BUYER MANDATE
# ============================================================

@app.post("/api/mandates")
def create_buyer_mandate(body: BuyerMandateInput):

    try:

        mandate = create_mandate(
            cart_id=body.cart_id,
            max_order_amount=body.max_order_amount,
            max_item_price=body.max_item_price,
            max_daily_spend=body.max_daily_spend,
            allowed_categories=body.allowed_categories,
            auto_pay_enabled=body.auto_pay_enabled,
            expires_at=body.expires_at,
        )

        with connect() as conn:

            log(
                conn,
                body.cart_id,
                "Mandate",
                "created",
                (
                    f"Buyer mandate {mandate['id']} created. "
                    f"Maximum order amount: "
                    f"₹{body.max_order_amount:,}."
                ),
                body.max_order_amount,
            )

        return {
            "success": True,
            "mandate": mandate,
        }

    except HTTPException:
        raise

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc)
        ) from exc


@app.get("/api/mandates/{cart_id}")
def get_buyer_mandate(cart_id: str):

    mandate = get_cart_mandate(cart_id)

    if not mandate:
        raise HTTPException(
            status_code=404,
            detail="No active buyer mandate found."
        )

    return {
        "success": True,
        "mandate": mandate,
    }


@app.post("/api/mandates/{mandate_id}/enable")
def enable_buyer_mandate(mandate_id: str):

    mandate = enable_mandate(mandate_id)

    return {
        "success": True,
        "mandate": mandate,
    }


@app.post("/api/mandates/{mandate_id}/disable")
def disable_buyer_mandate(mandate_id: str):

    mandate = disable_mandate(mandate_id)

    return {
        "success": True,
        "mandate": mandate,
    }


# ============================================================
# AI BUYER CATALOG
# ============================================================

@app.get("/api/agent/catalog")
def get_agent_catalog():

    if not check_permission("AIBuyer", "READ_CATALOG"):
        raise HTTPException(
            status_code=403,
            detail="Permission denied for READ_CATALOG"
        )

    with connect() as conn:

        items = rows(
            conn.execute(
                """
                SELECT
                    id,
                    name,
                    category,
                    price,
                    stock,
                    description
                FROM catalog
                WHERE active=1
                  AND ai_buyer_enabled=1
                """
            ).fetchall()
        )

    products = []

    for item in items:

        price = (
            item.get("price")
            if item.get("price") is not None
            else item.get("price_inr", 0)
        )

        category = (
            item.get("category")
            or "cookware"
        )

        products.append({
            "id": item["id"],
            "name": item["name"],
            "price": price,
            "currency": "INR",
            "category": category,
            "description": (
                item.get("description")
                or "Premium culinary equipment"
            ),
            "stock": item["stock"],

            "attributes": {
                "material": category.lower(),
                "durable": True,
                "dishwasher_safe": False,
                "oven_safe": True,
                "induction_compatible": True,
            },

            "use_cases": [
                "family cooking",
                "daily cooking",
                "meal preparation"
            ],

            "suitable_for": [
                "2-4 people",
                "4-6 people",
                "family cooking"
            ],

            "compatibility": [
                "cookware",
                "stovetop",
                "daily use"
            ],
        })

    return {
        "merchant": {
            "name": "Copper & Char",
            "currency": "INR"
        },
        "products": products
    }


# ============================================================
# AI BUYER
# ============================================================

@app.post("/api/agent/buyer")
def process_buyer_request(
    payload: BuyerRequestInput
):

    # ========================================================
    # 1. CHECK AI BUYER PERMISSION
    # ========================================================

    if not check_permission(
        "AIBuyer",
        "READ_CATALOG"
    ):
        raise HTTPException(
            status_code=403,
            detail="Permission denied for READ_CATALOG"
        )

    # ========================================================
    # 2. LOAD + CHECK BUYER MANDATE
    # ========================================================

    mandate = None

    if payload.mandate_id:

        mandate = get_mandate(
            payload.mandate_id
        )

    else:

        mandate = get_cart_mandate(
            payload.cart_id
        )

    if not mandate:

        raise HTTPException(
            status_code=403,
            detail=(
                "No active buyer mandate found. "
                "AI Buyer cannot act autonomously."
            )
        )

    # ========================================================
    # 3. LOAD CATALOG
    # ========================================================

    with connect() as conn:

        total_rows = conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM catalog
            """
        ).fetchone()["count"]

        active_rows = conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM catalog
            WHERE active=1
            """
        ).fetchone()["count"]

        ai_rows = conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM catalog
            WHERE active=1
              AND ai_buyer_enabled=1
            """
        ).fetchone()["count"]

        # Debug rows
        debug_rows = rows(
            conn.execute(
                """
                SELECT
                    id,
                    name,
                    price,
                    category,
                    stock,
                    active,
                    ai_buyer_enabled
                FROM catalog
                LIMIT 5
                """
            ).fetchall()
        )

        # Actual AI Buyer catalog
        catalog_items = rows(
            conn.execute(
                """
                SELECT *
                FROM catalog
                WHERE active=1
                  AND ai_buyer_enabled=1
                """
            ).fetchall()
        )

    # ========================================================
    # CATALOG DEBUG
    # ========================================================

    print("\n================ AI BUYER CATALOG DEBUG ================")

    print(
        "Total catalog rows:",
        total_rows
    )

    print(
        "Active catalog rows:",
        active_rows
    )

    print(
        "AI Buyer enabled rows:",
        ai_rows
    )

    print(
        "Loaded catalog items:",
        len(catalog_items)
    )

    print("\nFirst catalog rows:")

    for item in debug_rows:
        print(item)

    print("=========================================================\n")

    # ========================================================
    # 4. FILTER CATALOG AGAINST BUYER MANDATE
    # ========================================================

    trace = []

    # IMPORTANT:
    # Preserve original count before replacing catalog_items
    original_catalog_count = len(
        catalog_items
    )

    # We are discovering NEW products.
    # Existing cart total is validated later.
    current_cart_total = 0

    trace.append({
        "step": "Loading buyer mandate",

        "detail": (
            f"Mandate {mandate['id']} loaded with "
            f"max_order_amount="
            f"{mandate.get('max_order_amount')}, "
            f"max_item_price="
            f"{mandate.get('max_item_price')}"
        ),

        "status": "completed"
    })

    # ========================================================
    # MANDATE FILTER DEBUG
    # ========================================================

    print(
        "\n================ MANDATE FILTER DEBUG ================"
    )

    print(
        "Catalog BEFORE filter:",
        len(catalog_items)
    )

    print("\nMANDATE:")

    print(
        json.dumps(
            mandate,
            indent=2,
            default=str
        )
    )

    # ========================================================
    # ACTUAL FILTER
    # ========================================================

    eligible_catalog, ineligible_catalog = (
        filter_catalog_by_mandate(
            catalog_items,
            mandate,
            current_cart_total
        )
    )

    print(
        "\nEligible AFTER filter:",
        len(eligible_catalog)
    )

    print(
        "Ineligible AFTER filter:",
        len(ineligible_catalog)
    )

    # ========================================================
    # PRINT ELIGIBLE PRODUCTS
    # ========================================================

    print("\nELIGIBLE PRODUCTS:")

    for item in eligible_catalog:

        print(
            item.get("id"),
            "|",
            item.get("name"),
            "| ₹",
            item.get("price"),
            "|",
            item.get("category"),
            "| stock:",
            item.get("stock")
        )

    # ========================================================
    # PRINT INELIGIBLE PRODUCTS
    # ========================================================

    print("\nINELIGIBLE PRODUCTS:")

    for item in ineligible_catalog:

        print(
            
        item["id"],
        "|",
        item["name"],
        "| ₹",
        item["price"],
        "|",
        item["category"],
        "| REASONS:",
        item.get("ineligibility_reasons", [])
        )

    print(
        "=======================================================\n"
    )

    trace.append({
        "step": "Filtering catalog against mandate",

        "detail": (
            f"Filtered "
            f"{original_catalog_count} products to "
            f"{len(eligible_catalog)} eligible products "
            f"under mandate"
        ),

        "status": "completed"
    })

    # ========================================================
    # NO ELIGIBLE PRODUCTS
    # ========================================================

    if not eligible_catalog:

        raise HTTPException(
            status_code=400,
            detail={
                "code": "NO_ELIGIBLE_PRODUCTS",

                "message": (
                    "No products in the catalog match "
                    "your buyer mandate constraints."
                ),

                "mandate_constraints": {
                    "max_order_amount":
                        mandate.get("max_order_amount"),

                    "max_item_price":
                        mandate.get("max_item_price"),

                    "allowed_categories":
                        mandate.get("allowed_categories"),

                    "max_daily_spend":
                        mandate.get("max_daily_spend"),
                },

                # IMPORTANT:
                # Report original catalog size,
                # not filtered size.
                "catalog_size":
                    original_catalog_count,

                "ineligible_count":
                    len(ineligible_catalog),

                "trace":
                    trace,
            }
        )

    # ========================================================
    # USE ONLY ELIGIBLE PRODUCTS
    # ========================================================

    catalog_items = eligible_catalog

    # ========================================================
    # 5. UNDERSTAND USER REQUEST
    # ========================================================

    requirements = extract_requirements(payload.request)

    # Keep the extracted budget, but make the endpoint resilient if the
    # recommendation engine does not return one.
    budget = requirements.get("budget")
    if budget is None:
        budget = mandate.get("max_order_amount") or 0
    budget = float(budget)

    # ========================================================
    # 6. GENERATE RECOMMENDATIONS
    # ========================================================

    recommended = []
    selected_ids = set()
    current_subtotal = 0

    # extract_requirements() is intentionally called only once.
    requested_product_id = requirements.get("product_id")

    requested_quantity = (
        requirements.get(
            "quantity",
            1
        )
    )

    # Make sure quantity is valid
    if requested_quantity < 1:
        requested_quantity = 1

    # ========================================================
    # 6A. HANDLE EXPLICIT PRODUCT REQUEST
    # ========================================================

    if requested_product_id:

        requested_item = next(
            (
                item
                for item in catalog_items

                if str(
                    item.get("id", "")
                ).lower()
                ==
                str(
                    requested_product_id
                ).lower()
            ),
            None
        )

        # ----------------------------------------------------
        # Requested product not found
        # ----------------------------------------------------

        if not requested_item:

            raise HTTPException(
                status_code=404,
                detail=(
                    f"Requested product "
                    f"'{requested_product_id}' "
                    f"was not found in the eligible catalog."
                )
            )

        # ----------------------------------------------------
        # Product price
        # ----------------------------------------------------

        price = (
            requested_item.get("price")
            if requested_item.get("price") is not None
            else requested_item.get(
                "price_inr",
                0
            )
        )

        price = float(price)

        # ----------------------------------------------------
        # Product stock
        # ----------------------------------------------------

        stock = int(
            requested_item.get(
                "stock",
                0
            ) or 0
        )

        # ----------------------------------------------------
        # Stock validation
        # ----------------------------------------------------

        if stock < requested_quantity:

            raise HTTPException(
                status_code=400,
                detail=(
                    f"Requested quantity "
                    f"{requested_quantity} exceeds "
                    f"available stock {stock} for "
                    f"'{requested_item.get('name', requested_product_id)}'."
                )
            )

        # ----------------------------------------------------
        # Calculate requested total
        # ----------------------------------------------------

        requested_total = (
            price * requested_quantity
        )

        # ----------------------------------------------------
        # Mandate limits
        # ----------------------------------------------------

        max_order_amount = (
            mandate.get(
                "max_order_amount"
            )
        )

        max_item_price = (
            mandate.get(
                "max_item_price"
            )
        )

        max_daily_spend = (
            mandate.get(
                "max_daily_spend"
            )
        )

        # ----------------------------------------------------
        # Item price limit
        # ----------------------------------------------------

        if (
            max_item_price is not None
            and price > max_item_price
        ):

            raise HTTPException(
                status_code=403,
                detail=(
                    f"Product price ₹{price:,.0f} "
                    f"exceeds the mandate's maximum "
                    f"item price of "
                    f"₹{max_item_price:,.0f}."
                )
            )

        # ----------------------------------------------------
        # Order limit
        # ----------------------------------------------------

        if (
            max_order_amount is not None
            and requested_total > max_order_amount
        ):

            raise HTTPException(
                status_code=403,
                detail=(
                    f"Requested total ₹"
                    f"{requested_total:,.0f} exceeds "
                    f"mandate order limit "
                    f"₹{max_order_amount:,.0f}."
                )
            )

        # ----------------------------------------------------
        # Daily spending limit
        # ----------------------------------------------------

        if max_daily_spend is not None:

            current_daily_spend = (
                get_daily_spend(
                    mandate["cart_id"]
                )
            )

            if (
                current_daily_spend
                + requested_total
                > max_daily_spend
            ):

                raise HTTPException(
                    status_code=403,
                    detail=(
                        "Requested product would "
                        "exceed the daily spending "
                        f"limit ₹{max_daily_spend:,.0f}."
                    )
                )

        # ====================================================
        # DETERMINISTIC MATCH SCORE
        # ====================================================

        score = calculate_match_score(
            requested_item,
            payload.request,
            budget,
            recommended,
        )
        
        # Continue with your existing code here...
        # --------------------------------------------------------
        # Explicit product gets priority
        # --------------------------------------------------------
        reasons = list(
            score.get(
                "why_recommended",
                []
            )
        )

        if "Exact product requested by buyer" not in reasons:
            reasons.insert(
                0,
                "Exact product requested by buyer",
            )

        recommended.append(
            {
                "product_id": requested_item["id"],
                "name": requested_item["name"],
                "price": price,
                "quantity": requested_quantity,
                "image_url": (
                    requested_item.get("image_url")
                    or ""
                ),
                "reason": "; ".join(reasons),

                "recommendation": {
                    "score": score["score"],
                    "why_recommended": reasons,
                    "match_factors": score["factors"],
                    "budget_impact": requested_total,
                    "remaining_budget": max(
                        0,
                        budget - requested_total,
                    ),
                },
            }
        )

        current_subtotal += requested_total

        selected_ids.add(
            requested_item["id"]
        )

    # ============================================================
    # 5B. GENERIC RECOMMENDATIONS
    # ============================================================
    #
    # Only run generic recommendation mode when there is NO
    # explicit product ID in the buyer request.
    #
    # Example:
    #
    # "Buy product cc_106"
    #
    # => cc_106 only
    #
    # NOT:
    #
    # => cc_106 + cc_101 + cc_102
    # ============================================================

    if not requested_product_id:

        # Product discovery must not consume the daily-spend budget.
        # Daily spend is an authorization check performed by
        # validate_mandate() after the final bundle has been selected.
        max_order_amount = mandate.get("max_order_amount")

        order_limit_str = (
            f"₹{max_order_amount:,.0f}"
            if max_order_amount is not None
            else "unlimited"
        )

        trace.append({
            "step": "Constructing authorized bundle",
            "detail": (
                f"User budget: ₹{budget:,.0f}, "
                f"Mandate order limit: {order_limit_str}. "
                "Daily spend will be checked during final mandate validation."
            ),
            "status": "completed"
        })

        for item in catalog_items:

            # Maximum 3 generic recommendations
            if len(recommended) >= 3:
                break

            # Don't recommend something already selected
            if item["id"] in selected_ids:
                continue

            price = (
                item.get("price")
                if item.get("price") is not None
                else item.get("price_inr", 0)
            )

            price = float(price)

            stock = int(
                item.get("stock", 0) or 0
            )

            score = calculate_match_score(
                item,
                payload.request,
                budget,
                recommended,
            )

            # ----------------------------------------------------
            # Intent-aware fallback matching
            # ----------------------------------------------------
            # The deterministic matcher can score natural-language
            # requests too low when user terminology and catalog
            # categories use different labels. This fallback only
            # affects ranking/discovery; it does NOT bypass mandate
            # validation because the catalog was already filtered.
            request_lower = payload.request.lower()
            item_name = str(item.get("name", "")).lower()
            item_category = str(item.get("category", "")).lower()

            fallback_score = float(score.get("score", 0))

            cookware_words = {
                "pan", "fry pan", "frying pan", "skillet",
                "kadai", "wok", "saucepan", "pot",
                "cookware", "cooking"
            }

            if any(word in request_lower for word in cookware_words):
                if any(word in item_name for word in cookware_words):
                    fallback_score = max(fallback_score, 95)
                elif item_category in {
                    "kitchen tools",
                    "kitchen",
                    "utensils",
                }:
                    # Closest eligible alternatives when the exact
                    # cookware item is outside the buyer mandate.
                    fallback_score = max(fallback_score, 60)

            elif requirements.get("category") == "cookware":
                if item_category in {
                    "kitchen tools",
                    "cookware",
                    "kitchen",
                    "utensils",
                }:
                    fallback_score = max(fallback_score, 60)

            elif any(
                word in request_lower
                for word in ["cook", "cooking", "kitchen", "meal", "utensil"]
            ):
                if item_category in {
                    "kitchen tools",
                    "cookware",
                    "kitchen",
                    "utensils",
                    "kitchen storage",
                }:
                    fallback_score = max(fallback_score, 60)

            score["score"] = fallback_score

            # ----------------------------------------------------
            # Only accept valid generic recommendations
            # ----------------------------------------------------
            # Check stock, user budget and per-order authority here.
            # Daily spending is intentionally checked only by the
            # final validate_mandate() call below.
            within_user_budget = (current_subtotal + price) <= budget
            within_mandate_limit = (
                max_order_amount is None
                or (current_subtotal + price) <= max_order_amount
            )

            if (
                stock > 0
                and score["score"] >= 55
                and within_user_budget
                and within_mandate_limit
            ):

                recommended.append(
                    {
                        "product_id": item["id"],
                        "name": item["name"],
                        "price": price,
                        "quantity": 1,
                        "image_url": (
                            item.get("image_url")
                            or ""
                        ),
                        "reason": "; ".join(
                            score["why_recommended"]
                        ),

                        "recommendation": {
                            "score": score["score"],
                            "why_recommended": (
                                score["why_recommended"]
                            ),
                            "match_factors": (
                                score["factors"]
                            ),
                            "budget_impact": price,
                            "remaining_budget": max(
                                0,
                                budget
                                - current_subtotal
                                - price,
                            ),
                        },
                    }
                )

                current_subtotal += price

                selected_ids.add(
                    item["id"]
                )

    # ============================================================
    # 5C. SAFETY CHECK
    # ============================================================

    print("\n================ RECOMMENDATION DEBUG ================")
    print("User request:", payload.request)
    print("Extracted requirements:", requirements)
    print("Budget:", budget)
    print("Requested product ID:", requested_product_id)
    print("Requested quantity:", requested_quantity)
    print("Recommended count:", len(recommended))
    print("Recommended:", recommended)
    print("Current subtotal:", current_subtotal)
    print("Eligible catalog count:", len(eligible_catalog))
    print("=======================================================\n")

    if not recommended:
        # Provide detailed information about why no products were found
        if len(eligible_catalog) == 0:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "NO_ELIGIBLE_PRODUCTS",
                    "message": "No products in the catalog match your buyer mandate constraints.",
                    "mandate_constraints": {
                        "max_order_amount": mandate.get("max_order_amount"),
                        "max_item_price": mandate.get("max_item_price"),
                        "allowed_categories": mandate.get("allowed_categories"),
                        "max_daily_spend": mandate.get("max_daily_spend")
                    },
                    "ineligible_count": len(ineligible_catalog),
                    "catalog_size": len(catalog_items) + len(ineligible_catalog)
                }
            )
        else:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "NO_SUITABLE_PRODUCTS",
                    "message": f"No products matched your request '{payload.request}' within the eligible catalog of {len(eligible_catalog)} items.",
                    "eligible_count": len(eligible_catalog),
                    "user_budget": budget,
                    "request": payload.request
                }
            )

    # ============================================================
    # 6. EXCLUDED PRODUCTS
    # ============================================================

    excluded = []

    for item in catalog_items:

        if item["id"] in selected_ids:
            continue

        score = calculate_match_score(
            item,
            payload.request,
            budget,
            recommended,
        )
        
        codes = []

        # --------------------------------------------------------
        # Stock
        # --------------------------------------------------------
        if item.get("stock", 0) <= 0:

            codes.append(
                "OUT_OF_STOCK"
            )

        # --------------------------------------------------------
        # Explicit product request
        # --------------------------------------------------------
        elif requested_product_id:

            codes.append(
                "NOT_EXPLICITLY_REQUESTED"
            )

        # --------------------------------------------------------
        # Budget
        # --------------------------------------------------------
        elif (
            item.get("price", 0)
            + current_subtotal
            > budget
        ):

            codes.append(
                "OVER_BUDGET"
            )

        # --------------------------------------------------------
        # Compatibility
        # --------------------------------------------------------
        elif score["score"] < 55:

            codes.append(
                "LOW_COMPATIBILITY"
            )

        if codes:

            excluded.append(
                {
                    "product_id": item["id"],
                    "name": item["name"],
                    "reason_codes": codes,
                }
            )

    # ============================================================
    # 7. MANDATE VALIDATION
    # ============================================================

    item_prices = [
        int(item["price"])
        for item in recommended
    ]

    # ------------------------------------------------------------
    # Product categories
    # ------------------------------------------------------------

    categories = []

    for item in recommended:

        product = next(
            (
                p
                for p in catalog_items
                if p["id"] == item["product_id"]
            ),
            None,
        )

        if product:

            category = (
                product.get("category")
                or ""
            )

            categories.append(
                category
            )

    # ------------------------------------------------------------
    # Validate buyer mandate
    # ------------------------------------------------------------

    mandate_result = validate_mandate(
        mandate=mandate,
        amount=int(current_subtotal),
        categories=categories,
        item_prices=item_prices,
        require_auto_pay=True,  # AI Buyer requires auto-pay for autonomous operations
    )

    # ============================================================
    # 8. DECISION TRACE
    # ============================================================

    trace.append({
        "step": "Understanding requirements",
        "detail": (
                f"User requested up to ₹{budget:,} "
                f"for: '{payload.request}'"
            ),
        "status": "ok",
    })

    order_limit_str = f"₹{mandate.get('max_order_amount'):,}" if mandate.get('max_order_amount') else "unlimited"
    item_limit_str = f"₹{mandate.get('max_item_price'):,}" if mandate.get('max_item_price') else "unlimited"
    
    trace.append({
        "step": "Loading buyer mandate",
        "detail": (
                f"Autonomous order authority: {order_limit_str}, "
                f"Max item price: {item_limit_str}"
            ),
        "status": "ok",
    })

    trace.append({
        "step": "Product identification",
        "detail": (
                f"Explicit product requested: "
                f"{requested_product_id}"
                if requested_product_id
                else
                "No explicit product ID; "
                "using compatibility-based recommendations."
            ),
        "status": "ok",
    })

    trace.append({
        "step": "Filtering catalog against mandate",
        "detail": (
                f"Filtered {len(catalog_items) + len(ineligible_catalog)} products "
                f"to {len(catalog_items)} individually eligible (price/category/stock)"
            ),
        "status": "ok",
    })

    trace.append({
        "step": "Constructing authorized bundle",
        "detail": (
                f"Selected {len(recommended)} product(s) "
                f"totaling ₹{current_subtotal:,.0f} "
                f"within mandate order limit"
            ),
        "status": "ok",
    })

    trace.append({
        "step": "Budget validation",
        "detail": (
                f"User budget ₹{budget:,} "
                f"vs. selected total ₹{current_subtotal:,.0f}"
            ),
        "status": (
                "ok"
                if current_subtotal <= budget
                else "failed"
            ),
    })

    trace.append({
        "step": "Buyer mandate validation",
        "detail": mandate_result["status"],
        "status": (
                "ok"
                if mandate_result["approved"]
                else "failed"
            ),
    })

    trace.append({
        "step": "Policy validation",
        "detail": (
                "Action complies with AI Buyer limits"
            ),
        "status": "ok",
    })

    # ============================================================
    # 9. AUDIT LOG
    # ============================================================

    with connect() as conn:

        log(
            conn,
            payload.cart_id,
            "AI_BUYER",
            "REQUEST",
            f"Req: {payload.request}",
            current_subtotal,
        )

    # ============================================================
    # 10. RESPONSE
    # ============================================================

    return {
        "request": payload.request,

        "cart_id": payload.cart_id,

        "mandate": {
            "id": mandate["id"],
            "status": mandate_result["status"],
            "approved": mandate_result["approved"],
            "violations": (
                mandate_result["violations"]
            ),
        },

        "recommendations": recommended,

        "subtotal": current_subtotal,

        "budget": budget,

        "remaining": max(
            0,
            budget - current_subtotal,
        ),

        "within_budget": (
            current_subtotal <= budget
        ),

        "requirements": requirements,

        "excluded_products": excluded,
        
        "eligible_products": len(eligible_catalog),
        "ineligible_products": len(ineligible_catalog),
        "ineligible_reasons": ineligible_catalog[:5],  # Include first 5 ineligible items with reasons

        "policy_status": (
            "APPROVED"
            if mandate_result["approved"]
            else "REQUIRES_APPROVAL"
        ),

        "decision_trace": trace,
    }

@app.post("/api/agent/buyer/add-to-cart")
def add_buyer_cart(payload: BuyerAddToCartInput):
    if not check_permission("AIBuyer", "MODIFY_CART"):
        raise HTTPException(403, "Permission denied for MODIFY_CART")

    with connect() as conn:
        authoritative_total = 0
        validated_items = []

        for item in payload.items:
            p_id = item.product_id
            qty = item.quantity
            row = conn.execute("SELECT id, name, price, stock FROM catalog WHERE id = ?", (p_id,)).fetchone()
            if not row:
                raise HTTPException(400, f"Product {p_id} not found in catalog")
            row_dict = dict(row)
            if row_dict["stock"] < qty:
                raise HTTPException(400, f"Insufficient stock for {row_dict['name']}")
            approved = conn.execute("SELECT final_price FROM growth_approval_requests WHERE cart_id=? AND product_id=? AND status='APPROVED' ORDER BY id DESC LIMIT 1", (payload.cart_id, p_id)).fetchone()
            if conn.execute("SELECT 1 FROM growth_approval_requests WHERE cart_id=? AND product_id=?", (payload.cart_id, p_id)).fetchone() and not approved:
                raise HTTPException(403, "Merchant approval required before this add-on can be added.")
            unit_price = approved["final_price"] if approved else row_dict["price"]
            authoritative_total += unit_price * qty
            validated_items.append((payload.cart_id, row_dict["id"], qty, unit_price))

        conn.execute(
            "INSERT INTO carts (id, created_at, discount_pct) VALUES (?, ?, 0) ON CONFLICT(id) DO NOTHING",
            (payload.cart_id, now())
        )

        for c_id, p_id, qty, unit_price in validated_items:
            conn.execute(
                "INSERT INTO cart_items (cart_id, product_id, qty, unit_price) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(cart_id, product_id) DO UPDATE SET qty=cart_items.qty + excluded.qty, unit_price=excluded.unit_price",
                (c_id, p_id, qty, unit_price),
            )

        log(conn, payload.cart_id, "CART", "MODIFY_CART", "AI buyer selection loaded into cart", authoritative_total)
        log(conn, payload.cart_id, "AI_BUYER", "CART_LOADED", "AI Buyer successfully loaded items into cart", authoritative_total)

    with connect() as conn:
        updated_cart = cart_data(conn, payload.cart_id)
    return {"status": "success", "cart_id": payload.cart_id, "subtotal": updated_cart["subtotal"], "cart": updated_cart}

@app.post("/api/agent/growth/select")
def select_growth_addons(payload: GrowthSelectionInput):
    """Buyer requests selected Growth add-ons; merchant approval is required before cart mutation."""
    with connect() as conn:
        cart = cart_data(conn, payload.cart_id)
        cart_ids = {item["product_id"] for item in cart["items"]}
        if not payload.items:
            raise HTTPException(400, "Select at least one Growth add-on.")
        selected = []
        for item in payload.items:
            if item.product_id in cart_ids:
                raise HTTPException(400, f"{item.product_id} is already in the cart.")
            row = conn.execute("SELECT id, name, price, stock FROM catalog WHERE id=?", (item.product_id,)).fetchone()
            if not row:
                raise HTTPException(400, f"Product {item.product_id} is not in the catalog.")
            product = dict(row)
            if item.quantity > product["stock"]:
                raise HTTPException(400, f"Stock changed for {product['name']}; no cart changes were made.")
            existing = conn.execute("SELECT id, status FROM growth_approval_requests WHERE cart_id=? AND product_id=? ORDER BY id DESC LIMIT 1", (payload.cart_id, item.product_id)).fetchone()
            if existing and existing["status"] == "PENDING":
                selected.append(existing["id"])
                continue
            approval_id = conn.execute("INSERT INTO growth_approval_requests(cart_id,product_id,buyer_requested_discount_pct,original_price,qty,reasoning,status,requested_at) VALUES (?,?,?,?,?,?,?,?)", (payload.cart_id, item.product_id, item.requested_discount_pct, product["price"], item.quantity, f"Complements the current cart: {', '.join(i['name'] for i in cart['items'])}.", "PENDING", now())).lastrowid
            conn.execute("INSERT INTO buyer_addon_selections(cart_id,product_id,qty,status,created_at) VALUES (?,?,?,?,?)", (payload.cart_id, item.product_id, item.quantity, "PENDING", now()))
            selected.append(approval_id)
        log(conn, payload.cart_id, "BuyerApproval", "pending", "Buyer selected Growth add-ons; merchant approval is required before cart mutation.")
        log(conn, payload.cart_id, "AI_BUYER", "GROWTH_SELECTION", "AI Buyer requested Growth add-ons", 0)
        return {"status": "pending", "approval_ids": selected, "cart": cart}

@app.post("/api/growth/approval/request")
def request_growth_approval(payload: GrowthApprovalRequestInput):
    with connect() as conn:
        cart = cart_data(conn, payload.cart_id)
        if payload.product_id in {item["product_id"] for item in cart["items"]}:
            raise HTTPException(400, "Product is already in the cart.")
        product = conn.execute("SELECT id,name,price,stock FROM catalog WHERE id=?", (payload.product_id,)).fetchone()
        if not product or product["stock"] < payload.qty:
            raise HTTPException(400, "Product is unavailable or stock is insufficient.")
        existing = conn.execute("SELECT id,status FROM growth_approval_requests WHERE cart_id=? AND product_id=? ORDER BY id DESC LIMIT 1", (payload.cart_id, payload.product_id)).fetchone()
        if existing and existing["status"] == "PENDING":
            conn.execute(
                "UPDATE growth_approval_requests SET buyer_requested_discount_pct=?, requested_at=? WHERE id=?",
                (payload.requested_discount_pct, now(), existing["id"]),
            )
            log(conn, payload.cart_id, "Discount", "pending", f"Buyer updated discount request to {payload.requested_discount_pct:g}% for {product['name']}.", product["price"] * payload.qty)
            log(conn, payload.cart_id, "AI_BUYER", "DISCOUNT_UPDATE", f"AI Buyer updated discount request to {payload.requested_discount_pct:g}%", product["price"] * payload.qty)
            return {"status": "pending", "approval_id": existing["id"], "product_id": payload.product_id, "requested_discount_pct": payload.requested_discount_pct}
        approval_id = conn.execute("INSERT INTO growth_approval_requests(cart_id,product_id,buyer_requested_discount_pct,original_price,qty,reasoning,status,requested_at) VALUES (?,?,?,?,?,?,?,?)", (payload.cart_id, payload.product_id, payload.requested_discount_pct, product["price"], payload.qty, f"Complements {', '.join(item['name'] for item in cart['items'])} already in the cart.", "PENDING", now())).lastrowid
        log(conn, payload.cart_id, "Discount", "pending", f"Buyer requested {payload.requested_discount_pct:g}% discount for {product['name']}.", product["price"] * payload.qty)
        return {"status": "pending", "approval_id": approval_id, "product_id": payload.product_id}

@app.get("/api/growth/approvals/buyer/{cart_id}")
def growth_approvals_for_buyer(cart_id: str):
    with connect() as conn:
        return rows(conn.execute("SELECT * FROM growth_approval_requests WHERE cart_id=? ORDER BY id DESC", (cart_id,)).fetchall())

@app.get("/api/growth/approvals/merchant")
def growth_approvals_for_merchant():
    with connect() as conn:
        requests = rows(conn.execute("SELECT * FROM growth_approval_requests WHERE status='PENDING' ORDER BY id DESC").fetchall())
        for request in requests:
            current_cart = cart_data(conn, request["cart_id"])
            addon_total = request["original_price"] * request["qty"]
            discount = request["buyer_requested_discount_pct"] or 0
            request["kind"] = "growth_item"
            request["amount"] = addon_total
            request["product_name"] = request["product_id"]
            product = conn.execute("SELECT name FROM catalog WHERE id=?", (request["product_id"],)).fetchone()
            if product:
                request["product_name"] = product["name"]
            request["payload"] = json.dumps({
                "product_id": request["product_id"],
                "product_name": request["product_name"],
                "qty": request["qty"],
                "reasoning": request["reasoning"],
                "requested_discount_pct": discount,
                "financial_impact": {
                    "current_subtotal": current_cart["subtotal"],
                    "addon_total": addon_total,
                    "discount_pct": discount,
                    "estimated_total_before_discount": current_cart["subtotal"] + addon_total,
                    "estimated_total_after_discount": round((current_cart["subtotal"] + addon_total) * (1 - discount / 100), 2),
                    "cart_increase_pct": round((addon_total / current_cart["subtotal"] * 100) if current_cart["subtotal"] else 0, 1),
                },
            })
        return requests
    

@app.get("/api/merchant/approvals")
def merchant_approvals():
    return growth_approvals_for_merchant()
@app.post("/api/growth/approvals/{approval_id}/approve")
def approve_growth_request(
    approval_id: int,
    payload: MerchantApprovalInput
):
    with connect() as conn:

        # ============================================================
        # 1. LOAD APPROVAL REQUEST
        # ============================================================
        request = conn.execute(
            """
            SELECT *
            FROM growth_approval_requests
            WHERE id=?
            """,
            (approval_id,)
        ).fetchone()

        if not request:
            raise HTTPException(
                404,
                "Growth approval request not found."
            )

        # ============================================================
        # 2. IDEMPOTENCY
        # ============================================================
        # Do not execute the action twice if this approval was
        # already decided.
        if request["status"] != "PENDING":
            return {
                "status": request["status"],
                "approval_id": approval_id,
                "message": (
                    "Approval already decided; "
                    "no action was executed."
                )
            }

        # ============================================================
        # 3. LOAD PRODUCT
        # ============================================================
        product = conn.execute(
            """
            SELECT
                id,
                name,
                price,
                stock
            FROM catalog
            WHERE id=?
            """,
            (request["product_id"],)
        ).fetchone()

        if not product:
            conn.execute(
                """
                UPDATE growth_approval_requests
                SET
                    status='REJECTED',
                    reviewed_at=?,
                    rejection_reason=?
                WHERE id=?
                """,
                (
                    now(),
                    "Product no longer exists in the catalog.",
                    approval_id,
                )
            )

            log(
                conn,
                request["cart_id"],
                "MerchantApproval",
                "blocked",
                "Growth add-on approval rejected because product no longer exists.",
                request["original_price"]
                * request["qty"],
            )

            return {
                "status": "REJECTED",
                "approval_id": approval_id,
                "reason": "Product is no longer available.",
            }

        # ============================================================
        # 4. CHECK STOCK
        # ============================================================
        if product["stock"] < request["qty"]:
            conn.execute(
                """
                UPDATE growth_approval_requests
                SET
                    status='REJECTED',
                    reviewed_at=?,
                    rejection_reason=?
                WHERE id=?
                """,
                (
                    now(),
                    "Product is no longer available at the requested quantity.",
                    approval_id,
                )
            )

            log(
                conn,
                request["cart_id"],
                "MerchantApproval",
                "blocked",
                "Growth add-on approval rejected because stock changed.",
                request["original_price"]
                * request["qty"],
            )

            return {
                "status": "REJECTED",
                "approval_id": approval_id,
                "reason": "Product is no longer available.",
            }

        # ============================================================
        # 5. VALIDATE MERCHANT DISCOUNT
        # ============================================================
        if (
            payload.approved_discount_pct
            > POLICY_CONFIG["max_discount_pct"]
        ):
            raise HTTPException(
                400,
                (
                    "Approved discount cannot exceed the "
                    f"{POLICY_CONFIG['max_discount_pct']:g}% "
                    "policy maximum."
                )
            )
        
        # Check discount rules for auto-approval
        addon_total = request["original_price"] * request["qty"]
        rules_result = evaluate_discount_rules_internal(conn, payload.approved_discount_pct, addon_total)
        if rules_result.get("auto_approve"):
            log(conn, request["cart_id"], "DiscountRule", "auto_approved", f"Auto-approved by rule: {rules_result.get('matched_rule')}", addon_total)

        policy = validate_discount(
            payload.approved_discount_pct
        )

        if policy["status"] == "blocked":
            raise HTTPException(
                400,
                policy["reason"]
            )

        # ============================================================
        # 6. CALCULATE FINAL PRICE
        # ============================================================
        final_price = round(
            product["price"]
            * (
                1
                - payload.approved_discount_pct / 100
            ),
            2
        )

        # ============================================================
        # 7. CHECK WHETHER PRODUCT IS ALREADY IN CART
        # ============================================================
        existing_cart_item = conn.execute(
            """
            SELECT
                product_id,
                qty
            FROM cart_items
            WHERE cart_id=?
              AND product_id=?
            """,
            (
                request["cart_id"],
                request["product_id"],
            )
        ).fetchone()

        # ============================================================
        # 8. ADD APPROVED PRODUCT TO CART
        # ============================================================
        if existing_cart_item:

            # Product already exists in cart.
            # Increase quantity instead of creating duplicate row.
            new_qty = (
                existing_cart_item["qty"]
                + request["qty"]
            )

            if new_qty > product["stock"]:
                raise HTTPException(
                    400,
                    (
                        "Cannot add approved quantity because "
                        "it would exceed available stock."
                    )
                )

            conn.execute(
                """
                UPDATE cart_items
                SET qty=?
                WHERE cart_id=?
                  AND product_id=?
                """,
                (
                    new_qty,
                    request["cart_id"],
                    request["product_id"],
                )
            )

        else:

            # Product is not currently in cart.
            conn.execute(
                """
                INSERT INTO cart_items(
                    cart_id,
                    product_id,
                    qty
                )
                VALUES (?, ?, ?)
                """,
                (
                    request["cart_id"],
                    request["product_id"],
                    request["qty"],
                )
            )

        # ============================================================
        # 9. UPDATE APPROVAL → APPROVED
        # ============================================================
        conn.execute(
            """
            UPDATE growth_approval_requests
            SET
                merchant_approved_discount_pct=?,
                final_price=?,
                status='APPROVED',
                reviewed_at=?,
                reviewed_by=?
            WHERE id=?
            """,
            (
                payload.approved_discount_pct,
                final_price,
                now(),
                "Merchant",
                approval_id,
            )
        )

        # ============================================================
        # 10. UPDATE BUYER ADDON SELECTION
        # ============================================================
        conn.execute(
            """
            UPDATE buyer_addon_selections
            SET
                status='ACCEPTED',
                decided_at=?
            WHERE cart_id=?
              AND product_id=?
              AND status='PENDING'
            """,
            (
                now(),
                request["cart_id"],
                request["product_id"],
            )
        )

        # ============================================================
        # 11. UPDATE GROWTH RECOMMENDATION
        # ============================================================
        # Mark matching pending recommendations as approved.
        #
        # This is intentionally done after the cart mutation succeeds.
        # ============================================================
        conn.execute(
            """
            UPDATE growth_recommendations
            SET status='approved'
            WHERE cart_id=?
              AND status='pending'
            """,
            (
                request["cart_id"],
            )
        )

        # ============================================================
        # 12. AUDIT LOG
        # ============================================================
        total_value = (
            final_price
            * request["qty"]
        )

        log(
            conn,
            request["cart_id"],
            "MerchantApproval",
            "approved",
            (
                f"Merchant approved {product['name']} "
                f"and added {request['qty']} unit(s) to the cart "
                f"at {payload.approved_discount_pct:g}% discount."
            ),
            total_value,
        )

        # ============================================================
        # 13. RETURN UPDATED CART
        # ============================================================
        updated_cart = cart_data(
            conn,
            request["cart_id"]
        )

        return {
            "status": "APPROVED",
            "approval_id": approval_id,
            "product_id": request["product_id"],
            "product_name": product["name"],
            "qty_added": request["qty"],
            "approved_discount_pct": payload.approved_discount_pct,
            "original_price": product["price"],
            "final_price": final_price,
            "cart": updated_cart,
        }

    # Send notification asynchronously (outside transaction)
    try:
        notification_service.send_approval_decision(
            recipient_email="merchant@copperchar.com",
            approval_id=approval_id,
            decision="approved",
            product_name=product["name"],
            discount_pct=payload.approved_discount_pct
        )
    except Exception as e:
        print(f"[NOTIFICATION] Failed to send approval notification: {e}")
@app.post("/api/growth/approvals/{approval_id}/reject")
def reject_growth_request(approval_id: int, payload: MerchantRejectInput):
    with connect() as conn:
        request = conn.execute("SELECT * FROM growth_approval_requests WHERE id=?", (approval_id,)).fetchone()
        if not request:
            raise HTTPException(404, "Growth approval request not found.")
        if request["status"] != "PENDING":
            return {"status": request["status"], "approval_id": approval_id, "message": "Approval already decided; no action was executed."}
        conn.execute("UPDATE growth_approval_requests SET status='REJECTED', reviewed_at=?, reviewed_by=?, rejection_reason=? WHERE id=?", (now(), "Merchant", payload.reason, approval_id))
        conn.execute("UPDATE buyer_addon_selections SET status='REJECTED', decided_at=? WHERE cart_id=? AND product_id=? AND status='PENDING'", (now(), request["cart_id"], request["product_id"]))
        log(conn, request["cart_id"], "MerchantApproval", "rejected", f"Merchant rejected Growth add-on: {payload.reason}", request["original_price"] * request["qty"])
        
        # Send notification for rejection
        try:
            product = conn.execute("SELECT name FROM catalog WHERE id=?", (request["product_id"],)).fetchone()
            product_name = product["name"] if product else request["product_id"]
            notification_service.send_approval_decision(
                recipient_email="merchant@copperchar.com",
                approval_id=approval_id,
                decision="rejected",
                product_name=product_name,
                discount_pct=request.get("buyer_requested_discount_pct", 0)
            )
        except Exception as e:
            print(f"Failed to send rejection notification: {e}")
        
        return {"status": "REJECTED", "approval_id": approval_id, "reason": payload.reason}

@app.post("/api/merchant/approvals/{approval_id}/approve")
def approve_merchant_growth_request(approval_id: int, payload: MerchantApprovalInput):
    return approve_growth_request(approval_id, payload)

@app.post("/api/merchant/approvals/{approval_id}/reject")
def reject_merchant_growth_request(approval_id: int, payload: MerchantRejectInput):
    return reject_growth_request(approval_id, payload)

# ========================================================
# GROWTH AGENT & APPROVALS
# ========================================================

@app.post("/api/agent/run")
def run_agent(body: AgentInput):
    with connect() as conn:

        # ============================================================
        # 1. LOAD CART
        # ============================================================
        cart = cart_data(conn, body.cart_id)

        if not cart["items"]:
            raise HTTPException(
                400,
                "Add an item before running the growth agent"
            )

        log(
            conn,
            body.cart_id,
            "Analyze",
            "ok",
            f"Analyzed cart with {len(cart['items'])} line item(s).",
            cart["subtotal"],
        )

        # ============================================================
        # 2. GET AI / GROQ PROPOSAL
        # ============================================================
        catalog_for_agent = rows(
            conn.execute(
                """
                SELECT *
                FROM catalog
                WHERE active=1
                  AND growth_agent_enabled=1
                """
            ).fetchall()
        )

        proposal, fallback, error = suggest(
            cart,
            catalog_for_agent
        )

        if fallback:
            log(
                conn,
                body.cart_id,
                "Suggest",
                "warn",
                f"Fallback suggestion used: {error}."
            )
        else:
            log(
                conn,
                body.cart_id,
                "Suggest",
                "ok",
                "Grok returned a JSON-only growth proposal."
            )

        # ============================================================
        # 3. LOAD AVAILABLE PRODUCTS
        # ============================================================
        catalog_rows = rows(
            conn.execute(
                """
                SELECT *
                FROM catalog
                WHERE active=1
                  AND growth_agent_enabled=1
                """
            ).fetchall()
        )

        available = {
            p.get("id"): p
            for p in catalog_rows
        }

        cart_product_ids = {
            item["product_id"]
            for item in cart["items"]
        }

        # Maximum allowed addon value based on cart increase policy
        max_addon_amount = max(
            2000,
            cart["subtotal"]
            * POLICY_CONFIG["max_cart_increase_pct"]
            / 100
        )

        # ============================================================
        # 4. VALIDATE AI ADDONS
        # ============================================================
        addons = []

        for addon in proposal.get("addons", []):

            pid = addon.get("product_id")
            qty = addon.get("qty")

            # --------------------------------------------------------
            # Basic validation
            # --------------------------------------------------------
            if (
                pid in available
                and pid not in cart_product_ids
                and isinstance(qty, int)
                and 1 <= qty <= min(
                    20,
                    available[pid].get("stock", 0)
                )
            ):

                item_data = dict(available[pid])

                # Support both price and price_inr
                if (
                    "price" not in item_data
                    and "price_inr" in item_data
                ):
                    item_data["price"] = item_data["price_inr"]

                line_total = item_data["price"] * qty

                current_addon_total = sum(
                    item["product"]["price"] * item["qty"]
                    for item in addons
                )

                # ----------------------------------------------------
                # Check addon count + cart increase policy
                # ----------------------------------------------------
                if (
                    len(addons)
                    < POLICY_CONFIG["max_ai_addons"]
                    and current_addon_total + line_total
                    <= max_addon_amount
                ):

                    cart_names = [
                        item["name"]
                        for item in cart["items"]
                    ]

                    reasoning = (
                        addon.get("reasoning")
                        or
                        f"Complements "
                        f"{', '.join(cart_names)} "
                        f"already in your cart."
                    )

                    addons.append(
                        {
                            **addon,
                            "reasoning": reasoning,
                            "approval_status": "NOT_REQUESTED",
                            "based_on_cart_items": cart_names,
                            "product": item_data,
                        }
                    )

        # ============================================================
        # 5. VALIDATE DISCOUNT
        # ============================================================
        discount = validate_discount(
            float(proposal.get("discount_pct", 0))
        )

        log(
            conn,
            body.cart_id,
            "Validate",
            discount["status"],
            discount["reason"]
        )

        # ============================================================
        # 6. CALCULATE FINANCIAL IMPACT
        # ============================================================
        addon_total = sum(
            addon["product"]["price"] * addon["qty"]
            for addon in addons
        )

        gate = gate_addons(addon_total)

        # Growth Agent NEVER directly modifies cart.
        # Merchant approval is required.
        gate = {
            **gate,
            "status": "pending",
            "reason": (
                "Human approval is required before any "
                "Growth Agent cart or discount change."
            ),
        }

        financial_impact = {
            "current_subtotal": cart["subtotal"],
            "addon_total": addon_total,
            "discount_pct": discount["accepted"],
            "estimated_total_before_discount": (
                cart["subtotal"] + addon_total
            ),
            "estimated_total_after_discount": round(
                (cart["subtotal"] + addon_total)
                * (1 - discount["accepted"] / 100),
                2
            ),
            "cart_increase_pct": round(
                (
                    addon_total / cart["subtotal"] * 100
                    if cart["subtotal"]
                    else 0
                ),
                1
            ),
        }

        # ============================================================
        # 7. CREATE / REUSE MERCHANT APPROVALS
        # ============================================================
        approval_ids = []

        cart_names = ", ".join(
            item["name"]
            for item in cart["items"]
        )

        for addon in addons:

            # --------------------------------------------------------
            # Find latest approval for this cart + product
            # --------------------------------------------------------
            existing = conn.execute(
                """
                SELECT
                    id,
                    cart_id,
                    product_id,
                    status
                FROM growth_approval_requests
                WHERE cart_id=?
                  AND product_id=?
                ORDER BY id DESC
                LIMIT 1
                """,
                (
                    body.cart_id,
                    addon["product_id"],
                ),
            ).fetchone()

            print(
                "EXISTING GROWTH APPROVAL:",
                dict(existing) if existing else None
            )

            # --------------------------------------------------------
            # IMPORTANT:
            #
            # Only reuse an approval if it is still PENDING.
            #
            # REJECTED / APPROVED requests must NOT be reused.
            # A fresh agent run should create a fresh PENDING request.
            # --------------------------------------------------------
            if (
                existing
                and existing["status"] == "PENDING"
            ):
                approval_id = existing["id"]
                approval_ids.append(
            approval_id
        )
                addon["approval_id"] = approval_id
                addon["approval_status"] = "PENDING"

                print(
                    "♻️ REUSING PENDING GROWTH APPROVAL:",
                    existing["id"]
                )

                continue

            # --------------------------------------------------------
            # Create a NEW approval
            # --------------------------------------------------------
            approval_id = conn.execute(
                """
                INSERT INTO growth_approval_requests(
                    cart_id,
                    product_id,
                    buyer_requested_discount_pct,
                    original_price,
                    qty,
                    reasoning,
                    status,
                    requested_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    body.cart_id,
                    addon["product_id"],
                    discount["accepted"],
                    addon["product"]["price"],
                    addon["qty"],
                    addon["reasoning"]
                    or
                    f"Complements {cart_names} "
                    f"already in the cart.",
                    "PENDING",
                    now(),
                ),
            ).lastrowid

            approval_ids.append(
                approval_id
            )
            addon["approval_id"] = approval_id
            addon["approval_status"] = "PENDING"
            # --------------------------------------------------------
            # Debug: immediately verify inserted row
            # --------------------------------------------------------
            debug_row = conn.execute(
                """
                SELECT
                    id,
                    cart_id,
                    product_id,
                    status
                FROM growth_approval_requests
                WHERE id=?
                """,
                (approval_id,),
            ).fetchone()

            print(
                "CREATED GROWTH APPROVAL:",
                dict(debug_row)
                if debug_row
                else None
            )

        # ============================================================
        # 8. LOG PROPOSAL
        # ============================================================
        log(
            conn,
            body.cart_id,
            "Proposal",
            "created",
            "Growth Agent recommendations sent for merchant approval.",
            addon_total,
        )

        # ============================================================
        # 9. OUTCOME
        # ============================================================
        outcome = {
            "status": "merchant_pending",
            "approval_ids": approval_ids,
        }

        # ============================================================
        # 10. SAVE GROWTH RECOMMENDATION
        # ============================================================
        conn.execute(
            """
            INSERT INTO growth_recommendations(
                cart_id,
                payload,
                status,
                created_at
            )
            VALUES (?, ?, ?, ?)
            """,
            (
                body.cart_id,
                json.dumps(
                    {
                        "addons": addons,
                        "financial_impact": financial_impact,
                        "reasoning": proposal.get(
                            "reasoning",
                            ""
                        ),
                    }
                ),
                "pending",
                now(),
            ),
        )

        # ============================================================
        # 11. GET UPDATED CART
        # ============================================================
        updated_cart = cart_data(
            conn,
            body.cart_id
        )

        # ============================================================
        # 12. RESPONSE
        # ============================================================
        return {
            "proposal": proposal,

            "addons": addons,

            "validator": discount,

            "gate": {
                **gate,
                "status": "pending",
                "reason": (
                    "Merchant approval is required before "
                    "approved add-ons can be added to the cart."
                ),
            },

            "outcome": outcome,

            "cart": updated_cart,

            "agent": {
                "name": "GrowthAgent",
                "run_id": proposal
                    .get("execution_metadata", {})
                    .get("trace_id"),
                "timestamp": now(),
            },

            "explanation": {
                "summary": proposal.get(
                    "reasoning",
                    ""
                ),
                "factors": [
                    "Catalog and stock validated",
                    "Cart impact calculated server-side",
                    "Policy gate evaluated",
                ],
            },

            "financial_impact": financial_impact,

            "next_action": {
                "type": "merchant_approval"
            },
        }

@app.get("/api/agent/growth/recommendations/{cart_id}")
def growth_recommendations(cart_id: str):
    with connect() as conn:
        rows_ = conn.execute("SELECT * FROM growth_recommendations WHERE cart_id=? ORDER BY id DESC LIMIT 1", (cart_id,)).fetchall()
        if not rows_:
            return {"recommendations": [], "status": "none"}
        latest = dict(rows_[0])
        return {"id": latest["id"], "status": latest["status"], **json.loads(latest["payload"])}

@app.get("/api/buyer/approvals/{cart_id}")
def buyer_approvals(cart_id: str):
    with connect() as conn:
        return rows(conn.execute("SELECT * FROM buyer_addon_selections WHERE cart_id=? ORDER BY id DESC", (cart_id,)).fetchall())

@app.get("/api/approvals")
def approvals():
    with connect() as conn:
        legacy = rows(conn.execute("SELECT * FROM approval_queue WHERE status='pending'").fetchall())
        growth = rows(conn.execute("SELECT * FROM growth_approval_requests WHERE status='PENDING'").fetchall())
        for request in growth:
            request["kind"] = "growth_item"
            current_cart = cart_data(conn, request["cart_id"])
            addon_total = request["original_price"] * request["qty"]
            requested_discount = request["buyer_requested_discount_pct"] or 0
            request["amount"] = addon_total
            product = conn.execute("SELECT name FROM catalog WHERE id=?", (request["product_id"],)).fetchone()
            request["payload"] = json.dumps({
                "product_id": request["product_id"], "product_name": product["name"] if product else request["product_id"],
                "qty": request["qty"], "reasoning": request["reasoning"],
                "requested_discount_pct": request["buyer_requested_discount_pct"],
                "financial_impact": {
                    "current_subtotal": current_cart["subtotal"],
                    "addon_total": addon_total,
                    "discount_pct": requested_discount,
                    "estimated_total_before_discount": current_cart["subtotal"] + addon_total,
                    "estimated_total_after_discount": round((current_cart["subtotal"] + addon_total) * (1 - requested_discount / 100), 2),
                    "cart_increase_pct": round((addon_total / current_cart["subtotal"] * 100) if current_cart["subtotal"] else 0, 1),
                },
            })
        return sorted(legacy + growth, key=lambda item: item.get("id", 0), reverse=True)

@app.post("/api/approvals/{approval_id}/{decision}")
def decide_approval(approval_id: int, decision: str):
    if decision not in {"approve", "reject"}:
        raise HTTPException(404, "Unknown approval action")
    with connect() as conn:
        row = conn.execute("SELECT * FROM approval_queue WHERE id=?", (approval_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Pending approval not found")
        if row["status"] != "pending":
            return {"id": approval_id, "status": row["status"], "cart": cart_data(conn, row["cart_id"]), "message": "Approval has already been decided; no action was executed."}
        if decision == "approve":
            payload = json.loads(row["payload"])
            valid, reason, current_cart = validate_approval_payload(conn, row["cart_id"], payload)
            if not valid:
                conn.execute("UPDATE approval_queue SET status='failed' WHERE id=?", (approval_id,))
                log(conn, row["cart_id"], "Gate", "blocked", reason, row["amount"])
                return {"id": approval_id, "status": "stale", "reason": reason, "cart": current_cart}
            apply_action(conn, row["cart_id"], payload)
            status, kind, detail = "approved", "ok", "Human approved and executed queued growth action."
            log(conn, row["cart_id"], "Execute", "executed", "Queued add-ons were added to the cart.", row["amount"])
        else:
            status, kind, detail = "rejected", "blocked", "Human rejected queued growth action; cart was unchanged."
            
        conn.execute("UPDATE approval_queue SET status=? WHERE id=?", (status, approval_id))
        log(conn, row["cart_id"], "Gate", kind, detail, row["amount"])
        return {"id": approval_id, "status": status, "cart": cart_data(conn, row["cart_id"])}

# ========================================================
# POLICY, REVENUE & ORDERS
# ========================================================

@app.get("/api/policies")
def get_policies():
    return {
        "limits": POLICY_CONFIG,
        "permissions": AGENT_PERMISSIONS
    }

@app.get("/api/revenue")
def get_revenue():
    with connect() as conn:
        try:
            paid_orders = rows(conn.execute("SELECT * FROM orders WHERE status = 'PAID'").fetchall())
            all_orders = rows(conn.execute("SELECT * FROM orders").fetchall())
            growth_runs = conn.execute("SELECT COUNT(*) AS count FROM audit_log WHERE stage = 'Analyze'").fetchone()["count"]
            proposals = conn.execute("SELECT COUNT(*) AS count FROM audit_log WHERE stage = 'Suggest'").fetchone()["count"]
            accepted = conn.execute("SELECT COUNT(*) AS count FROM audit_log WHERE stage = 'Execute' AND kind = 'executed'").fetchone()["count"]
            approvals = conn.execute("SELECT COUNT(*) AS count FROM approval_queue").fetchone()["count"]
            approved_actions = conn.execute("SELECT COUNT(*) AS count FROM approval_queue WHERE status = 'approved'").fetchone()["count"]
            fallback_runs = conn.execute("SELECT COUNT(*) AS count FROM audit_log WHERE detail LIKE '%Fallback%'").fetchone()["count"]
        except Exception:
            paid_orders = all_orders = []
            growth_runs = proposals = accepted = approvals = approved_actions = fallback_runs = 0

    total_revenue = sum(o["amount"] for o in paid_orders)
    ai_revenue = sum(o["amount"] for o in paid_orders if o.get("ai_assisted"))
    count = len(paid_orders)
    total_attempts = len(all_orders)

    return {
        "total_test_revenue": total_revenue,
        "ai_assisted_revenue": ai_revenue,
        "ai_revenue_contribution_pct": round((ai_revenue / total_revenue * 100) if total_revenue > 0 else 0, 1),
        "average_order_value": round(total_revenue / count) if count else 0,
        "growth_agent_runs": growth_runs,
        "recommendations_generated": proposals,
        "addons_accepted": accepted,
        "upsell_acceptance_pct": round(accepted / proposals * 100, 1) if proposals else None,
        "human_approval_rate": round(approved_actions / approvals * 100, 1) if approvals else None,
        "auto_execution_rate": round(max(0, accepted - approved_actions) / accepted * 100, 1) if accepted else None,
        "fallback_rate": round(fallback_runs / growth_runs * 100, 1) if growth_runs else None,
        "payment_success_rate": round(count / total_attempts * 100, 1) if total_attempts else None,
        "payment_recovery_pct": None,
    }

@app.get("/api/orders")
def get_orders():
    with connect() as conn:
        try:
            return rows(conn.execute("SELECT * FROM orders ORDER BY created_at DESC").fetchall())
        except Exception:
            return []

@app.get("/api/orders/{order_id}/receipt")
def generate_receipt(order_id: str):
    # --------------------------------------------
    # FIND ORDER FROM DATABASE
    # --------------------------------------------
    with connect() as conn:
        order = conn.execute(
            """
            SELECT *
            FROM orders
            WHERE id = ? OR order_number = ?
            LIMIT 1
            """,
            (order_id, order_id)
        ).fetchone()

        if not order:
            raise HTTPException(
                status_code=404,
                detail="Order not found"
            )

        order = dict(order)

        # Get order items
        try:
            items = rows(
                conn.execute(
                    """
                    SELECT *
                    FROM order_items
                    WHERE order_id = ?
                    """,
                    (order["id"],)
                ).fetchall()
            )
        except Exception:
            items = []

    # --------------------------------------------
    # ORDER DATA
    # --------------------------------------------
    actual_order_id = order.get("order_number") or order.get("id")

    amount = (
        order.get("amount")
        if order.get("amount") is not None
        else order.get("total", 0)
    )

    status = order.get("status", "PAID")
    payment_id = order.get("razorpay_payment_id", "N/A")
    created_at = order.get("created_at", "")

    # --------------------------------------------
    # CREATE PDF
    # --------------------------------------------
    buffer = BytesIO()

    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "ReceiptTitle",
        parent=styles["Title"],
        fontSize=24,
        leading=28,
        alignment=TA_CENTER,
        spaceAfter=5,
    )

    subtitle_style = ParagraphStyle(
        "ReceiptSubtitle",
        parent=styles["Normal"],
        fontSize=10,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#6b746f"),
        spaceAfter=18,
    )

    normal_style = ParagraphStyle(
        "ReceiptNormal",
        parent=styles["Normal"],
        fontSize=10,
        leading=15,
    )

    right_style = ParagraphStyle(
        "ReceiptRight",
        parent=normal_style,
        alignment=TA_RIGHT,
    )

    section_style = ParagraphStyle(
        "ReceiptSection",
        parent=normal_style,
        fontSize=11,
        textColor=colors.HexColor("#6eae32"),
        spaceAfter=10,
    )

    success_style = ParagraphStyle(
        "ReceiptSuccess",
        parent=normal_style,
        alignment=TA_CENTER,
        fontSize=11,
        textColor=colors.HexColor("#6eae32"),
    )

    footer_style = ParagraphStyle(
        "ReceiptFooter",
        parent=normal_style,
        alignment=TA_CENTER,
        fontSize=9,
        textColor=colors.HexColor("#7b8581"),
    )

    story = []

    # --------------------------------------------
    # HEADER
    # --------------------------------------------
    story.append(
        Paragraph(
            "COPPER &amp; CHAR",
            title_style,
        )
    )

    story.append(
        Paragraph(
            "ORDER RECEIPT",
            subtitle_style,
        )
    )

    story.append(
        HRFlowable(
            width="100%",
            thickness=1,
            color=colors.HexColor("#dfe5e2"),
        )
    )

    story.append(Spacer(1, 15))

    # --------------------------------------------
    # ORDER INFORMATION
    # --------------------------------------------
    order_info = [
        [
            Paragraph("<b>Order ID</b>", normal_style),
            Paragraph(f"#{actual_order_id}", right_style),
        ],
        [
            Paragraph("<b>Status</b>", normal_style),
            Paragraph(str(status), right_style),
        ],
        [
            Paragraph("<b>Payment ID</b>", normal_style),
            Paragraph(str(payment_id), right_style),
        ],
        [
            Paragraph("<b>Date</b>", normal_style),
            Paragraph(str(created_at), right_style),
        ],
    ]

    info_table = Table(
        order_info,
        colWidths=[
            60 * mm,
            100 * mm,
        ],
    )

    info_table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ])
    )

    story.append(info_table)

    story.append(Spacer(1, 18))

    # --------------------------------------------
    # ORDER ITEMS
    # --------------------------------------------
    story.append(
        Paragraph(
            "ORDER ITEMS",
            section_style,
        )
    )

    item_data = [
        [
            Paragraph("<b>Product</b>", normal_style),
            Paragraph("<b>Qty</b>", right_style),
            Paragraph("<b>Price</b>", right_style),
            Paragraph("<b>Total</b>", right_style),
        ]
    ]

    for item in items:
        qty = item.get("qty", 1)
        price = float(item.get("price", 0))
        line_total = price * qty

        item_data.append([
            Paragraph(
                str(item.get("product_name", "Item")),
                normal_style
            ),
            Paragraph(
                str(qty),
                right_style
            ),
            Paragraph(
                f"₹{price:,.2f}",
                right_style
            ),
            Paragraph(
                f"₹{line_total:,.2f}",
                right_style
            ),
        ])

    # Fallback if no items were found
    if not items:
        item_data.append([
            Paragraph("Order", normal_style),
            Paragraph("1", right_style),
            Paragraph(f"₹{float(amount):,.2f}", right_style),
            Paragraph(f"₹{float(amount):,.2f}", right_style),
        ])

    items_table = Table(
        item_data,
        colWidths=[
            75 * mm,
            20 * mm,
            32 * mm,
            33 * mm,
        ],
    )

    items_table.setStyle(
        TableStyle([
            (
                "BACKGROUND",
                (0, 0),
                (-1, 0),
                colors.HexColor("#f3f6f4"),
            ),
            (
                "GRID",
                (0, 0),
                (-1, -1),
                0.5,
                colors.HexColor("#dfe5e2"),
            ),
            (
                "VALIGN",
                (0, 0),
                (-1, -1),
                "MIDDLE",
            ),
            (
                "ALIGN",
                (1, 0),
                (-1, -1),
                "RIGHT",
            ),
            (
                "TOPPADDING",
                (0, 0),
                (-1, -1),
                10,
            ),
            (
                "BOTTOMPADDING",
                (0, 0),
                (-1, -1),
                10,
            ),
            (
                "LEFTPADDING",
                (0, 0),
                (-1, -1),
                8,
            ),
            (
                "RIGHTPADDING",
                (0, 0),
                (-1, -1),
                8,
            ),
        ])
    )

    story.append(items_table)

    story.append(Spacer(1, 20))

    # --------------------------------------------
    # TOTAL
    # --------------------------------------------
    total_table = Table(
        [
            [
                Paragraph("<b>Total Paid</b>", normal_style),
                Paragraph(
                    f"<b>₹{float(amount):,.2f}</b>",
                    right_style,
                ),
            ]
        ],
        colWidths=[
            105 * mm,
            55 * mm,
        ],
    )

    total_table.setStyle(
        TableStyle([
            (
                "BACKGROUND",
                (0, 0),
                (-1, -1),
                colors.HexColor("#edf7e7"),
            ),
            (
                "BOX",
                (0, 0),
                (-1, -1),
                0.5,
                colors.HexColor("#dfe5e2"),
            ),
            (
                "TOPPADDING",
                (0, 0),
                (-1, -1),
                12,
            ),
            (
                "BOTTOMPADDING",
                (0, 0),
                (-1, -1),
                12,
            ),
            (
                "LEFTPADDING",
                (0, 0),
                (-1, -1),
                12,
            ),
            (
                "RIGHTPADDING",
                (0, 0),
                (-1, -1),
                12,
            ),
        ])
    )

    story.append(total_table)

    story.append(Spacer(1, 30))

    # --------------------------------------------
    # FOOTER
    # --------------------------------------------
    story.append(
        Paragraph(
            "Payment successfully received.",
            success_style,
        )
    )

    story.append(Spacer(1, 8))

    story.append(
        Paragraph(
            "Thank you for shopping with Copper &amp; Char.",
            footer_style,
        )
    )

    # --------------------------------------------
    # BUILD PDF
    # --------------------------------------------
    document.build(story)

    buffer.seek(0)

    # --------------------------------------------
    # RETURN PDF
    # --------------------------------------------
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="receipt_{actual_order_id}.pdf"'
            )
        },
    )

# ========================================================
# CHECKOUT & PAYMENT VERIFICATION
# ========================================================

@app.post("/api/checkout/verify")
def verify_checkout(body: VerifyInput):
    cart_id = body.cart_id

    # ========================================================
    # BASIC VALIDATION
    # ========================================================

    if not body.order_id:
        return {
            "verified": False,
            "retry_available": True,
            "error": "Missing Razorpay order ID."
        }

    if not body.payment_id:
        return {
            "verified": False,
            "retry_available": True,
            "error": "Missing Razorpay payment ID."
        }

    if not body.signature:
        return {
            "verified": False,
            "retry_available": True,
            "error": "Missing Razorpay payment signature."
        }

    # ========================================================
    # VERIFY WITH RAZORPAY (BEFORE DB TRANSACTION)
    # ========================================================
    # This is an external API call and should NOT happen while
    # holding a SQLite transaction open.

    try:
        verification = verify_payment(
            body.order_id,
            body.payment_id,
            body.signature
        )
    except Exception as exc:
        print(
            "Checkout verification failed:",
            type(exc).__name__,
            str(exc)
        )
        return {
            "verified": False,
            "retry_available": True,
            "error": "Razorpay payment verification failed."
        }

    # ========================================================
    # EXTRACT VERIFIED RAZORPAY DATA
    # ========================================================

    razorpay_payment = verification["payment"]
    razorpay_order = verification["order"]

    actual_order_id = razorpay_order.get("id")
    actual_order_amount = int(razorpay_order.get("amount", 0))
    actual_payment_amount = int(razorpay_payment.get("amount", 0))
    actual_currency = razorpay_payment.get("currency")

    # ========================================================
    # VERIFY ORDER ID
    # ========================================================

    if actual_order_id != body.order_id:
        return {
            "verified": False,
            "retry_available": True,
            "error": "Razorpay order ID mismatch."
        }

    # ========================================================
    # VERIFY PAYMENT AMOUNT
    # ========================================================

    if actual_payment_amount != actual_order_amount:
        return {
            "verified": False,
            "retry_available": True,
            "error": "Payment amount does not match Razorpay order amount."
        }

    # ========================================================
    # VERIFY PAYMENT STATUS
    # ========================================================

    if razorpay_payment.get("status") != "captured":
        return {
            "verified": False,
            "retry_available": True,
            "error": f"Payment was not captured. Current status: {razorpay_payment.get('status')}"
        }

    # ========================================================
    # VERIFY CURRENCY
    # ========================================================

    if actual_currency != "INR":
        return {
            "verified": False,
            "retry_available": True,
            "error": "Payment currency is not INR."
        }

    # ========================================================
    # NOW OPEN DB TRANSACTION FOR ORDER CREATION
    # ========================================================
    # The transaction should be as short as possible.
    # Only the actual order insertion operations are inside.

    with connect() as conn:

        print("[DB DEBUG] BEGIN checkout transaction")

        # ========================================================
        # FETCH CART
        # ========================================================

        cart = cart_data(conn, cart_id)

        if not cart or cart["total"] <= 0:
            return {
                "verified": False,
                "retry_available": True,
                "error": "Cart is empty or no longer available."
            }

        expected_amount_inr = int(cart["total"])
        expected_amount_paise = expected_amount_inr * 100

        # ========================================================
        # VERIFY AGAINST CURRENT CART
        # ========================================================

        if actual_order_amount != expected_amount_paise:
            return {
                "verified": False,
                "retry_available": True,
                "error": "Payment amount does not match the current cart amount."
            }

        # ========================================================
        # IDEMPOTENCY CHECK
        # ========================================================

        existing = conn.execute(
            """
            SELECT
                id,
                order_number,
                cart_id,
                razorpay_order_id,
                razorpay_payment_id,
                amount,
                status,
                created_at
            FROM orders
            WHERE razorpay_payment_id=?
            """,
            (body.payment_id,)
        ).fetchone()

        if existing:

            # Same payment was already successfully processed.
            if existing["status"] == "PAID":

                log(
                    conn,
                    cart_id,
                    "Execute",
                    "ok",
                    f"Payment {body.payment_id} was already processed. Returning existing order.",
                    existing["amount"]
                )

                return {
                    "verified": True,
                    "already_processed": True,
                    "receipt": {
                        "order_id": existing["id"],
                        "order_number": existing["order_number"],
                        "payment_id": existing["razorpay_payment_id"],
                        "cart_id": existing["cart_id"],
                        "amount": existing["amount"],
                        "currency": "INR",
                        "status": existing["status"],
                        "created_at": existing["created_at"]
                    }
                }

            return {
                "verified": False,
                "retry_available": False,
                "error": "This Razorpay payment has already been associated with an existing order."
            }

        # ========================================================
        # EVERYTHING VERIFIED - CREATE ORDER
        # ========================================================

        paid_amount = expected_amount_inr

        order_db_id = f"ord_{uuid4().hex[:10]}"
        order_number = f"CC-{uuid4().hex[:6].upper()}"
        created_at = now()

        print("[DB DEBUG] inserting order")

        # ========================================================
        # RECORD ORDER
        # ========================================================

        try:

            conn.execute(
                """
                INSERT INTO orders (
                    id,
                    order_number,
                    cart_id,
                    razorpay_order_id,
                    razorpay_payment_id,
                    amount,
                    status,
                    ai_assisted,
                    human_approved,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, 'PAID', ?, ?, ?)
                """,
                (
                    order_db_id,
                    order_number,
                    cart_id,
                    body.order_id,
                    body.payment_id,
                    paid_amount,

                    # This checkout reached execution through
                    # the buyer-agent / mandate flow.
                    1,

                    # No human approval was required for an
                    # autonomous mandate-approved checkout.
                    0,

                    created_at
                )
            )

            # ====================================================
            # RECORD ORDER ITEMS
            # ====================================================

            print("[DB DEBUG] inserting order_items")

            for item in cart["items"]:

                conn.execute(
                    """
                    INSERT INTO order_items (
                        order_id,
                        product_id,
                        product_name,
                        qty,
                        price
                    )
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        order_db_id,
                        item["product_id"],
                        item["name"],
                        item["qty"],
                        item["price"]
                    )
                )

        except Exception as exc:

            # IMPORTANT:
            # Do NOT clear the cart if order recording fails.

            log(
                conn,
                cart_id,
                "OrderRecord",
                "error",
                f"Failed to record paid order: {str(exc)}"
            )

            raise HTTPException(
                status_code=500,
                detail=(
                    "Payment was verified, but the order could not "
                    "be recorded. Your cart has been preserved."
                )
            ) from exc

        # ========================================================
        # ORDER SUCCESSFULLY RECORDED
        # ========================================================

        log(
            conn,
            cart_id,
            "Execute",
            "executed",
            (
                "Razorpay payment verified and order recorded. "
                f"Payment ID: {body.payment_id}"
            ),
            paid_amount
        )

        # ========================================================
        # CLEAR CART ONLY AFTER ORDER RECORDING SUCCEEDS
        # ========================================================

        print("[DB DEBUG] clearing cart")

        conn.execute(
            "DELETE FROM cart_items WHERE cart_id=?",
            (cart_id,)
        )

        conn.execute(
            """
            UPDATE carts
            SET discount_pct=0,
                recovery_status='none'
            WHERE id=?
            """,
            (cart_id,)
        )

        # ========================================================
        # COMPLETION AUDIT
        # ========================================================

        log(
            conn,
            cart_id,
            "Complete",
            "success",
            "Payment completed and cart cleared successfully.",
            paid_amount
        )

        print("[DB DEBUG] committing checkout transaction")

        # Transaction commits automatically when `with connect()` exits

    print("[DB DEBUG] checkout transaction committed")
    print("[DB DEBUG] connection closed")

    # ========================================================
    # NOTIFICATION (AFTER TRANSACTION COMMITS)
    # ========================================================
    # Notification happens outside the transaction to avoid
    # nested SQLite writes and lock conflicts.

    try:
        notification_service.send_order_confirmation(
            recipient_email="buyer@copperchar.com",
            order_id=order_db_id,
            order_number=order_number,
            amount=paid_amount,
            items=cart["items"]
        )
    except Exception as e:
        print(f"[NOTIFICATION] Failed to send order confirmation notification: {e}")

    # ========================================================
    # RESPONSE
    # ========================================================

    return {
        "verified": True,
        "already_processed": False,
        "receipt": {
            "order_id": order_db_id,
            "order_number": order_number,
            "payment_id": body.payment_id,
            "razorpay_order_id": body.order_id,
            "cart_id": cart_id,
            "amount": paid_amount,
            "currency": "INR",
            "status": "PAID",
            "created_at": created_at
        }
    }
@app.post("/api/cart/{cart_id}/clear")
def clear_cart(cart_id: str):
    with connect() as conn:
        conn.execute("DELETE FROM cart_items WHERE cart_id=?", (cart_id,))
        conn.execute("UPDATE carts SET discount_pct=0 WHERE id=?", (cart_id,))
        log(conn, cart_id, "CART", "CLEARED", "Cart cleared by user", 0)
    return {"status": "cleared", "cart_id": cart_id}

@app.post("/api/checkout/{cart_id}")
def checkout(cart_id: str):
    with connect() as conn:

        # ============================================================
        # 1. LOAD CART
        # ============================================================
        cart = cart_data(conn, cart_id)

        if cart["total"] <= 0:
            raise HTTPException(400, "Cart is empty")

        # ============================================================
        # 2. CREATE RAZORPAY ORDER
        # ============================================================
        # Note: Buyer mandate validation is only for AI Buyer autonomous operations
        # Normal user checkout does not require a buyer mandate
        try:
            order = create_order(
                cart["total"],
                f"cc_{cart_id}_{uuid4().hex[:10]}"
            )

        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc

        except razorpay.errors.BadRequestError as exc:
            message = (
                getattr(exc, "description", None)
                or str(exc)
                or "Razorpay rejected the order request."
            )

            raise HTTPException(
                400,
                f"Razorpay rejected the test order: {message}"
            ) from exc

        except razorpay.errors.ServerError as exc:
            raise HTTPException(
                502,
                "Razorpay test service is temporarily unavailable. Please retry."
            ) from exc

        except Exception as exc:
            raise HTTPException(
                502,
                f"Razorpay order creation failed "
                f"({type(exc).__name__}). Check test credentials."
            ) from exc

        # ============================================================
        # 3. AUDIT
        # ============================================================
        log(
            conn,
            cart_id,
            "Execute",
            "ok",
            f"Created Razorpay test order {order['id']}.",
            cart["total"]
        )

        return {
            "order": order,
            "key_id": (
                os.getenv("RAZORPAY_KEY_ID_PUBLIC")
                or os.getenv("RAZORPAY_KEY_ID")
            ),
        }

# ========================================================
# AI BUYER CHECKOUT (WITH MANDATE VALIDATION)
# ========================================================

@app.post("/api/checkout/{cart_id}/ai-buyer")
def ai_buyer_checkout(cart_id: str):
    """Checkout for AI Buyer operations with mandatory mandate validation."""
    with connect() as conn:

        # ============================================================
        # 1. LOAD CART
        # ============================================================
        cart = cart_data(conn, cart_id)

        if cart["total"] <= 0:
            raise HTTPException(400, "Cart is empty")

        # ============================================================
        # 2. LOAD BUYER MANDATE (REQUIRED FOR AI BUYER)
        # ============================================================
        mandate = get_cart_mandate(cart_id)

        if not mandate:
            log(
                conn,
                cart_id,
                "POLICY",
                "blocked",
                "AI Buyer checkout blocked: no buyer mandate exists.",
                cart["total"]
            )

            raise HTTPException(
                status_code=403,
                detail={
                    "code": "NO_MANDATE",
                    "message": "AI Buyer checkout blocked: no active buyer mandate found."
                }
            )

        # ============================================================
        # 3. COLLECT CART ITEMS FOR MANDATE VALIDATION
        # ============================================================
        item_prices = []
        categories = []

        for item in cart["items"]:
            price = int(item["price"])
            qty = int(item["qty"])

            # Validate each unit price against mandate
            item_prices.extend([price] * qty)

            # Find category from catalog
            product = conn.execute(
                "SELECT category FROM catalog WHERE id=?",
                (item["product_id"],)
            ).fetchone()

            if product:
                categories.append(product["category"] or "")

        # ============================================================
        # 4. VALIDATE BUYER MANDATE (WITH AUTO-PAY REQUIREMENT)
        # ============================================================
        mandate_result = validate_mandate(
            mandate=mandate,
            amount=int(cart["total"]),
            categories=categories,
            item_prices=item_prices,
            require_auto_pay=True,  # AI Buyer requires auto-pay
        )

        if not mandate_result["approved"]:

            reason = "; ".join(
                mandate_result["violations"]
            )

            log(
                conn,
                cart_id,
                "POLICY",
                "blocked",
                f"AI Buyer checkout blocked by buyer mandate: {reason}",
                cart["total"]
            )

            raise HTTPException(
                status_code=403,
                detail={
                    "code": "MANDATE_VALIDATION_FAILED",
                    "message": "AI Buyer checkout is not authorized by the active buyer mandate.",
                    "status": mandate_result["status"],
                    "violations": mandate_result["violations"],
                    "mandate_id": mandate["id"],
                }
            )

        # ============================================================
        # 5. MANDATE PASSED → CREATE RAZORPAY ORDER
        # ============================================================
        try:
            order = create_order(
                cart["total"],
                f"cc_{cart_id}_{uuid4().hex[:10]}"
            )

        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc

        except razorpay.errors.BadRequestError as exc:
            message = (
                getattr(exc, "description", None)
                or str(exc)
                or "Razorpay rejected the order request."
            )

            raise HTTPException(
                400,
                f"Razorpay rejected the test order: {message}"
            ) from exc

        except razorpay.errors.ServerError as exc:
            raise HTTPException(
                502,
                "Razorpay test service is temporarily unavailable. Please retry."
            ) from exc

        except Exception as exc:
            raise HTTPException(
                502,
                f"Razorpay order creation failed "
                f"({type(exc).__name__}). Check test credentials."
            ) from exc

        # ============================================================
        # 6. AUDIT
        # ============================================================
        log(
            conn,
            cart_id,
            "AI_BUYER",
            "CHECKOUT_AUTHORIZED",
            f"AI Buyer mandate approved. Created Razorpay test order {order['id']}.",
            cart["total"]
        )

        return {
            "order": order,
            "key_id": (
                os.getenv("RAZORPAY_KEY_ID_PUBLIC")
                or os.getenv("RAZORPAY_KEY_ID")
            ),
            "mandate": {
                "id": mandate["id"],
                "status": mandate_result["status"],
                "approved": True,
                "violations": []
            },
            "policy_status": "APPROVED"
        }

# ========================================================
# FAILURE SIMULATION & AUDIT
# ========================================================

@app.get("/api/audit/{cart_id}")
def audit(cart_id: str):
    with connect() as conn:
        return rows(conn.execute("SELECT * FROM audit_log WHERE cart_id=? ORDER BY id DESC", (cart_id,)).fetchall())

@app.post("/api/test/failure/{scenario}")
def simulate_failure(scenario: str):
    scenarios = {
        "payment_failure": ("CHECKOUT", "PAYMENT_FAILED", "Razorpay simulation: Payment declined. Cart preserved."),
        "ai_timeout": ("AGENT", "TIMEOUT", "AI agent request timed out. Retrying with deterministic fallback."),
        "inventory_unavailable": ("INVENTORY", "OUT_OF_STOCK", "Requested quantity exceeds available stock."),
        "discount_rejected": ("POLICY", "REJECTED", "Discount exceeds maximum allowed policy limit of 10%."),
        "human_approval_rejected": ("APPROVAL", "REJECTED", "Action rejected by human operator.")
    }
    stage, kind, detail = scenarios.get(scenario, ("TEST", "SIMULATION", "Executed lab test"))
    with connect() as conn:
        log(conn, "TEST_LAB", stage, kind, detail, 0)
    return {"scenario": scenario, "stage": stage, "kind": kind, "detail": detail}

# ========================================================
# SAVED CARTS
# ========================================================

@app.post("/api/saved-carts")
def create_saved_cart(body: SavedCartInput):
    saved_cart_id = f"saved_{uuid4().hex[:10]}"
    with connect() as conn:
        # Get current cart items
        cart = cart_data(conn, body.cart_id)
        if not cart["items"]:
            raise HTTPException(400, "Cannot save an empty cart")
        
        # Create saved cart
        conn.execute(
            "INSERT INTO saved_carts (id, cart_id, name, created_at) VALUES (?, ?, ?, ?)",
            (saved_cart_id, body.cart_id, body.name, now())
        )
        
        # Copy cart items to saved cart items
        for item in cart["items"]:
            conn.execute(
                "INSERT INTO saved_cart_items (saved_cart_id, product_id, qty, unit_price) VALUES (?, ?, ?, ?)",
                (saved_cart_id, item["product_id"], item["qty"], item["price"])
            )
        
        log(conn, body.cart_id, "SavedCart", "created", f"Saved cart as '{body.name}'", cart["subtotal"])
    
    return {"saved_cart_id": saved_cart_id, "name": body.name, "item_count": len(cart["items"])}

@app.get("/api/saved-carts/{cart_id}")
def get_saved_carts(cart_id: str):
    with connect() as conn:
        saved_carts = rows(conn.execute(
            "SELECT * FROM saved_carts WHERE cart_id=? ORDER BY created_at DESC",
            (cart_id,)
        ).fetchall())
        
        for saved_cart in saved_carts:
            # Get item count
            items = conn.execute(
                "SELECT COUNT(*) as count FROM saved_cart_items WHERE saved_cart_id=?",
                (saved_cart["id"],)
            ).fetchone()
            saved_cart["item_count"] = items["count"] if items else 0
    
    return saved_carts

@app.post("/api/saved-carts/{saved_cart_id}/restore")
def restore_saved_cart(saved_cart_id: str, target_cart_id: str = "demo-cart"):
    with connect() as conn:
        # Get saved cart
        saved_cart = conn.execute(
            "SELECT * FROM saved_carts WHERE id=?",
            (saved_cart_id,)
        ).fetchone()
        
        if not saved_cart:
            raise HTTPException(404, "Saved cart not found")
        
        # Get saved cart items
        saved_items = rows(conn.execute(
            "SELECT * FROM saved_cart_items WHERE saved_cart_id=?",
            (saved_cart_id,)
        ).fetchall())
        
        if not saved_items:
            raise HTTPException(400, "Saved cart is empty")
        
        # Clear target cart
        conn.execute("DELETE FROM cart_items WHERE cart_id=?", (target_cart_id,))
        conn.execute("UPDATE carts SET discount_pct=0 WHERE id=?", (target_cart_id,))
        
        # Add items to target cart
        for item in saved_items:
            product = conn.execute(
                "SELECT stock, price FROM catalog WHERE id=?",
                (item["product_id"],)
            ).fetchone()
            
            if product and product["stock"] >= item["qty"]:
                conn.execute(
                    "INSERT INTO cart_items (cart_id, product_id, qty, unit_price) VALUES (?, ?, ?, ?)",
                    (target_cart_id, item["product_id"], item["qty"], item.get("unit_price", product["price"]))
                )
        
        log(conn, target_cart_id, "SavedCart", "restored", f"Restored saved cart '{saved_cart['name']}'", 0)
        
        return cart_data(conn, target_cart_id)

@app.delete("/api/saved-carts/{saved_cart_id}")
def delete_saved_cart(saved_cart_id: str):
    with connect() as conn:
        saved_cart = conn.execute(
            "SELECT cart_id, name FROM saved_carts WHERE id=?",
            (saved_cart_id,)
        ).fetchone()
        
        if not saved_cart:
            raise HTTPException(404, "Saved cart not found")
        
        conn.execute("DELETE FROM saved_cart_items WHERE saved_cart_id=?", (saved_cart_id,))
        conn.execute("DELETE FROM saved_carts WHERE id=?", (saved_cart_id,))
        
        log(conn, saved_cart["cart_id"], "SavedCart", "deleted", f"Deleted saved cart '{saved_cart['name']}'", 0)
    
    return {"status": "deleted", "saved_cart_id": saved_cart_id}

# ========================================================
# WISHLIST
# ========================================================

@app.post("/api/wishlist")
def add_to_wishlist(body: WishlistInput):
    with connect() as conn:
        # Check if product exists
        product = conn.execute(
            "SELECT id FROM catalog WHERE id=?",
            (body.product_id,)
        ).fetchone()
        
        if not product:
            raise HTTPException(404, "Product not found")
        
        # Check if already in wishlist
        existing = conn.execute(
            "SELECT id FROM wishlists WHERE cart_id=? AND product_id=?",
            (body.cart_id, body.product_id)
        ).fetchone()
        
        if existing:
            return {"status": "already_exists", "message": "Product already in wishlist"}
        
        # Add to wishlist
        conn.execute(
            "INSERT INTO wishlists (cart_id, product_id, created_at) VALUES (?, ?, ?)",
            (body.cart_id, body.product_id, now())
        )
        
        log(conn, body.cart_id, "Wishlist", "added", f"Added product {body.product_id} to wishlist", 0)
    
    return {"status": "added", "product_id": body.product_id}

@app.get("/api/wishlist/{cart_id}")
def get_wishlist(cart_id: str):
    with connect() as conn:
        wishlist_items = rows(conn.execute("""
            SELECT w.*, c.name, c.price, c.image_url, c.category
            FROM wishlists w
            JOIN catalog c ON w.product_id = c.id
            WHERE w.cart_id = ?
            ORDER BY w.created_at DESC
        """, (cart_id,)).fetchall())
    
    return wishlist_items

@app.delete("/api/wishlist/{cart_id}/{product_id}")
def remove_from_wishlist(cart_id: str, product_id: str):
    with connect() as conn:
        result = conn.execute(
            "DELETE FROM wishlists WHERE cart_id=? AND product_id=?",
            (cart_id, product_id)
        )
        
        if result.rowcount == 0:
            raise HTTPException(404, "Wishlist item not found")
        
        log(conn, cart_id, "Wishlist", "removed", f"Removed product {product_id} from wishlist", 0)
    
    return {"status": "removed", "product_id": product_id}

@app.post("/api/wishlist/{cart_id}/{product_id}/move-to-cart")
def move_wishlist_to_cart(cart_id: str, product_id: str):
    with connect() as conn:
        # Check if in wishlist
        wishlist_item = conn.execute(
            "SELECT * FROM wishlists WHERE cart_id=? AND product_id=?",
            (cart_id, product_id)
        ).fetchone()
        
        if not wishlist_item:
            raise HTTPException(404, "Product not in wishlist")
        
        # Get product details
        product = conn.execute(
            "SELECT id, name, price, stock FROM catalog WHERE id=?",
            (product_id,)
        ).fetchone()
        
        if not product:
            raise HTTPException(404, "Product not found")
        
        # Add to cart
        existing_cart_item = conn.execute(
            "SELECT qty FROM cart_items WHERE cart_id=? AND product_id=?",
            (cart_id, product_id)
        ).fetchone()
        
        if existing_cart_item:
            new_qty = existing_cart_item["qty"] + 1
            if new_qty > product["stock"]:
                raise HTTPException(400, "Insufficient stock")
            conn.execute(
                "UPDATE cart_items SET qty=? WHERE cart_id=? AND product_id=?",
                (new_qty, cart_id, product_id)
            )
        else:
            conn.execute(
                "INSERT INTO cart_items (cart_id, product_id, qty, unit_price) VALUES (?, ?, ?, ?)",
                (cart_id, product_id, 1, product["price"])
            )
        
        # Remove from wishlist
        conn.execute("DELETE FROM wishlists WHERE cart_id=? AND product_id=?", (cart_id, product_id))
        
        log(conn, cart_id, "Wishlist", "moved", f"Moved product {product_id} from wishlist to cart", product["price"])
        
        return cart_data(conn, cart_id)

# ========================================================
# REVIEWS & RATINGS
# ========================================================
@app.get("/api/reviews/reviewable/{cart_id}")
def get_reviewable_products(cart_id: str):
    with connect() as conn:

        items = rows(conn.execute("""
            SELECT
                oi.id,
                oi.order_id,
                oi.product_id,
                o.order_number,
                o.cart_id,
                o.status,
                c.name AS product_name,
                c.price,
                c.image_url,
                c.category
            FROM order_items oi
            JOIN orders o
                ON oi.order_id = o.id
            JOIN catalog c
                ON oi.product_id = c.id
            WHERE o.cart_id = ?
              AND UPPER(o.status) = 'PAID'
            ORDER BY o.created_at DESC
        """, (cart_id,)).fetchall())

        return items
@app.post("/api/reviews")
def create_review(body: ReviewInput):
    with connect() as conn:
        # Verify customer purchased the product
        order_item = conn.execute("""
            SELECT oi.* FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE o.id = ? AND oi.product_id = ? AND o.cart_id = ?
        """, (body.order_id, body.product_id, body.customer_id)).fetchone()
        
        if not order_item:
            raise HTTPException(403, "You can only review products you have purchased")
        
        # Check if review already exists
        existing = conn.execute(
            "SELECT id FROM reviews WHERE order_id=? AND product_id=? AND customer_id=?",
            (body.order_id, body.product_id, body.customer_id)
        ).fetchone()
        
        if existing:
            raise HTTPException(400, "You have already reviewed this product")
        
        # Create review
        conn.execute(
            """INSERT INTO reviews (order_id, product_id, customer_id, rating, review_text, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (body.order_id, body.product_id, body.customer_id, body.rating, body.review_text, now())
        )
        
        log(conn, body.customer_id, "Review", "created", f"Created review for product {body.product_id}", 0)
    
    return {"status": "created", "rating": body.rating}

@app.get("/api/reviews/product/{product_id}")
def get_product_reviews(product_id: str):
    with connect() as conn:
        reviews = rows(conn.execute("""
            SELECT r.*, o.order_number
            FROM reviews r
            JOIN orders o ON r.order_id = o.id
            WHERE r.product_id = ?
            ORDER BY r.created_at DESC
        """, (product_id,)).fetchall())
        
        # Calculate average rating
        avg_rating = conn.execute(
            "SELECT AVG(rating) as avg FROM reviews WHERE product_id=?",
            (product_id,)
        ).fetchone()
        
        return {
            "reviews": reviews,
            "average_rating": round(avg_rating["avg"], 1) if avg_rating and avg_rating["avg"] else None,
            "review_count": len(reviews)
        }

@app.get("/api/reviews/customer/{customer_id}")
def get_customer_reviews(customer_id: str):
    with connect() as conn:
        reviews = rows(conn.execute("""
            SELECT r.*, c.name as product_name, o.order_number
            FROM reviews r
            JOIN catalog c ON r.product_id = c.id
            JOIN orders o ON r.order_id = o.id
            WHERE r.customer_id = ?
            ORDER BY r.created_at DESC
        """, (customer_id,)).fetchall())
    
    return reviews

# ========================================================
# CUSTOMER SUPPORT
# ========================================================

@app.post("/api/support/tickets")
def create_support_ticket(body: SupportTicketInput):
    with connect() as conn:
        ticket_id = conn.execute(
            """INSERT INTO support_tickets (cart_id, category, message, status, created_at, updated_at)
               VALUES (?, ?, ?, 'OPEN', ?, ?)""",
            (body.cart_id, body.category, body.message, now(), now())
        ).lastrowid
        
        log(conn, body.cart_id, "Support", "created", f"Created support ticket: {body.category}", 0)
    
    return {"ticket_id": ticket_id, "status": "OPEN", "category": body.category}

@app.get("/api/support/tickets/{cart_id}")
def get_support_tickets(cart_id: str):
    with connect() as conn:
        tickets = rows(conn.execute(
            "SELECT * FROM support_tickets WHERE cart_id=? ORDER BY created_at DESC",
            (cart_id,)
        ).fetchall())
    
    return tickets

@app.put("/api/support/tickets/{ticket_id}")
def update_support_ticket(ticket_id: int, body: SupportTicketUpdateInput):
    with connect() as conn:
        ticket = conn.execute(
            "SELECT cart_id FROM support_tickets WHERE id=?",
            (ticket_id,)
        ).fetchone()
        
        if not ticket:
            raise HTTPException(404, "Ticket not found")
        
        conn.execute(
            """UPDATE support_tickets SET status=?, updated_at=? WHERE id=?""",
            (body.status, now(), ticket_id)
        )
        
        log(conn, ticket["cart_id"], "Support", "updated", f"Updated ticket {ticket_id} to {body.status}", 0)
    
    return {"ticket_id": ticket_id, "status": body.status}

# ========================================================
# DISCOUNT RULES ENGINE
# ========================================================

@app.post("/api/discount-rules")
def create_discount_rule(body: DiscountRuleInput):
    with connect() as conn:
        rule_id = conn.execute(
            """INSERT INTO discount_rules (name, condition_discount_pct, condition_addon_value, auto_approve, active, created_at)
               VALUES (?, ?, ?, ?, 1, ?)""",
            (body.name, body.condition_discount_pct, body.condition_addon_value, int(body.auto_approve), now())
        ).lastrowid
        
        log(conn, "SYSTEM", "DiscountRule", "created", f"Created discount rule: {body.name}", 0)
    
    return {"rule_id": rule_id, "name": body.name}

@app.get("/api/discount-rules")
def get_discount_rules():
    with connect() as conn:
        rules = rows(conn.execute(
            "SELECT * FROM discount_rules WHERE active=1 ORDER BY created_at DESC"
        ).fetchall())
    
    return rules

@app.delete("/api/discount-rules/{rule_id}")
def delete_discount_rule(rule_id: int):
    with connect() as conn:
        conn.execute("UPDATE discount_rules SET active=0 WHERE id=?", (rule_id,))
        log(conn, "SYSTEM", "DiscountRule", "deleted", f"Deleted discount rule {rule_id}", 0)
    
    return {"status": "deleted", "rule_id": rule_id}

@app.post("/api/discount-rules/evaluate")
def evaluate_discount_rules(cart_id: str, discount_pct: float, addon_value: float):
    """Evaluate if a discount should be auto-approved based on rules."""
    with connect() as conn:
        rules = rows(conn.execute(
            "SELECT * FROM discount_rules WHERE active=1 ORDER BY id DESC"
        ).fetchall())
        
        for rule in rules:
            if (discount_pct <= rule["condition_discount_pct"] and 
                addon_value <= rule["condition_addon_value"]):
                return {
                    "auto_approve": bool(rule["auto_approve"]),
                    "matched_rule": rule["name"],
                    "rule_id": rule["id"]
                }
    
    return {"auto_approve": False, "matched_rule": None}

# ========================================================
# ANALYTICS
# ========================================================

@app.get("/api/analytics/sales")
def get_sales_analytics():
    with connect() as conn:
        # Basic sales metrics
        total_revenue = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) as total FROM orders WHERE status='PAID'"
        ).fetchone()["total"]
        
        order_count = conn.execute(
            "SELECT COUNT(*) as count FROM orders WHERE status='PAID'"
        ).fetchone()["count"]
        
        avg_order_value = total_revenue / order_count if order_count > 0 else 0
        
        # Category performance
        category_performance = rows(conn.execute("""
            SELECT c.category, 
                   COUNT(DISTINCT o.id) as orders,
                   SUM(oi.qty * oi.price) as revenue
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN catalog c ON oi.product_id = c.id
            WHERE o.status = 'PAID'
            GROUP BY c.category
            ORDER BY revenue DESC
        """).fetchall())
        
        # Product performance
        product_performance = rows(conn.execute("""
            SELECT c.id, c.name, c.category,
                   SUM(oi.qty) as units_sold,
                   SUM(oi.qty * oi.price) as revenue
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN catalog c ON oi.product_id = c.id
            WHERE o.status = 'PAID'
            GROUP BY c.id, c.name, c.category
            ORDER BY revenue DESC
            LIMIT 10
        """).fetchall())
        
        # Growth Agent metrics
        growth_metrics = {
            "recommendations_generated": conn.execute(
                "SELECT COUNT(*) FROM growth_recommendations"
            ).fetchone()[0],
            "approved_recommendations": conn.execute(
                "SELECT COUNT(*) FROM growth_approval_requests WHERE status='APPROVED'"
            ).fetchone()[0],
            "rejected_recommendations": conn.execute(
                "SELECT COUNT(*) FROM growth_approval_requests WHERE status='REJECTED'"
            ).fetchone()[0],
        }
        
        total_rec = growth_metrics["recommendations_generated"]
        growth_metrics["conversion_rate"] = round(
            (growth_metrics["approved_recommendations"] / total_rec * 100) if total_rec > 0 else 0, 1
        )
        
        addon_revenue = conn.execute("""
            SELECT COALESCE(SUM(oi.qty * oi.price), 0) as total
            FROM order_items oi
            JOIN growth_approval_requests gar ON oi.product_id = gar.product_id
            WHERE gar.status = 'APPROVED'
        """).fetchone()["total"]
        
        growth_metrics["addon_revenue"] = addon_revenue
    
    return {
        "total_revenue": total_revenue,
        "order_count": order_count,
        "average_order_value": round(avg_order_value, 2),
        "category_performance": category_performance,
        "product_performance": product_performance,
        "growth_metrics": growth_metrics
    }

@app.get("/api/analytics/customer-segments")
def get_customer_segments():
    with connect() as conn:
        # Get all carts with order history
        customers = rows(conn.execute("""
            SELECT DISTINCT cart_id
            FROM orders
            WHERE status = 'PAID'
        """).fetchall())
        
        segments = {
            "HIGH_VALUE": [],
            "FREQUENT_BUYER": [],
            "NEW_CUSTOMER": [],
            "PRICE_SENSITIVE": [],
            "GROWTH_RESPONSIVE": [],
            "INACTIVE": []
        }
        
        for customer in customers:
            cart_id = customer["cart_id"]
            
            # Get customer metrics
            orders = rows(conn.execute(
                "SELECT * FROM orders WHERE cart_id=? AND status='PAID' ORDER BY created_at DESC",
                (cart_id,)
            ).fetchall())
            
            if not orders:
                continue
            
            total_spent = sum(o["amount"] for o in orders)
            order_count = len(orders)
            avg_order = total_spent / order_count if order_count > 0 else 0
            
            # Check growth responsiveness
            growth_orders = conn.execute("""
                SELECT COUNT(*) as count FROM orders o
                JOIN growth_approval_requests gar ON o.cart_id = gar.cart_id
                WHERE o.cart_id = ? AND gar.status = 'APPROVED' AND o.status = 'PAID'
            """, (cart_id,)).fetchone()["count"]
            
            growth_responsive = growth_orders > 0
            
            # Segment logic
            if total_spent > 10000:
                segments["HIGH_VALUE"].append({"cart_id": cart_id, "total_spent": total_spent, "order_count": order_count})
            elif order_count >= 5:
                segments["FREQUENT_BUYER"].append({"cart_id": cart_id, "order_count": order_count, "total_spent": total_spent})
            elif order_count == 1:
                segments["NEW_CUSTOMER"].append({"cart_id": cart_id, "total_spent": total_spent})
            elif avg_order < 500:
                segments["PRICE_SENSITIVE"].append({"cart_id": cart_id, "avg_order": avg_order})
            
            if growth_responsive:
                segments["GROWTH_RESPONSIVE"].append({"cart_id": cart_id, "growth_orders": growth_orders})
        
        # Segment inactive customers (no orders in last 30 days)
        thirty_days_ago = datetime.now(timezone.utc).replace(day=1).isoformat()  # Simplified for demo
        inactive = rows(conn.execute("""
            SELECT DISTINCT cart_id FROM orders 
            WHERE created_at < ? AND status = 'PAID'
            AND cart_id NOT IN (
                SELECT DISTINCT cart_id FROM orders WHERE created_at >= ? AND status = 'PAID'
            )
        """, (thirty_days_ago, thirty_days_ago)).fetchall())
        
        segments["INACTIVE"] = [{"cart_id": c["cart_id"]} for c in inactive]
    
    return segments

@app.get("/api/analytics/discount-effectiveness")
def get_discount_effectiveness():
    with connect() as conn:
        # Get all approved discounts
        approved_discounts = rows(conn.execute("""
            SELECT gar.*, o.id as order_id
            FROM growth_approval_requests gar
            LEFT JOIN orders o ON gar.cart_id = o.cart_id
            WHERE gar.status = 'APPROVED' AND gar.merchant_approved_discount_pct > 0
        """).fetchall())
        
        total_offered = sum(d["buyer_requested_discount_pct"] for d in approved_discounts)
        total_approved = sum(d["merchant_approved_discount_pct"] for d in approved_discounts)
        avg_discount = total_approved / len(approved_discounts) if approved_discounts else 0
        
        # Orders with discounts
        orders_with_discount = [d for d in approved_discounts if d["order_id"]]
        discount_revenue = sum(d["final_price"] * d["qty"] for d in orders_with_discount if d["final_price"])
        
        # Estimated discount cost
        original_revenue = sum(d["original_price"] * d["qty"] for d in approved_discounts)
        discount_cost = original_revenue - discount_revenue
        net_revenue = discount_revenue
    
    return {
        "discount_offered_count": len(approved_discounts),
        "orders_with_discount": len(orders_with_discount),
        "revenue_with_discounts": discount_revenue,
        "average_discount_pct": round(avg_discount, 1),
        "estimated_discount_cost": discount_cost,
        "net_revenue": net_revenue,
        "conversion_rate": round(len(orders_with_discount) / len(approved_discounts) * 100, 1) if approved_discounts else 0
    }

# ========================================================
# BULK APPROVAL
# ========================================================

class BulkApprovalInput(BaseModel):
    approval_ids: list[int]
    decision: str = Field(min_length=1, max_length=10)  # "approve" or "reject"
    discount_pct: float = Field(default=0, ge=0, le=15)

@app.post("/api/approvals/bulk")
def bulk_approve(body: BulkApprovalInput):
    if body.decision not in ["approve", "reject"]:
        raise HTTPException(400, "Decision must be 'approve' or 'reject'")
    
    results = []
    
    with connect() as conn:
        for approval_id in body.approval_ids:
            try:
                if body.decision == "approve":
                    payload = MerchantApprovalInput(approved_discount_pct=body.discount_pct)
                    result = approve_growth_request(approval_id, payload)
                else:
                    payload = MerchantRejectInput()
                    result = reject_growth_request(approval_id, payload)
                
                results.append({
                    "approval_id": approval_id,
                    "status": "success",
                    "result": result
                })
            except HTTPException as e:
                results.append({
                    "approval_id": approval_id,
                    "status": "error",
                    "error": e.detail
                })
            except Exception as e:
                results.append({
                    "approval_id": approval_id,
                    "status": "error",
                    "error": str(e)
                })
        
        log(conn, "SYSTEM", "BulkApproval", body.decision, f"Bulk {body.decision}ed {len(body.approval_ids)} items", 0)
    
    return {
        "processed": len(body.approval_ids),
        "decision": body.decision,
        "results": results
    }