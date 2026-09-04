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

# ============================================================
# VERIFY PAYMENT + FETCH PAYMENT DETAILS
# ============================================================

def verify_payment(
    order_id: str,
    payment_id: str,
    signature: str
) -> dict:

    try:
        # --------------------------------------------------------
        # STEP 1: Verify cryptographic signature
        # --------------------------------------------------------

        client().utility.verify_payment_signature(
            {
                "razorpay_order_id": order_id,
                "razorpay_payment_id": payment_id,
                "razorpay_signature": signature,
            }
        )

        print("Razorpay payment signature verified.")

        # --------------------------------------------------------
        # STEP 2: Fetch actual payment from Razorpay
        # --------------------------------------------------------

        payment = client().payment.fetch(payment_id)

        print("Razorpay payment fetched.")
        print("Payment ID:", payment.get("id"))
        print("Payment Status:", payment.get("status"))
        print("Payment Amount:", payment.get("amount"))
        print("Payment Currency:", payment.get("currency"))
        print("Payment Order ID:", payment.get("order_id"))

        # --------------------------------------------------------
        # STEP 3: Verify payment belongs to supplied order
        # --------------------------------------------------------

        if payment.get("order_id") != order_id:
            raise RuntimeError(
                "Payment does not belong to the supplied Razorpay order."
            )

        # --------------------------------------------------------
        # STEP 4: Payment must be captured
        # --------------------------------------------------------

        if payment.get("status") != "captured":
            raise RuntimeError(
                f"Payment is not captured. Current status: "
                f"{payment.get('status')}"
            )

        # --------------------------------------------------------
        # STEP 5: Fetch actual Razorpay order
        # --------------------------------------------------------

        order = client().order.fetch(order_id)

        print("Razorpay order fetched.")
        print("Order ID:", order.get("id"))
        print("Order Amount:", order.get("amount"))
        print("Order Currency:", order.get("currency"))
        print("Order Status:", order.get("status"))

        # --------------------------------------------------------
        # STEP 6: Verify payment amount matches Razorpay order
        # --------------------------------------------------------

        if payment.get("amount") != order.get("amount"):
            raise RuntimeError(
                "Payment amount does not match Razorpay order amount."
            )

        # --------------------------------------------------------
        # STEP 7: Verify currency
        # --------------------------------------------------------

        if payment.get("currency") != "INR":
            raise RuntimeError(
                f"Unexpected payment currency: "
                f"{payment.get('currency')}"
            )

        if order.get("currency") != "INR":
            raise RuntimeError(
                f"Unexpected order currency: "
                f"{order.get('currency')}"
            )

        # --------------------------------------------------------
        # SUCCESS
        # --------------------------------------------------------

        return {
            "verified": True,
            "payment": payment,
            "order": order,
        }

    except razorpay.errors.SignatureVerificationError:

        print("Razorpay payment signature verification failed.")

        raise RuntimeError(
            "Payment signature verification failed."
        )

    except Exception as exc:

        print("========================================")
        print("RAZORPAY PAYMENT VERIFICATION FAILED")
        print("Exception:", type(exc).__name__)
        print("Message:", str(exc))
        print("========================================")

        raise