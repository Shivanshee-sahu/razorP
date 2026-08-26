import json
from pathlib import Path

CONFIG = json.loads((Path(__file__).resolve().parents[1] / "guardrails.json").read_text(encoding="utf-8"))

def validate_discount(requested_pct: float) -> dict:
    maximum = CONFIG["max_discount_pct"]
    if requested_pct < 0:
        return {"requested": requested_pct, "accepted": 0, "status": "blocked", "reason": "Negative discounts are not valid."}
    if requested_pct > maximum:
        return {"requested": requested_pct, "accepted": maximum, "status": "blocked", "reason": f"Requested {requested_pct:g}% exceeded the {maximum:g}% policy limit and was clamped."}
    return {"requested": requested_pct, "accepted": requested_pct, "status": "ok", "reason": f"{requested_pct:g}% is within the configured policy limit."}

def gate_addons(addon_total: int) -> dict:
    cap = CONFIG["max_auto_approve_amount"]
    return {"status": "pending" if addon_total > cap else "ok", "reason": f"Add-ons total INR {addon_total:,}; {'human approval is required' if addon_total > cap else 'auto-approval is permitted'} under the INR {cap:,} threshold."}
