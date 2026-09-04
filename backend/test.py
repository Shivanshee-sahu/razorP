from app.db import connect

with connect() as conn:
    conn.execute(
        """
        INSERT INTO carts (id, created_at, discount_pct, recovery_status)
        VALUES (?, datetime('now'), ?, ?)
        """,
        ("autonomous-test-cart", 0, "none")
    )

print("Created autonomous-test-cart")