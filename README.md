# Copper & Char Growth Agent

A hackathon demo of an AI checkout growth agent for a fictional cookware merchant. It uses a React/Vite frontend, FastAPI, SQLite, xAI Grok (server-side only) and Razorpay Test Mode.

## Run locally

1. Copy `backend/.env.example` to `backend/.env` and add **test-mode** Razorpay credentials. `XAI_API_KEY` is optional: without it, the backend uses an auditable, cart-aware fallback.
2. Create the database and seed the catalog:

   ```powershell
   cd backend
   ..\.venv\Scripts\python.exe -m app.seed
   ```

3. Start the API:

   ```powershell
   ..\.venv\Scripts\uvicorn.exe app.main:app --reload
   ```

4. In another terminal, start the frontend:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

Open `http://localhost:5173`. The API docs are at `http://127.0.0.1:8000/docs`.

## Demo beats

- Add the Dutch Oven and run the agent: its fallback deliberately proposes 20% on carts above INR 5,000, so the 15% guardrail is visibly clamped and logged as blocked.
- The recommended add-ons exceed the INR 2,000 configured auto-approval cap and enter the human approval queue.
- Approve the action, then use Checkout to create a real Razorpay test order.
- For failure handling, use the shown Razorpay test decline card (`4100 2800 0006 0003`) or the local simulation. The cart remains intact, a retry is enabled, and both failure and recovery appear in the live audit feed.

The limits live only in `backend/app/guardrails.json`; the validator reads that file on startup. `catalog.json` is the sole catalog seed source.
