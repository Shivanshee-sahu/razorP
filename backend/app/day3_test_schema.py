"""Manual smoke check for the schema models."""

import json
from pathlib import Path

from app.models import AuditLogEntry, Cart, CartItem, GuardrailConfig


def run_day3_check():
    base_dir = Path(__file__).resolve().parent
    with (base_dir / "guardrails.json").open(encoding="utf-8") as file:
        config = GuardrailConfig(**json.load(file))
    print(f"Loaded guardrails: max discount = {config.max_discount_pct}%, auto-approve cap = INR {config.max_auto_approve_amount}")

    item = CartItem(product_id="prod_102", name="Ergonomic Mouse", price_inr=1999)
    cart = Cart(cart_id="cart_001", items=[item], applied_discount_pct=10)
    print(f"Cart total (with 10% discount): INR {cart.total_amount}")

    log = AuditLogEntry(action_type="apply_discount", reasoning="Upsell bundle triggered", amount_before=1999.0,
                        amount_after=cart.total_amount, approved_by="rule", outcome="EXECUTED")
    print(f"Audit log generated: [{log.timestamp}] {log.action_type} -> {log.outcome}")


if __name__ == "__main__":
    run_day3_check()
