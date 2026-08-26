"""Deterministic policy tools used by the checkout agent."""

import json
from pathlib import Path

from app.models import AuditLogEntry, GuardrailConfig

BASE_DIR = Path(__file__).resolve().parent
with (BASE_DIR / "guardrails.json").open(encoding="utf-8") as file:
    GUARDRAILS = GuardrailConfig(**json.load(file))

AUDIT_TRAIL: list[AuditLogEntry] = []


def get_catalog() -> list[dict]:
    """Return the current catalog for an agent tool call or a local demo."""
    with (BASE_DIR / "merchant_catalog.json").open(encoding="utf-8") as file:
        return json.load(file)["catalog"]


def execute_discount_guardrail(current_amount: float, discount_pct: float) -> dict:
    """Evaluate a discount under fixed policy; this function never calls an LLM."""
    if current_amount < 0 or discount_pct < 0:
        return {"status": "BLOCKED", "applied_amount": current_amount, "reason": "Amounts and discounts must be non-negative."}
    if discount_pct > GUARDRAILS.max_discount_pct:
        reason = f"BLOCKED: requested {discount_pct:g}% exceeds the {GUARDRAILS.max_discount_pct:g}% limit."
        status, amount, approver = "BLOCKED", current_amount, "rule"
    else:
        amount = round(current_amount * (1 - discount_pct / 100), 2)
        if amount > GUARDRAILS.requires_human_approval_above:
            reason = f"PENDING_APPROVAL: final amount INR {amount:.2f} exceeds the auto-approval threshold."
            status, approver = "PENDING_APPROVAL", "human"
        else:
            reason = f"EXECUTED: {discount_pct:g}% discount is within policy limits."
            status, approver = "EXECUTED", "rule"

    AUDIT_TRAIL.append(AuditLogEntry(action_type="apply_discount", reasoning=reason, amount_before=current_amount,
                                     amount_after=amount, approved_by=approver, outcome=status))
    return {"status": status, "applied_amount": amount, "reason": reason}


if __name__ == "__main__":
    print(f"Catalog contains {len(get_catalog())} items.")
    print(execute_discount_guardrail(1500, 10))
    print(execute_discount_guardrail(1500, 30))
