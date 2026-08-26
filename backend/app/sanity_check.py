import os
import httpx
import razorpay
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))

def verify_setup():
    print("=== Day 1 Sanity Check ===")
    
    # 1. Test Razorpay Credentials
    rzp_key = os.getenv("RAZORPAY_KEY_ID")
    rzp_secret = os.getenv("RAZORPAY_KEY_SECRET")
    
    if not rzp_key or not rzp_secret:
        print("❌ Error: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET missing in .env")
        return False
        
    try:
        rzp_client = razorpay.Client(auth=(rzp_key, rzp_secret))
        rzp_client.order.all({"count": 1})
        print(f"✅ Razorpay Auth Success! Key ID: {rzp_key[:8]}...")
    except Exception as e:
        print(f"❌ Razorpay Auth Failed: {e}")
        return False

    # 2. Test Groq API Credentials (gsk_...)
    groq_key = os.getenv("GROQ_API_KEY") or os.getenv("XAI_API_KEY")
    if not groq_key:
        print("❌ Error: API key missing in .env")
        return False
        
    try:
        headers = {
            "Authorization": f"Bearer {groq_key}",
            "Content-Type": "application/json"
        }
        payload = {
"model": "openai/gpt-oss-20b",
         "messages": [{"role": "user", "content": "Respond with 'Groq API online'"}]
      }
        res = httpx.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload, timeout=10)
        
        if res.status_code == 200:
            content = res.json()["choices"][0]["message"]["content"]
            print(f"✅ Groq API Success! Response: '{content}'")
        else:
            print(f"❌ Groq API Returned Status {res.status_code}: {res.text}")
            return False
            
    except Exception as e:
        print(f"❌ Groq API Failed: {e}")
        return False

    print("🎉 Day 1 Complete: All credentials verified!")
    return True

if __name__ == "__main__":
    verify_setup()
