import os
from pathlib import Path

import razorpay
from dotenv import load_dotenv


# ============================================================
# LOAD BACKEND .ENV
# ============================================================

BASE_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BASE_DIR / ".env"

load_dotenv(ENV_FILE)


# ============================================================
# RAZORPAY CREDENTIALS
# ============================================================

KEY_ID = os.getenv("RAZORPAY_KEY_ID")
KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET")


if not KEY_ID:
    raise RuntimeError(
        f"RAZORPAY_KEY_ID is missing. Checked: {ENV_FILE}"
    )

if not KEY_SECRET:
    raise RuntimeError(
        f"RAZORPAY_KEY_SECRET is missing. Checked: {ENV_FILE}"
    )


KEY_ID = KEY_ID.strip()
KEY_SECRET = KEY_SECRET.strip()


# ============================================================
# DEBUG INFORMATION
# ============================================================

print("========================================")
print("RAZORPAY CONFIGURATION")
print("========================================")
print("ENV FILE:", ENV_FILE)
print("ENV EXISTS:", ENV_FILE.exists())
print("KEY PREFIX:", KEY_ID[:9])
print("KEY LENGTH:", len(KEY_ID))
print("SECRET LENGTH:", len(KEY_SECRET))
print("========================================")


# ============================================================
# CLIENT
# ============================================================

def client() -> razorpay.Client:
    return razorpay.Client(
        auth=(KEY_ID, KEY_SECRET)
    )


# ============================================================
# CREATE ORDER
# ============================================================

def create_order(amount_inr: int, receipt: str) -> dict:

    amount_paise = int(amount_inr * 100)

    print("========================================")
    print("CREATING RAZORPAY ORDER")
    print("Amount INR:", amount_inr)
    print("Amount Paise:", amount_paise)
    print("Receipt:", receipt)
    print("========================================")

    try:

        order = client().order.create(
            {
                "amount": amount_paise,
                "currency": "INR",
                "receipt": receipt,
            }
        )

        print("RAZORPAY ORDER CREATED")
        print("Order ID:", order.get("id"))

        return order

    except Exception as exc:

        print("========================================")
        print("RAZORPAY ORDER CREATION FAILED")
        print("Exception:", type(exc).__name__)
        print("Message:", str(exc))
        print("========================================")

        raise


# ============================================================
# VERIFY PAYMENT
# ============================================================

def verify(
    order_id: str,
    payment_id: str,
    signature: str
) -> None:

    try:

        client().utility.verify_payment_signature(
            {
                "razorpay_order_id": order_id,
                "razorpay_payment_id": payment_id,
                "razorpay_signature": signature,
            }
        )

        print("Razorpay payment signature verified.")

    except razorpay.errors.SignatureVerificationError:

        print("Razorpay payment signature verification failed.")

        raise RuntimeError(
            "Payment signature verification failed."
        )