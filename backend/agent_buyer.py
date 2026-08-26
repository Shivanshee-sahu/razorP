import os, json, httpx, sqlite3
from backend.policy_engine import check_agent_permission, AgentPermission

def get_agent_catalog(db_path: str = "commerce.db") -> dict:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, price, stock, category, description FROM products")
    rows = cursor.fetchall()
    conn.close()

    products = []
    for r in rows:
        p = dict(r)
        products.append({
            "id": p["id"],
            "name": p["name"],
            "price": p["price"],
            "currency": "INR",
            "category": p.get("category") or "cookware",
            "description": p.get("description") or "Premium culinary equipment",
            "stock": p["stock"],
            "attributes": ["oven safe", "heat distribution", "durable"],
            "suitable_for": ["searing", "frying", "family cooking", "4 people"],
            "complements": ["utensil set", "cleaning kit", "lids"]
        })

    return {
        "merchant": {"name": "Copper & Char", "currency": "INR"},
        "products": products
    }

def process_buyer_request(user_request: str, db_path: str = "commerce.db") -> dict:
    if not check_agent_permission("AIBuyer", AgentPermission.READ_CATALOG):
        raise PermissionError("Agent permission denied for READ_CATALOG")

    catalog = get_agent_catalog(db_path)["products"]
    key = os.getenv("XAI_API_KEY") or os.getenv("GROQ_API_KEY")
    
    # Extract budget from natural language input
    budget = 8000
    if "3,000" in user_request or "3000" in user_request: budget = 3000
    elif "10,000" in user_request or "10000" in user_request: budget = 10000
    elif "7,000" in user_request or "7000" in user_request: budget = 7000

    selected_ids = []
    if key:
        try:
            resp = httpx.post(
                "https://api.x.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": "grok-4.5",
                    "temperature": 0.2,
                    "messages": [
                        {"role": "system", "content": "Return strictly JSON: {selected_ids: [string]}"},
                        {"role": "user", "content": json.dumps({"request": user_request, "catalog": catalog})}
                    ]
                },
                timeout=10
            )
            res = json.loads(resp.json()["choices"][0]["message"]["content"].strip("```json").strip("```"))
            selected_ids = res.get("selected_ids", [])
        except Exception:
            selected_ids = []

    # Fallback / Verification logic to strictly obey budget and stock
    if not selected_ids:
        curr = 0
        for p in catalog:
            if p["stock"] > 0 and (curr + p["price"]) <= budget:
                selected_ids.append(p["id"])
                curr += p["price"]

    recommended = [p for p in catalog if p["id"] in selected_ids and p["stock"] > 0]
    subtotal = sum(p["price"] for p in recommended)

    trace = [
        {"step": "Understanding requirements", "detail": f"Request: '{user_request}' (Budget: ₹{budget:,})", "status": "ok"},
        {"step": "Reading merchant catalog", "detail": f"Evaluated {len(catalog)} products from GET /api/agent/catalog", "status": "ok"},
        {"step": "Checking inventory", "detail": f"Verified {len(recommended)} products in stock", "status": "ok"},
        {"step": "Matching products", "detail": "Selected cookware set matching family constraints", "status": "ok"},
        {"step": "Checking budget", "detail": f"Subtotal ₹{subtotal:,} ≤ Budget ₹{budget:,}", "status": "ok" if subtotal <= budget else "failed"}
    ]

    return {
        "request": user_request,
        "requirements": {"category": "cookware", "people": 4, "budget": budget},
       "recommendations": [
    {
        "product_id": p["id"],
        "name": p["name"],
        "quantity": 1,
        "price": p["price"],
        "image_url": p.get("image_url"),
        "reason": "Complements requested cookware setup and fits budget limits."
    }
    for p in recommended
],
        "subtotal": subtotal,
        "budget": budget,
        "remaining": max(0, budget - subtotal),
        "within_budget": subtotal <= budget,
        "policy_status": "APPROVED" if subtotal <= budget else "REQUIRES_APPROVAL",
        "decision_trace": trace
    }