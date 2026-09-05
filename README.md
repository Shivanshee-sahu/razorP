🤖 Copper & Char — AI Growth & Agentic Commerce

An explainable, bounded, and gated agentic commerce platform for merchants and AI buyers.

Copper & Char is a dual-agent commerce system built for AI Growth & Agentic Commerce.

The platform combines:

📈 A Merchant Growth Agent that identifies upsell and cross-sell opportunities.
🤖 An Autonomous AI Buyer that discovers products and makes purchasing decisions within a predefined buyer mandate.
🛡️ Server-side guardrails that ensure AI agents cannot bypass financial policies.
✅ Human approval workflows for gated actions.
📜 A complete audit trail for explainability.
💳 Razorpay Test Mode integration for checkout and payment verification.

The core idea is simple:

AI can drive commerce, but it should never bypass financial governance.

🎯 Problem Statement

AI agents are increasingly capable of making recommendations and taking actions on behalf of users and businesses.

However, agentic commerce introduces critical challenges:

Can an AI modify a customer's cart without approval?
Can an AI apply arbitrary discounts?
Can an AI buyer exceed a user's spending limits?
What happens when an AI service fails?
How can merchants understand why an AI made a financial decision?
How can duplicate payment processing be prevented?

Most AI commerce demos focus only on intelligence.

Copper & Char focuses on intelligence + governance.

Every money-related action in the system is designed to be:

Explainable → Bounded → Validated → Gated → Audited

✨ Features
📈 Merchant Growth Agent

The Growth Agent analyzes shopping carts and identifies opportunities for:

Upselling
Cross-selling
Complementary product recommendations
Discount suggestions

The agent generates structured proposals containing:

Recommended products
Product reasoning
Proposed discounts
Revenue impact
Cart impact
Policy validation results
Guardrails

The Growth Agent is constrained by server-side policies such as:

Maximum AI add-ons
Maximum discount percentage
Maximum cart increase
Auto-approval threshold

The AI cannot directly bypass these limits.

🤖 Autonomous AI Buyer

The AI Buyer accepts natural-language purchase requests such as:

Buy me a useful kitchen accessory under ₹2,000

or:

I need a frying pan for daily cooking

The system performs:

Natural-language intent extraction
Product discovery
Catalog filtering
Product compatibility scoring
Budget validation
Buyer mandate validation
Purchase authorization checks

The recommendation engine can operate deterministically and does not completely depend on an LLM being available.

🛡️ Buyer Mandate System

The AI Buyer operates within a strict buyer authority.

Example:

Maximum Order: ₹2,000
Maximum Item Price: ₹1,500
Daily Spending Limit: ₹5,000

Allowed Categories:
- Cookware
- Kitchen
- Kitchen Tools
- Utensils

Auto-Pay: Enabled

Before a purchase can proceed, the backend validates:

✅ Maximum order amount
✅ Maximum item price
✅ Allowed product categories
✅ Daily spending limits
✅ Auto-pay authorization
✅ Product availability

The frontend does not have authority to bypass these restrictions.

🔐 Explainable & Bounded AI

Copper & Char follows the principle:

AI proposes
        ↓
Backend validates
        ↓
Policy decides
        ↓
Human approval when required
        ↓
Action executes
        ↓
Everything is audited

AI-generated values are never blindly trusted.

All important validation happens on the backend.

✅ Approval System

Certain AI-generated actions require merchant approval before execution.

The approval workflow provides:

Pending approval queue
Proposal details
Policy validation
Approval decision
Rejection handling
Revalidation before execution

This prevents an AI agent from directly modifying sensitive financial actions without proper authorization.

📜 Complete Audit Trail

Every important action is logged for explainability.

The audit system records events such as:

AI agent execution
Recommendations generated
Policy decisions
Mandate validation
Approval decisions
Cart modifications
Payment attempts
Payment failures
Successful orders

This allows users and merchants to understand:

What happened, why it happened, and whether the action was authorized.

💳 Razorpay Test Mode Integration

The project integrates with Razorpay Test Mode for checkout.

Features include:

Payment order creation
Razorpay checkout integration
Cryptographic payment verification
Duplicate payment protection
Idempotency checks
Cart preservation on failure
Order recording
PDF receipt generation

⚠️ This project uses Razorpay Test Mode and is intended for demonstration purposes.

⚠️ Failure Handling

Agentic systems must handle failures gracefully.

Copper & Char includes multiple failure-handling mechanisms.

🤖 AI Service Failure

If the AI service returns invalid or malformed output:

AI Service
     ↓
Fallback Recommendation Engine
     ↓
Deterministic Product Matching

The system can continue functioning using deterministic logic.

💳 Payment Failure

If payment fails:

Cart state is preserved
No successful order is incorrectly recorded
The user can retry the payment
Payment events are logged
🛡️ Mandate Violation

If an AI Buyer attempts an unauthorized purchase:

MANDATE_REJECTED

The system explains exactly why the action was blocked.

For example:

Daily spending limit exceeded.
Already spent: ₹6,995
Requested order: ₹1,698
Daily limit: ₹5,000

No payment is initiated.

🧠 Architecture
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
       │              │    │     LLM      │    │  Test Mode   │
       └──────────────┘    └──────────────┘    └──────────────┘
🛠️ Tech Stack
Frontend
React
Vite
JavaScript
CSS
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
Other Technologies
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

Activate it:

.\.venv\Scripts\Activate.ps1

Install dependencies:

pip install -r requirements.txt
🔐 Environment Variables

Create a .env file inside the backend directory.

Example:

RAZORPAY_KEY_ID=rzp_test_xxxxxxxxx
RAZORPAY_KEY_SECRET=your_secret

GROQ_API_KEY=gsk_xxxxxxxxx

⚠️ Never commit your .env file to GitHub.

▶️ Run Backend

Run:

..\ .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

Or:

uvicorn app.main:app --reload --port 8000

The backend will start at:

http://127.0.0.1:8000

API documentation is available at:

http://127.0.0.1:8000/docs
🎨 Frontend Setup

Open another terminal.

Navigate to:

cd frontend

Install dependencies:

npm install

Start the development server:

npm run dev

The frontend will typically run at:

http://localhost:5173
🔄 Application Flow
1️⃣ Merchant Growth Flow
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
2️⃣ AI Buyer Flow
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

The platform uses server-side guardrails to restrict agent actions.

Example policy configuration:

{
  "auto_approval_threshold": 2000,
  "max_discount_pct": 15,
  "max_ai_addons": 3,
  "max_cart_increase_pct": 30
}

These values are enforced independently of the AI model.

Even if an AI proposes:

Discount: 50%

the backend can reject or clamp the proposal according to policy.

🧪 Example AI Buyer Request
User Input
Buy me a useful kitchen accessory under ₹2,000
AI Buyer Process
✓ Loading buyer mandate

✓ Filtering catalog against mandate

✓ Understanding requirements

✓ Product identification

✓ Constructing authorized bundle

✓ Budget validation

✓ Buyer mandate validation

✓ Policy validation

The user receives:

Recommended products
Product reasoning
Pricing
Decision trace
Mandate validation result
❌ Example Failure Scenario

Suppose the AI attempts a purchase that exceeds the daily limit.

Daily Limit: ₹5,000

Already Spent: ₹4,500

New Purchase: ₹1,000

Result:

MANDATE_REJECTED

Daily spending limit exceeded.

The system:

❌ Blocks the purchase
❌ Does not initiate payment
📜 Records the decision
🧠 Explains the reason
🏆 Key Innovation

The key innovation of Copper & Char is not simply using an LLM.

It is the combination of:

🤖 AI Intelligence

Agents can:

Understand requests
Analyze carts
Recommend products
Identify revenue opportunities
🛡️ Deterministic Governance

The backend independently validates:

Spending limits
Product prices
Categories
Discounts
Cart limits
Approval requirements
📜 Explainability

Every decision can be traced.

⚡ Reliability

The system includes deterministic fallback logic when AI services are unavailable.

🎯 Hackathon Track Alignment
Track: AI Growth & Agentic Commerce

Copper & Char addresses both sides of agentic commerce.

📈 Grow the Merchant

The Growth Agent helps merchants increase revenue through:

Upselling
Cross-selling
Intelligent recommendations
Cart-aware product suggestions
🤖 Make Merchants Transactable by AI Buyers

The AI Buyer enables:

Natural-language product discovery
Agent-readable purchasing decisions
Buyer mandates
Spending boundaries
Category restrictions
Explainable authorization
🧩 Design Principles

Copper & Char is built around five principles:

1. Explainable

Every important decision has reasoning and a trace.

2. Bounded

AI actions operate within predefined limits.

3. Validated

The backend independently validates all financial actions.

4. Gated

Sensitive actions can require human approval.

5. Audited

Important actions are recorded for transparency.

🔮 Future Improvements

Potential future enhancements include:

👤 Fully user-configurable buyer mandates
🗣️ More advanced conversational checkout
🏦 Persistent PostgreSQL deployment
📧 Production notification providers
🔄 Multi-agent negotiation
📊 Advanced merchant analytics
🌐 Agent-to-agent commerce protocol integration
🔐 Stronger production authentication
📱 Mobile experience
🤝 Support for emerging agent commerce protocols
⚠️ Current Limitations

This project is currently a demonstration/prototype.

Razorpay runs in Test Mode
Buyer mandates are system-defined for the demo
Full autonomous payment without checkout interaction is not claimed
SQLite is suitable for the prototype/demo environment
Console notification fallback may be used when email is not configured
👩‍💻 Author

Shivanshee Sahu

Built for:

🚀 AI Growth & Agentic Commerce
🏁 Final Statement

Copper & Char demonstrates that the future of AI commerce should not be an unrestricted AI with access to money.

Instead:

AI can reason.

Policies define boundaries.

Humans control sensitive actions.

Systems validate every transaction.

And every decision remains explainable.
🤖🛡️ Copper & Char
Intelligent Commerce. Governed Actions. Explainable Decisions.