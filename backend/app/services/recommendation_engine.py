"""Deterministic product compatibility scoring for agent context and fallback."""

import re


COMPLEMENTARY_CATEGORIES = {
    "cast iron": {"kitchen tools", "bakeware", "cookware"},
    "stainless steel": {"kitchen tools", "bakeware", "cookware"},
    "non-stick": {"kitchen tools", "kitchen storage"},
    "carbon steel": {"kitchen tools", "kitchen storage"},
    "dutch oven": {"kitchen tools", "bakeware", "kitchen storage"},
    "cookware": {"kitchen tools", "bakeware", "kitchen storage"},
    "bakeware": {"kitchen tools", "kitchen storage"},
    "kitchen tools": {"cookware", "cast iron", "stainless steel", "non-stick", "carbon steel", "dutch oven", "bakeware"},
}


def _value(product: dict, *keys: str, default=None):
    for key in keys:
        if product.get(key) is not None:
            return product[key]
    return default


def _tokens(value: object) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", str(value or "").lower()))


def score_product(cart: dict, product: dict) -> dict:
    """Score usefulness independently of the language model."""
    product_id = _value(product, "id", "product_id", default="")
    category = str(product.get("category") or "").lower()
    cart_items = cart.get("items", [])
    cart_categories = {str(item.get("category") or "").lower() for item in cart_items}
    cart_ids = {item.get("product_id") for item in cart_items}
    cart_text = _tokens(" ".join(str(item.get("name", "")) for item in cart_items))
    product_text = _tokens(f"{product.get('name', '')} {product.get('description', '')}")
    score = 0
    reasons = []

    if product_id in cart_ids:
        score -= 30
        reasons.append("already in cart")
    if product.get("stock", 0) <= 0:
        score -= 100
        reasons.append("out of stock")
    else:
        score += 10
        reasons.append("in stock")
    if any(category in COMPLEMENTARY_CATEGORIES.get(existing, set()) for existing in cart_categories):
        score += 30
        reasons.append("complements the cart category")
    if cart_text & product_text:
        score += 20
        reasons.append("matches the cart's cooking use")
    if product.get("suitable_for") and any("family" in str(value).lower() for value in product["suitable_for"]):
        score += 15
        reasons.append("suitable for family cooking")

    subtotal = float(cart.get("subtotal", 0) or 0)
    price = float(_value(product, "price", "price_inr", default=0) or 0)
    if price <= max(1000, subtotal * 0.35):
        score += 10
        reasons.append("reasonable add-on price")
    return {"score": score, "reasons": reasons}


def rank_products(cart: dict, catalog: list[dict], limit: int = 3) -> list[dict]:
    ranked = []
    cart_ids = {item.get("product_id") for item in cart.get("items", [])}
    for product in catalog:
        if product.get("stock", 0) <= 0 or _value(product, "id", "product_id") in cart_ids:
            continue
        ranked.append({"product": product, **score_product(cart, product)})
    ranked.sort(key=lambda item: (-item["score"], str(_value(item["product"], "id", "product_id"))))
    return ranked[:limit]