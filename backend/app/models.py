from pydantic import BaseModel, Field
from typing import List
from datetime import datetime, timezone

class CartItem(BaseModel):
    product_id: str
    name: str
    price_inr: float = Field(gt=0)
    quantity: int = Field(default=1, ge=1)

class Cart(BaseModel):
    cart_id: str
    items: List[CartItem]
    applied_discount_pct: float = Field(default=0.0, ge=0, le=100)

    @property
    def total_amount(self) -> float:
        subtotal = sum(item.price_inr * item.quantity for item in self.items)
        return round(subtotal * (1 - (self.applied_discount_pct / 100)), 2)

class AuditLogEntry(BaseModel):
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    action_type: str
    reasoning: str
    amount_before: float
    amount_after: float
    approved_by: str  # Options: "rule", "human", "agent"
    outcome: str      # Options: "EXECUTED", "BLOCKED", "PENDING_APPROVAL"

class GuardrailConfig(BaseModel):
    max_discount_pct: float
    max_auto_approve_amount: float
    allowed_actions: List[str]
    requires_human_approval_above: float
