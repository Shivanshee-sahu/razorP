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
    lowered = request.lower()

    # ============================================================
    # 1. Explicit product ID
    # ============================================================
    product_id_match = re.search(
        r"\b(?:product\s*)?([a-z]{2}_\d+)\b",
        request,
        re.IGNORECASE,
    )

    if product_id_match:
        requirements["product_id"] = product_id_match.group(1).lower()

    # ============================================================
    # 2. Quantity
    # ============================================================
    quantity_match = re.search(
        r"\bquantity\s*[:=]?\s*(\d+)\b",
        request,
        re.IGNORECASE,
    )

    if quantity_match:
        requirements["quantity"] = int(quantity_match.group(1))

    # Also understand:
    # "buy 2 ..."
    # "get 3 ..."
    # "add 2 ..."
    if "quantity" not in requirements:
        qty_match = re.search(
            r"\b(?:buy|get|add|order)\s+(\d+)\b",
            request,
            re.IGNORECASE,
        )

        if qty_match:
            requirements["quantity"] = int(qty_match.group(1))

    requirements.setdefault("quantity", 1)

    # ============================================================
    # 3. Budget
    # ============================================================
    budget_match = re.search(
        r"(?:₹|rs\.?|inr)?\s*([\d]+(?:,\d{3})*)\s*(?:k|thousand)?",
        request,
        re.IGNORECASE,
    )

    if budget_match:
        amount_text = budget_match.group(1)

        if amount_text:
            amount = int(amount_text.replace(",", ""))

            if re.search(
                r"\b(?:k|thousand)\b",
                budget_match.group(0),
                re.IGNORECASE,
            ):
                amount *= 1000

            if amount > 500:
                requirements["budget"] = amount

    # ============================================================
    # 4. Number of people
    # ============================================================
    people_match = re.search(
        r"(?:for|feed|serve)\s+(\d+)\s*"
        r"(?:people|persons|members)?",
        request,
        re.IGNORECASE,
    )

    if people_match:
        requirements["people"] = int(people_match.group(1))

    # ============================================================
    # 5. Product/category detection
    # ============================================================

    # Kitchen tools / utensils
    if any(
        word in lowered
        for word in (
            "utensil",
            "utensils",
            "spatula",
            "ladle",
            "tongs",
            "whisk",
            "kitchen tool",
            "kitchen tools",
            "wooden tool",
            "wooden tools",
        )
    ):
        requirements["category"] = "kitchen tools"

    # Cookware
    elif any(
        word in lowered
        for word in (
            "cookware",
            "cooking",
            "pan",
            "pot",
            "skillet",
            "wok",
        )
    ):
        requirements["category"] = "cookware"

    # Bakeware
    elif any(
        word in lowered
        for word in (
            "bakeware",
            "baking",
            "baking tray",
            "baking pan",
            "cake pan",
            "oven tray",
        )
    ):
        requirements["category"] = "bakeware"

    # ============================================================
    # 6. Durability
    # ============================================================
    if any(
        word in lowered
        for word in (
            "durable",
            "heavy duty",
            "long lasting",
        )
    ):
        requirements["durable"] = True

    # ============================================================
    # 7. Product name hints
    # ============================================================
    if "acacia wood" in lowered:
        requirements["product_keywords"] = [
            "acacia",
            "wood",
        ]

    elif "wooden" in lowered or "wood" in lowered:
        requirements["product_keywords"] = [
            "wood",
            "wooden",
        ]

    # ============================================================
    # 8. Defaults
    # ============================================================
    requirements.setdefault("budget", 8000)

    # IMPORTANT:
    # Don't blindly assume cookware when we already have an
    # explicit product ID.
    if "category" not in requirements and "product_id" not in requirements:
        requirements["category"] = "cookware"

    requirements.setdefault(
        "use_case",
        "family cooking"
        if requirements.get("people", 0)
        else "daily cooking",
    )

    return requirements


def calculate_match_score(
    product: dict,
    buyer_request: str,
    budget: int,
    existing_selection: list[dict] | None = None,
) -> dict:

    requirements = extract_requirements(
        buyer_request,
        {"budget": budget},
    )

    price = _price_value(product)

    product_id = str(
        product.get("id")
        or product.get("product_id")
        or ""
    ).lower()

    category = str(
        product.get("category") or ""
    ).lower()

    description = (
        f"{product.get('name', '')} "
        f"{product.get('description', '')}"
    ).lower()

    # ============================================================
    # Exact product match
    # ============================================================
    exact_product_requested = (
        requirements.get("product_id") == product_id
    )

    # ============================================================
    # Budget
    # ============================================================
    budget_fit = (
        100
        if price <= budget
        else max(
            0,
            round((budget / max(price, 1)) * 100),
        )
    )

    # ============================================================
    # Use case
    # ============================================================
    use_case_match = (
        90
        if requirements["use_case"].split()[0] in description
        or "cook" in description
        else 55
    )

    # ============================================================
    # Category
    # ============================================================
    requested_category = requirements.get(
        "category",
        "cookware",
    )

    compatible_categories = {
        "cast iron",
        "stainless steel",
        "non-stick",
        "carbon steel",
        "dutch oven",
        "cookware",
        "kitchen tools",
        "bakeware",
    }

    compatibility = (
        100
        if requested_category == category
        else 90
        if (
            requested_category == "cookware"
            and category in compatible_categories
        )
        else 45
    )

    # ============================================================
    # Stock
    # ============================================================
    stock = (
        100
        if product.get("stock", 0) > 0
        else 0
    )

    # ============================================================
    # Product fit
    # ============================================================
    product_fit = (
        100
        if requirements.get("durable")
        and any(
            word in description
            for word in (
                "durable",
                "heavy",
                "cast iron",
                "steel",
            )
        )
        else 80
    )

    # ============================================================
    # Keyword matching
    # ============================================================
    keyword_match = 0

    requested_keywords = requirements.get(
        "product_keywords",
        [],
    )

    if requested_keywords:
        matched_keywords = sum(
            1
            for keyword in requested_keywords
            if keyword in description
        )

        if matched_keywords:
            keyword_match = 100

    # ============================================================
    # Final score
    # ============================================================
    factors = {
        "budget_fit": budget_fit,
        "use_case_match": use_case_match,
        "compatibility": compatibility,
        "stock": stock,
        "product_fit": product_fit,
    }

    score = round(
        sum(
            factors[key] * weight
            for key, weight in zip(
                factors,
                (0.3, 0.3, 0.2, 0.1, 0.1),
            )
        )
    )

    # Exact product request should dominate generic ranking.
    if exact_product_requested:
        score += 100

    if keyword_match:
        score += 20

    # ============================================================
    # Reasons
    # ============================================================
    reasons = []

    if exact_product_requested:
        reasons.append(
            "Exact product requested by buyer"
        )

    if requested_category == category:
        reasons.append(
            f"Matches the requested {requested_category} category"
        )
    elif compatibility >= 80:
        reasons.append(
            "Compatible with the requested category"
        )
    else:
        reasons.append(
            "Category is a partial match"
        )

    if keyword_match:
        reasons.append(
            "Matches the requested product description"
        )

    if requirements.get("people"):
        reasons.append(
            f"Suitable for family cooking for "
            f"{requirements['people']} people"
        )

    reasons.append(
        "Within the requested budget"
        if budget_fit == 100
        else "Exceeds the requested budget"
    )

    reasons.append(
        "Currently in stock"
        if stock
        else "Currently out of stock"
    )

    return {
        "score": score,
        "factors": factors,
        "why_recommended": reasons,
    }

def _price_value(product: dict) -> float:
    return float(product.get("price") if product.get("price") is not None else product.get("price_inr", 0))