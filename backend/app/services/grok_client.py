
import json
import os
from uuid import uuid4

import httpx
from dotenv import load_dotenv

from app.schemas.agent import AgentProposal
from app.services.recommendation_engine import rank_products


load_dotenv(
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",
        ".env",
    )
)


# ============================================================
# CONFIG
# ============================================================

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

MAX_ADDONS = 3
MAX_QTY = 20

# Backend Growth Agent policy
MAX_DISCOUNT_PCT = 15.0
MAX_CART_INCREASE_PCT = 30.0


# ============================================================
# HELPERS
# ============================================================

def _product_id(product: dict) -> str:
    return str(
        product.get("id")
        or product.get("product_id")
        or ""
    )


def _price(product: dict) -> float:
    return float(
        product.get("price")
        if product.get("price") is not None
        else product.get("price_inr", 0)
    )


def _catalog_context(catalog: list[dict]) -> list[dict]:
    return [
        {
            "product_id": _product_id(product),
            "name": product.get("name", ""),
            "category": product.get("category", ""),
            "price": _price(product),
            "stock": product.get("stock", 0),
            "description": product.get("description", ""),
            "attributes": product.get("attributes", []),
            "suitable_for": product.get(
                "suitable_for",
                ["family cooking", "daily use"],
            ),
        }
        for product in catalog
    ]


# ============================================================
# PARSE GROQ RESPONSE
# ============================================================

def _parse_content(
    content: str,
    cart: dict,
    catalog: list[dict],
) -> AgentProposal:

    content = content.strip()

    # Remove accidental markdown code fences
    if content.startswith("```"):
        content = content.split(
            "\n",
            1,
        )[-1]

        if content.endswith("```"):
            content = content[:-3].strip()

    data = json.loads(content)

    cart_names = ", ".join(
        item.get(
            "name",
            "the current cart",
        )
        for item in cart.get("items", [])
    )

    products = {
        _product_id(product): product
        for product in catalog
    }

    # --------------------------------------------------------
    # Normalize addon reasoning
    # --------------------------------------------------------

    for addon in data.get("addons", []):

        product = products.get(
            addon.get("product_id"),
            {},
        )

        reasoning = str(
            addon.get("reasoning", "")
        ).strip()

        if not reasoning:
            reasoning = (
                f"Complements {cart_names} with "
                f"{product.get('name', 'a useful cooking accessory')} "
                "and is currently in stock."
            )

        # AgentProposal schema currently allows up to 300 chars.
        addon["reasoning"] = reasoning[:280]

    # --------------------------------------------------------
    # Normalize overall reasoning
    # --------------------------------------------------------

    data["reasoning"] = str(
        data.get("reasoning")
        or (
            "Selected useful in-stock products "
            f"that complement {cart_names}."
        )
    ).strip()[:280]

    # --------------------------------------------------------
    # Normalize discount
    # --------------------------------------------------------

    try:
        discount = float(
            data.get("discount_pct", 0)
        )
    except (TypeError, ValueError):
        discount = 0.0

    # Never allow negative discounts
    discount = max(
        0.0,
        discount,
    )

    # Never allow AI to exceed backend policy
    discount = min(
        MAX_DISCOUNT_PCT,
        discount,
    )

    data["discount_pct"] = discount

    return AgentProposal.model_validate(data)


# ============================================================
# DETERMINISTIC VALIDATION
# ============================================================

def _validate_proposal(
    proposal: AgentProposal,
    cart: dict,
    catalog: list[dict],
) -> dict:

    available = {
        _product_id(product): product
        for product in catalog
    }

    cart_ids = {
        item.get("product_id")
        for item in cart.get("items", [])
    }

    max_amount = max(
        2000.0,
        float(
            cart.get("subtotal", 0) or 0
        )
        * MAX_CART_INCREASE_PCT
        / 100,
    )

    addons = []
    addon_total = 0.0

    # --------------------------------------------------------
    # Validate addons
    # --------------------------------------------------------

    for addon in proposal.addons:

        product = available.get(
            addon.product_id
        )

        # Product must exist
        if not product:
            continue

        # Product must be in stock
        if product.get("stock", 0) <= 0:
            continue

        # Never recommend something already in cart
        if addon.product_id in cart_ids:
            continue

        # Validate quantity
        if addon.qty > min(
            int(product.get("stock", 0)),
            MAX_QTY,
        ):
            continue

        if addon.qty <= 0:
            continue

        line_total = (
            _price(product)
            * addon.qty
        )

        # Validate cart increase
        if (
            addon_total + line_total
            > max_amount
        ):
            continue

        addons.append(
            addon.model_dump()
        )

        addon_total += line_total

    # --------------------------------------------------------
    # Validate discount
    # --------------------------------------------------------

    discount_pct = float(
        proposal.discount_pct
    )

    if discount_pct < 0:
        raise ValueError(
            "discount cannot be negative"
        )

    if discount_pct > MAX_DISCOUNT_PCT:
        raise ValueError(
            f"discount exceeds "
            f"{MAX_DISCOUNT_PCT:g}% policy limit"
        )

    return {
        "addons": addons,
        "discount_pct": discount_pct,
        "reasoning": proposal.reasoning,
        "confidence": proposal.confidence,
    }


# ============================================================
# MAIN GROQ RECOMMENDATION
# ============================================================

def suggest(
    cart: dict,
    catalog: list[dict],
) -> tuple[dict, bool, str | None]:

    trace_id = uuid4().hex

    groq_key = os.getenv(
        "GROQ_API_KEY"
    )

    # --------------------------------------------------------
    # No API key → deterministic fallback
    # --------------------------------------------------------

    if not groq_key:
        return _fallback(
            cart,
            catalog,
            "GROQ_API_KEY is not configured.",
            trace_id,
        )

    model = os.getenv(
        "GROQ_MODEL",
        "openai/gpt-oss-20b",
    )

    ranked = rank_products(
        cart,
        catalog,
    )

    policy = {
        "max_addons": MAX_ADDONS,
        "max_qty": MAX_QTY,
        "max_discount_pct": MAX_DISCOUNT_PCT,
        "max_cart_increase_pct": MAX_CART_INCREASE_PCT,
    }

    # ========================================================
    # SYSTEM PROMPT
    # ========================================================

    system_prompt = (
        "You are a merchant-side Growth Agent. "

        "Your goal is to increase cart value only when "
        "doing so is genuinely useful to the customer. "

        "Use only supplied in-stock catalog products. "

        "Never recommend products already in the cart. "

        "Select at most 3 addons and keep quantities reasonable. "

        "Obey every supplied policy limit. "

        "Never optimize solely for revenue. "

        # ----------------------------------------------------
        # AUTONOMOUS DISCOUNT DECISION
        # ----------------------------------------------------

        "You may autonomously propose a discount when "
        "it is commercially justified and may improve "
        "the likelihood that the customer purchases the addon. "

        "You are responsible for deciding whether a discount "
        "is actually useful. "

        "Use 0 when no discount is justified. "

        "Do not always provide a discount. "

        "When a discount is justified, choose the smallest "
        "reasonable discount rather than automatically choosing "
        "the maximum. "

        "The discount must never exceed the supplied "
        "max_discount_pct policy. "

        # ----------------------------------------------------
        # REASONING
        # ----------------------------------------------------

        "Do not provide chain-of-thought. "

        "For every addon, provide ONE concise "
        "customer-facing reason of at most 180 characters. "

        "The overall reasoning must be concise, "
        "at most 250 characters. "

        # ----------------------------------------------------
        # OUTPUT
        # ----------------------------------------------------

        "Return valid JSON only with exactly these keys: "
        "addons, discount_pct, reasoning, confidence."
    )

    # ========================================================
    # USER PROMPT
    # ========================================================

    user_prompt = json.dumps(
        {
            "current_cart": cart.get(
                "items",
                [],
            ),

            "cart_subtotal": cart.get(
                "subtotal",
                0,
            ),

            "policy": policy,

            "catalog": _catalog_context(
                catalog
            ),

            "candidate_scores": [
                {
                    "product_id": _product_id(
                        item["product"]
                    ),
                    "score": item["score"],
                    "reasons": item["reasons"],
                }
                for item in ranked
            ],
        },
        ensure_ascii=False,
    )

    # ========================================================
    # GROQ PAYLOAD
    # ========================================================

    payload = {
        "model": model,
        "temperature": 0.2,

        "messages": [
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": user_prompt,
            },
        ],

        "response_format": {
            "type": "json_object"
        },
    }

    # ========================================================
    # REQUEST / RETRY
    # ========================================================

    last_error = None

    for attempt in range(2):

        try:

            response = httpx.post(
                GROQ_API_URL,

                headers={
                    "Authorization": (
                        f"Bearer {groq_key}"
                    ),
                    "Content-Type": (
                        "application/json"
                    ),
                },

                json=payload,

                timeout=httpx.Timeout(
                    15.0,
                    connect=5.0,
                ),
            )

            response.raise_for_status()

            content = (
                response.json()
                ["choices"][0]
                ["message"]
                ["content"]
            )

            proposal = _parse_content(
                content,
                cart,
                catalog,
            )

            validated = _validate_proposal(
                proposal,
                cart,
                catalog,
            )

            validated[
                "execution_metadata"
            ] = {
                "trace_id": trace_id,
                "provider": "groq",
                "model": model,
                "attempt": attempt + 1,
            }

            return (
                validated,
                False,
                None,
            )

        except httpx.TimeoutException as exc:

            last_error = (
                "Groq timeout after 15 seconds: "
                f"{exc}"
            )

        except httpx.HTTPStatusError as exc:

            last_error = (
                f"Groq API error "
                f"{exc.response.status_code}"
            )

            # Don't retry client errors such as 400/401
            if exc.response.status_code < 500:
                break

        except (
            httpx.RequestError,
            KeyError,
            IndexError,
            TypeError,
            ValueError,
        ) as exc:

            last_error = (
                f"Invalid Groq response: {exc}"
            )

            if (
                isinstance(exc, ValueError)
                and "policy limit" in str(exc)
            ):
                break

    # ========================================================
    # FALLBACK
    # ========================================================

    return _fallback(
        cart,
        catalog,
        last_error or "Groq request failed.",
        trace_id,
    )


# ============================================================
# DETERMINISTIC FALLBACK
# ============================================================

def _fallback(
    cart: dict,
    catalog: list[dict],
    error: str,
    trace_id: str,
) -> tuple[dict, bool, str]:

    ranked = rank_products(
        cart,
        catalog,
        limit=MAX_ADDONS,
    )

    addons = []
    addon_total = 0.0

    max_amount = max(
        2000.0,
        float(
            cart.get("subtotal", 0) or 0
        )
        * MAX_CART_INCREASE_PCT
        / 100,
    )

    for item in ranked:

        product = item["product"]

        line_total = _price(
            product
        )

        if (
            addon_total + line_total
            > max_amount
        ):
            continue

        addons.append(
            {
                "product_id": _product_id(
                    product
                ),

                "qty": 1,

                "reasoning": (
                    "; ".join(
                        item["reasons"][:2]
                    )
                    or
                    "Compatible with the current cart."
                )[:280],
            }
        )

        addon_total += line_total

    return (
        {
            "addons": addons,

            # Safe fallback:
            # no autonomous discount when AI is unavailable.
            "discount_pct": 0,

            "reasoning": (
                "Deterministic compatibility fallback "
                "selected useful in-stock products."
            ),

            "confidence": 0.0,

            "execution_metadata": {
                "trace_id": trace_id,
                "provider": "local_fallback",
                "error": error,
            },
        },
        True,
        error,
    )

