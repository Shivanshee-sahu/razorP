from enum import Enum
from typing import Dict, Any

class AgentPermission(str, Enum):
    READ_CATALOG = "READ_CATALOG"
    READ_CART = "READ_CART"
    RECOMMEND_PRODUCTS = "RECOMMEND_PRODUCTS"
    MODIFY_CART = "MODIFY_CART"
    APPLY_DISCOUNT = "APPLY_DISCOUNT"
    CREATE_CHECKOUT = "CREATE_CHECKOUT"
    PAYMENT = "PAYMENT"

POLICY_CONFIG = {
     "max_discount_pct": 15,
    "max_auto_approve_amount": 2000,

    "allowed_actions": [
        "suggest_addon",
        "apply_discount",
        "create_order"
    ],

    "requires_human_approval_above": 2000,

    # Existing controls
    "max_ai_addons": 3,
    "max_cart_increase_pct": 30
}

AGENT_PERMISSIONS = {
    "GrowthAgent": [
        AgentPermission.READ_CATALOG,
        AgentPermission.READ_CART,
        AgentPermission.RECOMMEND_PRODUCTS,
        AgentPermission.APPLY_DISCOUNT,
        AgentPermission.MODIFY_CART
    ],
    "AIBuyer": [
        AgentPermission.READ_CATALOG,
        AgentPermission.RECOMMEND_PRODUCTS,
        AgentPermission.MODIFY_CART
    ]
}

def check_agent_permission(agent_name: str, action: AgentPermission) -> bool:
    return action in AGENT_PERMISSIONS.get(agent_name, [])

def validate_policy(amount: int, discount_pct: int = 0) -> Dict[str, Any]:
    threshold = POLICY_CONFIG["auto_approval_threshold"]
    max_disc = POLICY_CONFIG["max_discount_pct"]
    
    requires_approval = amount > threshold or discount_pct > max_disc
    return {
        "amount": amount,
        "threshold": threshold,
        "discount_requested": discount_pct,
        "requires_approval": requires_approval,
        "status": "APPROVAL_REQUIRED" if requires_approval else "APPROVED"
    }