import os
import json
import razorpay
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))

# Initialize Razorpay Client
rzp_key = os.getenv("RAZORPAY_KEY_ID")
rzp_secret = os.getenv("RAZORPAY_KEY_SECRET")
client = razorpay.Client(auth=(rzp_key, rzp_secret))

def load_catalog():
    # Resolves path dynamically regardless of execution directory
    base_dir = os.path.dirname(os.path.abspath(__file__))
    catalog_path = os.path.join(base_dir, "merchant_catalog.json")
    with open(catalog_path, "r") as f:
        return json.load(f)
def create_demo_payment_link(product_id: str):
    data = load_catalog()
    product = next((p for p in data["catalog"] if p["product_id"] == product_id), None)
    
    if not product:
        print(f"❌ Product {product_id} not found!")
        return

    # Razorpay expects amounts in PAISE (1 INR = 100 Paise)
    amount_in_paise = round(product["price_inr"] * 100)

    # 1. Create Razorpay Order
    order_data = {
        "amount": amount_in_paise,
        "currency": "INR",
        "receipt": f"receipt_{product_id}",
        "notes": {
            "product_id": product_id,
            "product_name": product["name"]
        }
    }
    
    order = client.order.create(data=order_data)
    print(f"✅ Created Razorpay Order ID: {order['id']}")
    print(f"   Item: {product['name']} | Amount: ₹{product['price_inr']}")

    # 2. Generate Payment Link for manual testing
    link_data = {
        "amount": amount_in_paise,
        "currency": "INR",
        "accept_partial": False,
        "description": f"Purchase: {product['name']}",
       "customer": {
    "name": "Test Customer",
    "email": "test.customer@example.com",
    "contact": "+919876543210"  # Updated from +919999999999
},
        "notify": {"sms": False, "email": False},
        "reminder_enable": False,
        "notes": {"order_id": order['id']}
    }

    payment_link = client.payment_link.create(data=link_data)
    print(f"🔗 Payment Link Generated: {payment_link['short_url']}")
    print("👉 Open the URL above in your browser to complete a test payment using Razorpay Test Cards.")

def verify_payment_signature(payment_id: str, order_id: str, signature: str) -> bool:
    """Utility to verify payment payload signature from Razorpay."""
    params_dict = {
        'razorpay_order_id': order_id,
        'razorpay_payment_id': payment_id,
        'razorpay_signature': signature
    }
    try:
        client.utility.verify_payment_signature(params_dict)
        print("✅ Signature Verification Succeeded! Payment is legitimate.")
        return True
    except razorpay.errors.SignatureVerificationError:
        print("❌ Signature Verification Failed!")
        return False

if __name__ == "__main__":
    # Create a test payment link for product_id 'prod_102' (Ergonomic Mouse)
    create_demo_payment_link("prod_102")
