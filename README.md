# 🤖 Copper & Char — AI Growth & Agentic Commerce

> **Intelligent Commerce. Governed Actions. Explainable Decisions.**

Copper & Char is an **AI-powered agentic commerce platform** built for the **AI Growth & Agentic Commerce** track.

The platform combines two AI-driven systems:

- 📈 **Merchant Growth Agent** — helps merchants increase revenue through intelligent upselling and cross-selling.
- 🤖 **AI Buyer** — helps buyers discover and purchase products through natural-language requests within strict spending and purchasing boundaries.

The core principle behind Copper & Char is:

> **AI can make intelligent decisions, but it should never bypass financial governance.**

Every money-related action is designed to be:

**Explainable → Bounded → Validated → Gated → Audited**

---

## 🎯 Problem Statement

AI agents are becoming capable of making recommendations and taking actions on behalf of users and businesses.

However, agentic commerce introduces important challenges:

- Can an AI modify a customer's cart without approval?
- Can an AI apply arbitrary discounts?
- Can an AI buyer exceed spending limits?
- How do we prevent unsafe AI-generated financial actions?
- What happens if the AI service fails?
- How can users understand why an AI made a decision?

Most AI commerce systems focus primarily on intelligence.

**Copper & Char focuses on both intelligence and governance.**

The system ensures that AI agents can participate in commerce while remaining constrained by server-side policies, approval workflows, buyer mandates, and complete audit trails.

---

# ✨ Key Features

## 📈 Merchant Growth Agent

The Merchant Growth Agent analyzes cart contents and identifies opportunities for:

- Upselling
- Cross-selling
- Complementary product recommendations
- Intelligent add-on suggestions
- Discount recommendations

The agent generates structured proposals containing:

- Recommended products
- Reasons for recommendations
- Proposed discounts
- Cart impact
- Revenue opportunities
- Policy validation information

### 🛡️ Growth Agent Guardrails

The Growth Agent operates within predefined server-side policies:

- Maximum AI add-ons
- Maximum discount percentage
- Maximum cart increase
- Auto-approval threshold

AI-generated values are never blindly trusted.

All financial actions are independently validated by the backend.

---

# 🤖 Autonomous AI Buyer

The AI Buyer allows users to enter natural-language purchase requests.


Buy me a useful kitchen accessory under ₹2,000

or:

I need a frying pan for daily cooking

The AI Buyer performs:

Natural-language intent extraction
Product discovery
Catalog filtering
Product compatibility scoring
Budget validation
Buyer mandate validation
Policy validation

The system provides:

Product recommendations
Recommendation reasoning
Budget impact
Decision traces
Mandate validation results
🛡️ Buyer Mandate System

The AI Buyer operates within a predefined buyer authority.

Example mandate:

Maximum Order: ₹2,000
Maximum Item Price: ₹1,500
Daily Spending Limit: ₹5,000

Allowed Categories:
- Cookware
- Kitchen
- Kitchen Tools
- Utensils

Auto-Pay: Enabled

Before allowing a purchase to proceed, the backend validates:

✅ Maximum order amount
✅ Maximum item price
✅ Allowed categories
✅ Daily spending limits
✅ Auto-pay authorization
✅ Product availability

The frontend cannot bypass these restrictions.

🔐 Explainable & Bounded AI

Copper & Char follows a strict decision pipeline:

AI proposes
      ↓
Backend validates
      ↓
Policy checks boundaries
      ↓
Human approval when required
      ↓
Action executes
      ↓
Everything is audited

The AI model does not have direct authority over money-related actions.

All critical decisions are validated on the server.

✅ Approval System

Sensitive AI-generated actions can require merchant approval before execution.

The approval workflow provides:

Pending approval queue
Proposal details
Policy validation
Merchant approval
Merchant rejection
Revalidation before execution

This prevents AI agents from directly executing sensitive financial actions without authorization.

📜 Complete Audit Trail

Copper & Char records important agent actions for transparency and explainability.

The audit system logs:

AI agent execution
Recommendations generated
Policy decisions
Buyer mandate validation
Approval decisions
Cart modifications
Payment attempts
Payment failures
Successful orders

This allows users and merchants to understand:

What happened, why it happened, and whether the action was authorized.

💳 Razorpay Test Mode Integration

The project integrates with Razorpay Test Mode for payment processing.

Features include:

Payment order creation
Razorpay checkout
Cryptographic signature verification
Duplicate payment protection
Idempotency checks
Cart preservation on failure
Order recording
PDF receipt generation

⚠️ This project uses Razorpay Test Mode and is intended for demonstration purposes.

⚠️ Failure Handling

Agentic systems must handle failures safely.

Copper & Char includes multiple failure-handling mechanisms.

🤖 AI Service Failure

If the AI service returns malformed or invalid output:

AI Service Failure
        ↓
Deterministic Fallback Engine
        ↓
Rule-Based Product Matching
        ↓
Continue Safely

The system can continue functioning using deterministic recommendation logic.

💳 Payment Failure

If a payment fails:

Cart state is preserved
No incorrect order is created
The user can retry payment
The failure is logged
🛡️ Mandate Violation

If the AI Buyer attempts an unauthorized purchase:

MANDATE_REJECTED

The system explains why the action was blocked.

Example:

Daily spending limit exceeded.

Already spent: ₹6,995
Requested purchase: ₹1,698
Daily limit: ₹5,000

In this case:

❌ Payment is not initiated
❌ Unauthorized purchase is blocked
📜 The decision is logged
🧠 The reason is explained
🏗️ Architecture
                         ┌─────────────────────┐
                         │      Frontend       │
                         │   React + Vite      │
                         └──────────┬──────────┘
                                    │
                                    │ REST API
                                    ▼
                    ┌──────────────────────────────┐
                    │       FastAPI Backend        │
                    │                              │
                    │  ┌────────────────────────┐  │
                    │  │    Growth Agent        │  │
                    │  └────────────────────────┘  │
                    │                              │
                    │  ┌────────────────────────┐  │
                    │  │      AI Buyer          │  │
                    │  └────────────────────────┘  │
                    │                              │
                    │  ┌────────────────────────┐  │
                    │  │ Policy & Guardrails    │  │
                    │  └────────────────────────┘  │
                    └──────────────┬───────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
       ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
       │   Database   │    │     Groq     │    │   Razorpay   │
       │   SQLite     │    │     LLM      │    │  Test Mode   │
       └──────────────┘    └──────────────┘    └──────────────┘
🛠️ Tech Stack
Frontend
React
Vite
JavaScript
REST APIs
Backend
Python
FastAPI
Uvicorn
AI
Groq API
LLM-powered recommendations
Deterministic fallback engine
Payments
Razorpay Test Mode
Database
SQLite
Other Tools
ReportLab for PDF receipts
Environment variables using .env
Server-side policy validation
📂 Project Structure
razorpay-agentic-upsell/
│
├── backend/
│   │
│   ├── app/
│   │   ├── main.py
│   │   ├── services/
│   │   ├── models/
│   │   └── ...
│   │
│   ├── requirements.txt
│   ├── .env
│   └── ...
│
├── frontend/
│   │
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── api/
│   │   └── ...
│   │
│   ├── package.json
│   └── vite.config.js
│
└── README.md
🚀 Getting Started
Prerequisites

Make sure you have installed:

Python 3.10+
Node.js 18+
npm
Git
⚙️ Backend Setup

Navigate to the backend directory:

cd backend

Create a virtual environment:

Windows
python -m venv .venv

Activate the environment:

.\.venv\Scripts\Activate.ps1

Install dependencies:

pip install -r requirements.txt
🔐 Environment Variables

Create a .env file inside the backend directory.

Example:

RAZORPAY_KEY_ID=rzp_test_xxxxxxxxx
RAZORPAY_KEY_SECRET=your_secret

GROQ_API_KEY=gsk_xxxxxxxxx

⚠️ Never commit your .env file or API keys to GitHub.

Add this to .gitignore:

.env
.venv/
__pycache__/
node_modules/
▶️ Run the Backend

From the backend directory:

..\ .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

Or, if your virtual environment is activated:

uvicorn app.main:app --reload --port 8000

The backend will run at:

http://127.0.0.1:8000

FastAPI documentation:

http://127.0.0.1:8000/docs
🎨 Frontend Setup

Open another terminal and navigate to:

cd frontend

Install dependencies:

npm install

Start the development server:

npm run dev

The frontend will typically run at:

http://localhost:5173
🔄 Application Flow
📈 Merchant Growth Flow
Customer Cart
      ↓
Growth Agent Analyzes Cart
      ↓
AI Generates Recommendations
      ↓
Server-Side Policy Validation
      ↓
Approval Required?
      ↓
YES ──────────────→ Approval Queue
                        ↓
                  Merchant Decision
                        ↓
                    Execute Action
🤖 AI Buyer Flow
Natural Language Request
        ↓
Intent Extraction
        ↓
Catalog Discovery
        ↓
Mandate Filtering
        ↓
Product Scoring
        ↓
Bundle Construction
        ↓
Final Mandate Validation
        ↓
Authorized?
     ↙          ↘
   YES           NO
    ↓             ↓
Checkout      MANDATE_REJECTED
🛡️ Policy Guardrails

The platform uses server-side guardrails to restrict AI actions.

Example:

{
  "auto_approval_threshold": 2000,
  "max_discount_pct": 15,
  "max_ai_addons": 3,
  "max_cart_increase_pct": 30
}

These policies are enforced independently of the AI model.

For example, if the AI proposes:

Discount: 50%

The backend can reject or clamp the value according to the configured policy.

🧪 Example AI Buyer Request
User Request
Buy me a useful kitchen accessory under ₹2,000
AI Execution Trace
✓ Loading buyer mandate

✓ Filtering catalog against mandate

✓ Understanding requirements

✓ Product identification

✓ Constructing authorized bundle

✓ Budget validation

✓ Buyer mandate validation

✓ Policy validation

The system returns:

Product recommendations
Prices
Reasons for recommendations
Budget impact
Decision traces
Authorization status
🏆 Hackathon Track Alignment
Track: AI Growth & Agentic Commerce

Copper & Char addresses both sides of agentic commerce.

📈 Grow the Merchant

The Merchant Growth Agent helps increase revenue through:

Upselling
Cross-selling
Intelligent recommendations
Cart-aware product suggestions
🤖 Make Merchants Transactable by AI Buyers

The AI Buyer enables:

Natural-language product discovery
Agent-driven purchasing decisions
Buyer mandates
Spending boundaries
Category restrictions
Explainable authorization
🧠 Key Innovation

The key innovation of Copper & Char is not simply using an LLM.

It combines:

🤖 AI Intelligence

Agents can:

Understand requests
Analyze shopping carts
Recommend products
Identify revenue opportunities
🛡️ Deterministic Governance

The backend independently validates:

Spending limits
Product prices
Product categories
Discounts
Cart limits
Approval requirements
📜 Explainability

Every important decision can be traced and explained.

⚡ Reliability

The system includes deterministic fallback logic when the AI service is unavailable.

🎯 Design Principles

Copper & Char is built around five principles:

1. Explainable

Every important decision includes reasoning and execution traces.

2. Bounded

AI actions operate within predefined limits.

3. Validated

The backend independently validates financial actions.

4. Gated

Sensitive actions require approval when necessary.

5. Audited

Important actions are recorded for transparency.

⚠️ Current Limitations

This project is currently a prototype and demonstration.

Razorpay operates in Test Mode
Buyer mandates are system-defined for the demo
Fully autonomous payment without checkout interaction is not claimed
SQLite is used for the prototype environment
Production email notifications are not implemented
🔮 Future Improvements

Potential future improvements include:

User-configurable buyer mandates
Advanced conversational checkout
PostgreSQL production database
Production notification services
Multi-agent negotiation
Advanced merchant analytics
Agent-to-agent commerce protocols
Production authentication
Mobile application support
👩‍💻 Author

Shivanshee Sahu

Built for the AI Growth & Agentic Commerce track.

🏁 Final Statement

The future of AI commerce should not be an unrestricted AI with access to money.

Instead:

AI can reason.

Policies define boundaries.

Humans control sensitive actions.

Systems validate transactions.

Every decision remains explainable.
🤖🛡️ Copper & Char
Intelligent Commerce. Governed Actions. Explainable Decisions.
