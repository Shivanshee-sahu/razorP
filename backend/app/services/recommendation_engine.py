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
    price = _price_value(product)
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


def extract_requirements(request: str, previous: dict | None = None) -> dict:
    """Extract buyer constraints deterministically; no LLM output is trusted here."""
    requirements = dict(previous or {})
    budget_match = re.search(r"(?:₹|rs\.?|inr)?\s*([\d,]+)\s*(?:k|thousand)?", request, re.IGNORECASE)
    if budget_match:
        amount = int(budget_match.group(1).replace(",", ""))
        if re.search(r"k|thousand", budget_match.group(0), re.IGNORECASE):
            amount *= 1000
        if amount > 500:
            requirements["budget"] = amount
    people_match = re.search(r"(?:for|feed|serve)\s+(\d+)\s*(?:people|persons|members)?", request, re.IGNORECASE)
    if people_match:
        requirements["people"] = int(people_match.group(1))
    lowered = request.lower()
    if any(word in lowered for word in ("cookware", "cooking", "pan", "pot", "skillet", "wok")):
        requirements["category"] = "cookware"
    if any(word in lowered for word in ("durable", "heavy duty", "long lasting")):
        requirements["durable"] = True
    requirements.setdefault("budget", 8000)
    requirements.setdefault("category", "cookware")
    requirements.setdefault("use_case", "family cooking" if requirements.get("people", 0) else "daily cooking")
    return requirements


def calculate_match_score(product: dict, buyer_request: str, budget: int, existing_selection: list[dict] | None = None) -> dict:
    requirements = extract_requirements(buyer_request, {"budget": budget})
    price = _price_value(product)
    category = str(product.get("category") or "").lower()
    description = f"{product.get('name', '')} {product.get('description', '')}".lower()
    budget_fit = 100 if price <= budget else max(0, round((budget / max(price, 1)) * 100))
    use_case_match = 90 if requirements["use_case"].split()[0] in description or "cook" in description else 55
    compatibility = 90 if requirements["category"] in {category, "cookware"} or category in {"cast iron", "stainless steel", "non-stick", "carbon steel", "dutch oven", "cookware"} else 45
    stock = 100 if product.get("stock", 0) > 0 else 0
    product_fit = 100 if requirements.get("durable") and any(word in description for word in ("durable", "heavy", "cast iron", "steel")) else 80
    factors = {"budget_fit": budget_fit, "use_case_match": use_case_match, "compatibility": compatibility, "stock": stock, "product_fit": product_fit}
    score = round(sum(factors[key] * weight for key, weight in zip(factors, (0.3, 0.3, 0.2, 0.1, 0.1))))
    reasons = [f"Fits the requested {requirements['category']} category" if compatibility >= 80 else "Category is a partial match"]
    if requirements.get("people"):
        reasons.append(f"Suitable for family cooking for {requirements['people']} people")
    reasons.extend(["Within the requested budget" if budget_fit == 100 else "Exceeds the requested budget", "Currently in stock" if stock else "Currently out of stock"])
    return {"score": score, "factors": factors, "why_recommended": reasons}


def _price_value(product: dict) -> float:
    return float(product.get("price") if product.get("price") is not None else product.get("price_inr", 0))