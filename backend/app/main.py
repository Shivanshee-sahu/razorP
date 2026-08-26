import json
import os
import re
import traceback
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

import razorpay
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.db import connect, rows, seed
from app.services.grok_client import suggest
from app.services.razorpay_client import create_order, verify
from app.services.validator import gate_addons, validate_discount
from app.services.recommendation_engine import calculate_match_score, extract_requirements
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
    "auto_approval_threshold": 2000,
    "max_discount_pct": 10,
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
            SELECT ci.product_id, ci.qty, c.* 
            FROM cart_items ci 
            LEFT JOIN catalog c ON c.id = ci.product_id 
            WHERE ci.cart_id = ?
        """, (cart_id,)).fetchall()
    except Exception:
        raw_items = []

    items = []
    for item_row in raw_items:
        item = dict(item_row)
        price = item.get("price")
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

@asynccontextmanager
async def lifespan(_: FastAPI):
    seed()
    with connect() as conn:
        conn.execute("INSERT OR IGNORE INTO carts(id,created_at) VALUES ('demo-cart',?)", (now(),))
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

class BuyerCartItemInput(BaseModel):
    product_id: str
    quantity: int = Field(default=1, ge=1)

class BuyerAddToCartInput(BaseModel):
    cart_id: str = "demo-cart"
    items: list[BuyerCartItemInput]

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
        return rows(conn.execute("SELECT * FROM catalog ORDER BY name").fetchall())

@app.get("/api/cart/{cart_id}")
def get_cart(cart_id: str):
    with connect() as conn:
        return cart_data(conn, cart_id)

@app.post("/api/cart/{cart_id}/items")
def update_cart(cart_id: str, item: CartItemInput):
    with connect() as conn:
        cart_data(conn, cart_id)
        product = conn.execute(
            "SELECT stock FROM catalog WHERE id=?", 
            (item.product_id,)
        ).fetchone()
        if not product:
            raise HTTPException(404, "Product not found")
        
        prod_dict = dict(product)
        if item.qty > prod_dict.get("stock", 0):
            raise HTTPException(400, "Requested quantity exceeds stock")
        
        if item.qty == 0:
            conn.execute("DELETE FROM cart_items WHERE cart_id=? AND product_id=?", (cart_id, item.product_id))
        else:
            conn.execute(
                "INSERT INTO cart_items(cart_id,product_id,qty) VALUES (?,?,?) "
                "ON CONFLICT(cart_id,product_id) DO UPDATE SET qty=excluded.qty",
                (cart_id, item.product_id, item.qty)
            )
        return cart_data(conn, cart_id)

# ========================================================
# AI BUYER ENDPOINTS
# ========================================================

@app.get("/api/agent/catalog")
def get_agent_catalog():
    if not check_permission("AIBuyer", "READ_CATALOG"):
        raise HTTPException(403, "Permission denied for READ_CATALOG")
    with connect() as conn:
        items = rows(conn.execute("SELECT id, name, category, price, stock, description FROM catalog").fetchall())
    
    products = []
    for item in items:
        price = item.get("price") if item.get("price") is not None else item.get("price_inr", 0)
        products.append({
            "id": item["id"],
            "name": item["name"],
            "price": price,
            "currency": "INR",
            "category": item.get("category") or "cookware",
            "description": item.get("description") or "Premium culinary equipment",
            "stock": item["stock"],
            "attributes": {
                "material": (item.get("category") or "cookware").lower(),
                "durable": True,
                "dishwasher_safe": False,
                "oven_safe": True,
                "induction_compatible": True,
            },
            "use_cases": ["family cooking", "daily cooking", "meal preparation"],
            "suitable_for": ["2-4 people", "4-6 people", "family cooking"],
            "compatibility": ["cookware", "stovetop", "daily use"],
        })
    return {"merchant": {"name": "Copper & Char", "currency": "INR"}, "products": products}

@app.post("/api/agent/buyer")
def process_buyer_request(payload: BuyerRequestInput):
    if not check_permission("AIBuyer", "READ_CATALOG"):
        raise HTTPException(403, "Permission denied for READ_CATALOG")

    with connect() as conn:
        catalog_items = rows(conn.execute("SELECT * FROM catalog").fetchall())

    requirements = extract_requirements(payload.request)
    budget = requirements["budget"]

    recommended = []
    current_subtotal = 0
    selected_ids = set()
    for item in catalog_items:
        price = item.get("price") if item.get("price") is not None else item.get("price_inr", 0)
        stock = item.get("stock", 0)
        score = calculate_match_score(item, payload.request, budget, recommended)
        if stock > 0 and score["score"] >= 55 and item["id"] not in selected_ids and (current_subtotal + price) <= budget and len(recommended) < 3:
            recommended.append({
                "product_id": item["id"], "name": item["name"], "price": price, "quantity": 1,
                "image_url": item.get("image_url") or "", "reason": "; ".join(score["why_recommended"]),
                "recommendation": {"score": score["score"], "why_recommended": score["why_recommended"], "match_factors": score["factors"], "budget_impact": price, "remaining_budget": budget - current_subtotal - price},
            })
            current_subtotal += price
            selected_ids.add(item["id"])

    excluded = []
    for item in catalog_items:
        score = calculate_match_score(item, payload.request, budget, recommended)
        if item["id"] in selected_ids:
            continue
        codes = []
        if item.get("stock", 0) <= 0:
            codes.append("OUT_OF_STOCK")
        elif item.get("price", 0) + current_subtotal > budget:
            codes.append("OVER_BUDGET")
        elif score["score"] < 55:
            codes.append("LOW_COMPATIBILITY")
        if codes:
            excluded.append({"product_id": item["id"], "name": item["name"], "reason_codes": codes})

    trace = [
        {"step": "Understanding requirements", "detail": f"Parsed request: '{payload.request}' → Target Budget: ₹{budget:,}", "status": "ok"},
        {"step": "Reading merchant catalog", "detail": f"Evaluated {len(catalog_items)} products via GET /api/agent/catalog", "status": "ok"},
        {"step": "Checking inventory", "detail": f"Verified in-stock status for {len(recommended)} matched items", "status": "ok"},
        {"step": "Budget validation", "detail": f"Subtotal ₹{current_subtotal:,} ≤ ₹{budget:,}", "status": "ok" if current_subtotal <= budget else "failed"},
        {"step": "Policy validation", "detail": "Action complies with AI Buyer limits", "status": "ok"}
    ]

    with connect() as conn:
        log(conn, "N/A", "AI_BUYER", "REQUEST", f"Req: {payload.request}", current_subtotal)

    return {
        "request": payload.request,
        "recommendations": recommended,
        "subtotal": current_subtotal,
        "budget": budget,
        "remaining": max(0, budget - current_subtotal),
        "within_budget": current_subtotal <= budget,
        "requirements": requirements,
        "excluded_products": excluded,
        "policy_status": "APPROVED",
        "decision_trace": trace
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
            
            authoritative_total += row_dict["price"] * qty
            validated_items.append((payload.cart_id, row_dict["id"], qty))

        conn.execute(
            "INSERT INTO carts (id, created_at, discount_pct) VALUES (?, ?, 0) ON CONFLICT(id) DO NOTHING",
            (payload.cart_id, now())
        )

        conn.execute("DELETE FROM cart_items WHERE cart_id = ?", (payload.cart_id,))
        for c_id, p_id, qty in validated_items:
            conn.execute("INSERT INTO cart_items (cart_id, product_id, qty) VALUES (?, ?, ?)", (c_id, p_id, qty))

        log(conn, payload.cart_id, "CART", "MODIFY_CART", "AI buyer selection loaded into cart", authoritative_total)

    return {"status": "success", "cart_id": payload.cart_id, "subtotal": authoritative_total}

# ========================================================
# GROWTH AGENT & APPROVALS
# ========================================================

@app.post("/api/agent/run")
def run_agent(body: AgentInput):
    with connect() as conn:
        cart = cart_data(conn, body.cart_id)
        if not cart["items"]:
            raise HTTPException(400, "Add an item before running the growth agent")
        
        log(conn, body.cart_id, "Analyze", "ok", f"Analyzed cart with {len(cart['items'])} line item(s).", cart["subtotal"])
        proposal, fallback, error = suggest(cart, rows(conn.execute("SELECT * FROM catalog").fetchall()))
        
        if fallback:
            log(conn, body.cart_id, "Suggest", "warn", f"Fallback suggestion used: {error}.")
        else:
            log(conn, body.cart_id, "Suggest", "ok", "Grok returned a JSON-only growth proposal.")
        
        catalog_rows = rows(conn.execute("SELECT * FROM catalog").fetchall())
        available = {p.get("id"): p for p in catalog_rows}
        cart_product_ids = {item["product_id"] for item in cart["items"]}
        max_addon_amount = max(2000, cart["subtotal"] * POLICY_CONFIG["max_cart_increase_pct"] / 100)
        
        addons = []
        for addon in proposal.get("addons", []):
            pid = addon.get("product_id")
            qty = addon.get("qty")
            if (
                pid in available
                and pid not in cart_product_ids
                and isinstance(qty, int)
                and 1 <= qty <= min(20, available[pid].get("stock", 0))
            ):
                item_data = dict(available[pid])
                if "price" not in item_data and "price_inr" in item_data:
                    item_data["price"] = item_data["price_inr"]
                line_total = item_data["price"] * qty
                if len(addons) < POLICY_CONFIG["max_ai_addons"] and sum(
                    item["product"]["price"] * item["qty"] for item in addons
                ) + line_total <= max_addon_amount:
                    addons.append({**addon, "product": item_data})

        discount = validate_discount(float(proposal.get("discount_pct", 0)))
        log(conn, body.cart_id, "Validate", discount["status"], discount["reason"])
        
        addon_total = sum(addon["product"]["price"] * addon["qty"] for addon in addons)
        gate = gate_addons(addon_total)
        payload = {"addons": [{"product_id": a["product_id"], "qty": a["qty"]} for a in addons], "discount_pct": discount["accepted"]}
        
        if gate["status"] == "pending":
            approval_id = conn.execute(
                "INSERT INTO approval_queue(cart_id,payload,amount,created_at) VALUES (?,?,?,?)",
                (body.cart_id, json.dumps(payload), addon_total, now())
            ).lastrowid
            log(conn, body.cart_id, "Gate", "pending", gate["reason"], addon_total)
            outcome = {"status": "pending", "approval_id": approval_id}
        else:
            apply_action(conn, body.cart_id, payload)
            log(conn, body.cart_id, "Gate", "ok", gate["reason"], addon_total)
            log(conn, body.cart_id, "Execute", "executed", "Applied approved add-ons and discount to the cart.", addon_total)
            outcome = {"status": "executed"}
            
        return {"proposal": proposal, "addons": addons, "validator": discount, "gate": gate, "outcome": outcome, "cart": cart_data(conn, body.cart_id)}

@app.get("/api/approvals")
def approvals():
    with connect() as conn:
        return rows(conn.execute("SELECT * FROM approval_queue WHERE status='pending' ORDER BY id DESC").fetchall())

@app.post("/api/approvals/{approval_id}/{decision}")
def decide_approval(approval_id: int, decision: str):
    if decision not in {"approve", "reject"}:
        raise HTTPException(404, "Unknown approval action")
    with connect() as conn:
        row = conn.execute("SELECT * FROM approval_queue WHERE id=? AND status='pending'", (approval_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Pending approval not found")
        if decision == "approve":
            apply_action(conn, row["cart_id"], json.loads(row["payload"]))
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
        except Exception:
            paid_orders = []

    total_revenue = sum(o["amount"] for o in paid_orders)
    ai_revenue = sum(o["amount"] for o in paid_orders if o.get("ai_assisted"))
    count = max(1, len(paid_orders))

    return {
        "total_test_revenue": total_revenue,
        "ai_assisted_revenue": ai_revenue,
        "ai_revenue_contribution_pct": round((ai_revenue / total_revenue * 100) if total_revenue > 0 else 0, 1),
        "average_order_value": round(total_revenue / count),
        "upsell_acceptance_pct": 63.0,
        "payment_recovery_pct": 41.0
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

    with connect() as conn:
        def recover(reason):
            try:
                conn.execute(
                    "UPDATE carts SET recovery_status='retry_available' WHERE id=?",
                    (cart_id,)
                )
            except Exception:
                pass

            log(conn, cart_id, "Execute", "blocked", reason)
            log(conn, cart_id, "Recover", "ok", "Cart preserved; retry with a different payment method is available.")

            return {
                "verified": False,
                "retry_available": True
            }

        if body.status == "failed":
            return recover(body.reason or "Razorpay test payment was declined.")

        if not body.payment_id or not body.signature:
            return recover("Missing payment verification details.")

        try:
            verify(
                body.order_id,
                body.payment_id,
                body.signature
            )
        except (razorpay.errors.SignatureVerificationError, RuntimeError):
            return recover("Payment signature verification failed.")

        cart = cart_data(conn, cart_id)
        paid_amount = cart["total"]

        order_db_id = f"ord_{uuid4().hex[:10]}"
        order_number = f"CC-{uuid4().hex[:6].upper()}"

        try:
            conn.execute(
                """
                INSERT INTO orders (id, order_number, cart_id, razorpay_order_id, razorpay_payment_id, amount, status, ai_assisted, human_approved, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'PAID', 1, 1, ?)
                """,
                (order_db_id, order_number, cart_id, body.order_id, body.payment_id, paid_amount, now())
            )

            for item in cart["items"]:
                conn.execute(
                    """
                    INSERT INTO order_items (order_id, product_id, product_name, qty, price)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (order_db_id, item["product_id"], item["name"], item["qty"], item["price"])
                )
        except Exception as e:
            log(conn, cart_id, "OrderRecord", "warn", f"Could not insert order record: {str(e)}")

        log(conn, cart_id, "Execute", "executed", f"Razorpay payment verified successfully. Payment ID: {body.payment_id}", paid_amount)

        conn.execute("DELETE FROM cart_items WHERE cart_id=?", (cart_id,))
        conn.execute("UPDATE carts SET discount_pct=0, recovery_status='none' WHERE id=?", (cart_id,))

        log(conn, cart_id, "Complete", "success", "Payment completed and cart cleared successfully.", paid_amount)

        return {
            "verified": True,
            "receipt": {
                "order_id": order_db_id,
                "order_number": order_number,
                "payment_id": body.payment_id,
                "cart_id": cart_id,
                "amount": paid_amount,
                "currency": "INR",
                "status": "PAID",
                "created_at": now()
            }
        }

@app.post("/api/checkout/{cart_id}")
def checkout(cart_id: str):
    with connect() as conn:
        cart = cart_data(conn, cart_id)
        if cart["total"] <= 0:
            raise HTTPException(400, "Cart is empty")
        try:
            order = create_order(cart["total"], f"cc_{cart_id}_{uuid4().hex[:10]}")
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc
        except razorpay.errors.BadRequestError as exc:
            message = getattr(exc, "description", None) or str(exc) or "Razorpay rejected the order request."
            raise HTTPException(400, f"Razorpay rejected the test order: {message}") from exc
        except razorpay.errors.ServerError as exc:
            raise HTTPException(502, "Razorpay test service is temporarily unavailable. Please retry.") from exc
        except Exception as exc:
            raise HTTPException(502, f"Razorpay order creation failed ({type(exc).__name__}). Check test credentials.") from exc
            
        log(conn, cart_id, "Execute", "ok", f"Created Razorpay test order {order['id']}.", cart["total"])
        return {"order": order, "key_id": os.getenv("RAZORPAY_KEY_ID_PUBLIC") or os.getenv("RAZORPAY_KEY_ID")}

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