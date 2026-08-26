import os

import requests
import streamlit as st

API_URL = os.getenv("API_URL", "http://127.0.0.1:8000").rstrip("/")
TIMEOUT_SECONDS = 15

st.set_page_config(page_title="Razorpay Agentic Upsell", layout="wide")
st.title("AI-Native Merchant Upsell Agent")
st.caption("Checkout recommendations with deterministic discount guardrails and Razorpay payment links.")


def api_request(method: str, path: str, **kwargs):
    response = requests.request(method, f"{API_URL}{path}", timeout=TIMEOUT_SECONDS, **kwargs)
    response.raise_for_status()
    return response.json()


with st.sidebar:
    st.header("Active guardrail policy")
    st.info("Max discount: 15%\n\nAuto-approve final amount: INR 2,000")
    if st.button("Refresh audit logs"):
        st.rerun()

checkout_tab, audit_tab = st.tabs(["Customer checkout", "Audit logs"])

with checkout_tab:
    try:
        products = api_request("GET", "/catalog").get("catalog", [])
        if not products:
            st.warning("The merchant catalog is empty.")
            st.stop()
        product_names = [product["name"] for product in products]
        selected_name = st.selectbox("Choose product", product_names)
        selected = next(product for product in products if product["name"] == selected_name)
        st.write(f"**Price:** INR {selected['price_inr']:,.2f}  |  **Stock:** {selected['stock']}")
        quantity = st.number_input("Quantity", min_value=1, max_value=max(1, selected["stock"]), value=1)
        prompt = st.text_input("Negotiate a discount or request an upsell", value="Can I get a 10% discount?")

        if st.button("Submit to agent", type="primary"):
            result = api_request("POST", "/agent/upsell-decision", json={"user_prompt": prompt, "cart_items": [{
                "product_id": selected["product_id"], "name": selected["name"], "price_inr": selected["price_inr"], "quantity": quantity,
            }]})
            st.session_state.agent_result = result
            st.session_state.selected_product = selected

        result = st.session_state.get("agent_result")
        if result:
            decision = result["decision"]
            display = {"EXECUTED": st.success, "BLOCKED": st.error, "PENDING_APPROVAL": st.warning}.get(decision, st.info)
            display(f"{decision}: {result.get('message', '')}")
            st.metric("Final payable amount", f"INR {result['final_amount']:,.2f}")
            st.write("**AI agent context:**", result.get("ai_agent_recommendation", "Not available"))

            if decision == "EXECUTED" and st.button("Generate Razorpay checkout link"):
                product = st.session_state.selected_product
                link = api_request("POST", "/payment/create-link", json={
                    "amount_inr": result["final_amount"], "description": f"Purchase: {product['name']}",
                    "customer_name": "Test Customer", "customer_email": "customer@example.com", "customer_phone": "+919876543210",
                })
                st.session_state.payment_url = link["short_url"]
            if st.session_state.get("payment_url"):
                st.link_button("Pay now via Razorpay", st.session_state.payment_url)
    except requests.RequestException as exc:
        st.error(f"Backend API is unavailable at {API_URL}. Start Uvicorn and try again. ({exc})")

with audit_tab:
    try:
        logs = api_request("GET", "/audit-logs")
        if logs:
            st.dataframe(logs, use_container_width=True, hide_index=True)
        else:
            st.info("No audit logs recorded in this session yet.")
    except requests.RequestException as exc:
        st.error(f"Could not load audit logs: {exc}")
