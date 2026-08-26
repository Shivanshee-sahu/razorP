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
    image_url TEXT
);
CREATE TABLE IF NOT EXISTS carts (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, discount_pct REAL NOT NULL DEFAULT 0, recovery_status TEXT);
CREATE TABLE IF NOT EXISTS cart_items (id INTEGER PRIMARY KEY AUTOINCREMENT, cart_id TEXT NOT NULL REFERENCES carts(id), product_id TEXT NOT NULL REFERENCES catalog(id), qty INTEGER NOT NULL DEFAULT 1, UNIQUE(cart_id, product_id));
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, cart_id TEXT, stage TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, amount INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approval_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, cart_id TEXT NOT NULL, payload TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);

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