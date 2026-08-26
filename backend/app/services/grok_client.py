"""Groq-backed growth recommendations with deterministic policy enforcement."""

import json
import os
from uuid import uuid4

import httpx
from dotenv import load_dotenv

from app.schemas.agent import AgentProposal
from app.services.recommendation_engine import rank_products

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
MAX_ADDONS = 3
MAX_QTY = 20
MAX_DISCOUNT_PCT = 15.0
MAX_CART_INCREASE_PCT = 30.0


def _product_id(product: dict) -> str:
    return str(product.get("id") or product.get("product_id") or "")


def _price(product: dict) -> float:
    return float(product.get("price") if product.get("price") is not None else product.get("price_inr", 0))


def _catalog_context(catalog: list[dict]) -> list[dict]:
    return [{
        "product_id": _product_id(product), "name": product.get("name", ""),
        "category": product.get("category", ""), "price": _price(product),
        "stock": product.get("stock", 0), "description": product.get("description", ""),
        "attributes": product.get("attributes", []),
        "suitable_for": product.get("suitable_for", ["family cooking", "daily use"]),
    } for product in catalog]


def _parse_content(content: str, cart: dict, catalog: list[dict]) -> AgentProposal:
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[-1]
        if content.endswith("```"):
            content = content[:-3].strip()
    data = json.loads(content)
    cart_names = ", ".join(item.get("name", "the current cart") for item in cart.get("items", []))
    products = {_product_id(product): product for product in catalog}
    for addon in data.get("addons", []):
        if not addon.get("reasoning"):
            product = products.get(addon.get("product_id"), {})
            addon["reasoning"] = f"Complements {cart_names} with {product.get('name', 'a useful cooking accessory')} and is currently in stock."
    data.setdefault("reasoning", f"Selected useful in-stock products that complement {cart_names}.")
    return AgentProposal.model_validate(data)


def _validate_proposal(proposal: AgentProposal, cart: dict, catalog: list[dict]) -> dict:
    available = {_product_id(product): product for product in catalog}
    cart_ids = {item.get("product_id") for item in cart.get("items", [])}
    max_amount = max(2000.0, float(cart.get("subtotal", 0) or 0) * MAX_CART_INCREASE_PCT / 100)
    addons = []
    addon_total = 0.0
    for addon in proposal.addons:
        product = available.get(addon.product_id)
        if not product or product.get("stock", 0) <= 0 or addon.product_id in cart_ids:
            continue
        if addon.qty > min(int(product.get("stock", 0)), MAX_QTY):
            continue
        line_total = _price(product) * addon.qty
        if addon_total + line_total > max_amount:
            continue
        addons.append(addon.model_dump())
        addon_total += line_total
    if proposal.discount_pct > MAX_DISCOUNT_PCT:
        raise ValueError(f"discount exceeds {MAX_DISCOUNT_PCT:g}% policy limit")
    return {"addons": addons, "discount_pct": proposal.discount_pct,
            "reasoning": proposal.reasoning, "confidence": proposal.confidence}


def suggest(cart: dict, catalog: list[dict]) -> tuple[dict, bool, str | None]:
    trace_id = uuid4().hex
    groq_key = os.getenv("GROQ_API_KEY")
    if not groq_key:
        return _fallback(cart, catalog, "GROQ_API_KEY is not configured.", trace_id)

    model = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
    ranked = rank_products(cart, catalog)
    policy = {"max_addons": MAX_ADDONS, "max_qty": MAX_QTY,
              "max_discount_pct": MAX_DISCOUNT_PCT, "max_cart_increase_pct": MAX_CART_INCREASE_PCT}
    system_prompt = (
        "You are a merchant-side Growth Agent. Increase cart value only when useful to the customer. "
        "Use only supplied in-stock catalog products, never repeat cart products, select at most 3 addons, "
        "keep quantities reasonable, obey policy limits, and never optimize solely for revenue. "
        "Do not reveal chain-of-thought; provide concise decision explanations. Return JSON only with keys "
        "addons, discount_pct, reasoning, confidence."
    )
    user_prompt = json.dumps({
        "current_cart": cart.get("items", []), "cart_subtotal": cart.get("subtotal", 0),
        "policy": policy, "catalog": _catalog_context(catalog),
        "candidate_scores": [{"product_id": _product_id(item["product"]), "score": item["score"],
                              "reasons": item["reasons"]} for item in ranked],
    }, ensure_ascii=False)
    payload = {"model": model, "temperature": 0.2,
               "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
               "response_format": {"type": "json_object"}}

    last_error = None
    for attempt in range(2):
        try:
            response = httpx.post(GROQ_API_URL,
                                  headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                                  json=payload, timeout=httpx.Timeout(15.0, connect=5.0))
            response.raise_for_status()
            validated = _validate_proposal(_parse_content(response.json()["choices"][0]["message"]["content"], cart, catalog), cart, catalog)
            validated["execution_metadata"] = {"trace_id": trace_id, "provider": "groq", "model": model, "attempt": attempt + 1}
            return validated, False, None
        except httpx.TimeoutException as exc:
            last_error = f"Groq timeout after 15 seconds: {exc}"
        except httpx.HTTPStatusError as exc:
            last_error = f"Groq API error {exc.response.status_code}"
            if exc.response.status_code < 500:
                break
        except (httpx.RequestError, KeyError, IndexError, TypeError, ValueError) as exc:
            last_error = f"Invalid Groq response: {exc}"
            if isinstance(exc, ValueError) and "policy limit" in str(exc):
                break
    return _fallback(cart, catalog, last_error or "Groq request failed.", trace_id)


def _fallback(cart: dict, catalog: list[dict], error: str, trace_id: str) -> tuple[dict, bool, str]:
    ranked = rank_products(cart, catalog, limit=MAX_ADDONS)
    addons = []
    addon_total = 0.0
    max_amount = max(2000.0, float(cart.get("subtotal", 0) or 0) * MAX_CART_INCREASE_PCT / 100)
    for item in ranked:
        product = item["product"]
        line_total = _price(product)
        if addon_total + line_total > max_amount:
            continue
        addons.append({"product_id": _product_id(product), "qty": 1,
                       "reasoning": "; ".join(item["reasons"][:2]) or "Compatible with the current cart."})
        addon_total += line_total
    return ({"addons": addons, "discount_pct": 0,
             "reasoning": "Deterministic compatibility fallback selected useful in-stock products.",
             "execution_metadata": {"trace_id": trace_id, "provider": "local_fallback", "error": error}}, True, error)