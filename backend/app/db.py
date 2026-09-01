"""Small SQLite data layer for the demo; no ORM required."""
import json
import os
import sqlite3
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / "backend" / ".env")
DB_PATH = Path(os.getenv("DATABASE_PATH", ROOT / "backend" / "copper_char.db"))
if not DB_PATH.is_absolute():
    DB_PATH = ROOT / "backend" / DB_PATH

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS catalog (
    id TEXT PRIMARY KEY, 
    name TEXT NOT NULL, 
    category TEXT, 
    price INTEGER NOT NULL, 
    stock INTEGER NOT NULL, 
    description TEXT,
    image_url TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    ai_buyer_enabled INTEGER NOT NULL DEFAULT 1,
    growth_agent_enabled INTEGER NOT NULL DEFAULT 1,
    max_ai_discount_pct REAL NOT NULL DEFAULT 10,
    max_recommended_qty INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS carts (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, discount_pct REAL NOT NULL DEFAULT 0, recovery_status TEXT);
CREATE TABLE IF NOT EXISTS cart_items (id INTEGER PRIMARY KEY AUTOINCREMENT, cart_id TEXT NOT NULL REFERENCES carts(id), product_id TEXT NOT NULL REFERENCES catalog(id), qty INTEGER NOT NULL DEFAULT 1, unit_price INTEGER, UNIQUE(cart_id, product_id));
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, cart_id TEXT, stage TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, amount INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approval_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, cart_id TEXT NOT NULL, payload TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS buyer_addon_selections (id INTEGER PRIMARY KEY AUTOINCREMENT, cart_id TEXT NOT NULL, product_id TEXT NOT NULL, qty INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT);
CREATE TABLE IF NOT EXISTS growth_recommendations (id INTEGER PRIMARY KEY AUTOINCREMENT, cart_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS growth_approval_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cart_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    buyer_requested_discount_pct REAL NOT NULL DEFAULT 0,
    merchant_approved_discount_pct REAL,
    original_price INTEGER NOT NULL,
    final_price REAL,
    qty INTEGER NOT NULL DEFAULT 1,
    reasoning TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    requested_at TEXT NOT NULL,
    reviewed_at TEXT,
    reviewed_by TEXT,
    rejection_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_growth_approval_cart_status ON growth_approval_requests(cart_id, status);

CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    cart_id TEXT NOT NULL,
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    amount INTEGER NOT NULL,
    currency TEXT DEFAULT 'INR',
    status TEXT NOT NULL,
    ai_assisted INTEGER DEFAULT 0,
    human_approved INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id),
    product_id TEXT NOT NULL REFERENCES catalog(id),
    product_name TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    price INTEGER NOT NULL
);
"""

def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def seed() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(cart_items)").fetchall()}
        if "unit_price" not in columns:
            conn.execute("ALTER TABLE cart_items ADD COLUMN unit_price INTEGER")
        catalog_columns = {row["name"] for row in conn.execute("PRAGMA table_info(catalog)").fetchall()}
        migrations = {
            "active": "ALTER TABLE catalog ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
            "ai_buyer_enabled": "ALTER TABLE catalog ADD COLUMN ai_buyer_enabled INTEGER NOT NULL DEFAULT 1",
            "growth_agent_enabled": "ALTER TABLE catalog ADD COLUMN growth_agent_enabled INTEGER NOT NULL DEFAULT 1",
            "max_ai_discount_pct": "ALTER TABLE catalog ADD COLUMN max_ai_discount_pct REAL NOT NULL DEFAULT 10",
            "max_recommended_qty": "ALTER TABLE catalog ADD COLUMN max_recommended_qty INTEGER NOT NULL DEFAULT 1",
        }
        for column, statement in migrations.items():
            if column not in catalog_columns:
                conn.execute(statement)
        catalog_path = ROOT / "catalog.json"
        if catalog_path.exists():
            data = json.loads(catalog_path.read_text(encoding="utf-8"))
            conn.executemany(
                """
                INSERT INTO catalog (id, name, category, price, stock, description, image_url)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    category = excluded.category,
                    price = excluded.price,
                    stock = excluded.stock,
                    description = excluded.description,
                    image_url = excluded.image_url
                """,
                [(p["product_id"], p["name"], p.get("category"), p["price_inr"], p["stock"], p.get("description", ""), p.get("image_url", "")) for p in data["catalog"]],
            )

def rows(rows_: list[sqlite3.Row]) -> list[dict]:
    return [dict(row) for row in rows_]