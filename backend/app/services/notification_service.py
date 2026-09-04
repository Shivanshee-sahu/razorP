"""
Notification Service

Handles email notifications for key events.
Uses a provider abstraction for flexibility.
"""

import os
from datetime import datetime, timezone
from typing import Optional
from dataclasses import dataclass
from enum import Enum

from app.db import connect, retry_on_lock


class NotificationEventType(str, Enum):
    """Types of notification events."""
    APPROVAL_DECISION = "approval_decision"
    PAYMENT_FAILURE = "payment_failure"
    ORDER_CONFIRMATION = "order_confirmation"


@dataclass
class NotificationEvent:
    """Represents a notification event."""
    event_type: NotificationEventType
    recipient_email: str
    subject: str
    body: str
    metadata: dict
    created_at: str


class NotificationProvider:
    """Abstract base class for notification providers."""
    
    def send(self, event: NotificationEvent) -> bool:
        """Send a notification. Returns True if successful."""
        raise NotImplementedError


class ConsoleNotificationProvider(NotificationProvider):
    """Fallback provider that logs to console for development."""
    
    def send(self, event: NotificationEvent) -> bool:
        """Log notification to console."""
        print(f"[NOTIFICATION] {event.event_type.value}")
        print(f"  To: {event.recipient_email}")
        print(f"  Subject: {event.subject}")
        print(f"  Body: {event.body[:200]}...")
        print(f"  Created: {event.created_at}")
        return True


class EmailNotificationProvider(NotificationProvider):
    """Real email provider using SMTP."""
    
    def __init__(self):
        self.smtp_host = os.getenv("SMTP_HOST")
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.smtp_username = os.getenv("SMTP_USERNAME")
        self.smtp_password = os.getenv("SMTP_PASSWORD")
        self.from_email = os.getenv("FROM_EMAIL", "noreply@copperchar.com")
        self.enabled = bool(self.smtp_host and self.smtp_username and self.smtp_password)
    
    def send(self, event: NotificationEvent) -> bool:
        """Send email via SMTP."""
        if not self.enabled:
            print(f"[EMAIL] Email provider not configured, skipping send")
            return False
        
        try:
            import smtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart
            
            msg = MIMEMultipart()
            msg['From'] = self.from_email
            msg['To'] = event.recipient_email
            msg['Subject'] = event.subject
            
            msg.attach(MIMEText(event.body, 'html'))
            
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_username, self.smtp_password)
                server.send_message(msg)
            
            print(f"[EMAIL] Sent to {event.recipient_email}: {event.subject}")
            return True
        except Exception as e:
            print(f"[EMAIL] Failed to send: {e}")
            return False


class NotificationService:
    """Main notification service."""
    
    def __init__(self):
        # Try to use email provider if configured, otherwise fall back to console
        self.provider = EmailNotificationProvider()
        if not self.provider.enabled:
            print("[NOTIFICATION] Using console provider (email not configured)")
            self.provider = ConsoleNotificationProvider()
    
    @retry_on_lock
    def _store_event(self, event: NotificationEvent):
        """Store notification event in database."""
        with connect() as conn:
            conn.execute(
                """
                    INSERT INTO notification_events 
                    (event_type, recipient_email, subject, body, metadata, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        event.event_type.value,
                        event.recipient_email,
                        event.subject,
                        event.body,
                        str(event.metadata),
                        event.created_at
                    )
            )
    
    def send_approval_decision(
        self,
        recipient_email: str,
        approval_id: int,
        decision: str,
        product_name: str,
        discount_pct: float
    ):
        """Send notification for approval decision."""
        subject = f"Approval Decision: {decision.upper()} - {product_name}"
        
        body = f"""
        <html>
        <body>
            <h2>Growth Agent Approval Decision</h2>
            <p><strong>Product:</strong> {product_name}</p>
            <p><strong>Decision:</strong> {decision.upper()}</p>
            <p><strong>Discount:</strong> {discount_pct}%</p>
            <p><strong>Approval ID:</strong> #{approval_id}</p>
            <p><strong>Time:</strong> {datetime.now(timezone.utc).isoformat()}</p>
            <hr>
            <p>This is an automated notification from Copper & Char Growth Agent.</p>
        </body>
        </html>
        """
        
        event = NotificationEvent(
            event_type=NotificationEventType.APPROVAL_DECISION,
            recipient_email=recipient_email,
            subject=subject,
            body=body,
            metadata={
                "approval_id": approval_id,
                "decision": decision,
                "product_name": product_name,
                "discount_pct": discount_pct
            },
            created_at=datetime.now(timezone.utc).isoformat()
        )
        
        self._store_event(event)
        return self.provider.send(event)
    
    def send_payment_failure(
        self,
        recipient_email: str,
        cart_id: str,
        amount: float,
        reason: str
    ):
        """Send notification for payment failure."""
        subject = f"Payment Failed - Cart {cart_id}"
        
        body = f"""
        <html>
        <body>
            <h2>Payment Failure Notification</h2>
            <p><strong>Cart ID:</strong> {cart_id}</p>
            <p><strong>Amount:</strong> ₹{amount:,.2f}</p>
            <p><strong>Reason:</strong> {reason}</p>
            <p><strong>Time:</strong> {datetime.now(timezone.utc).isoformat()}</p>
            <hr>
            <p>Your cart has been preserved. You can retry the payment.</p>
            <p>This is an automated notification from Copper & Char.</p>
        </body>
        </html>
        """
        
        event = NotificationEvent(
            event_type=NotificationEventType.PAYMENT_FAILURE,
            recipient_email=recipient_email,
            subject=subject,
            body=body,
            metadata={
                "cart_id": cart_id,
                "amount": amount,
                "reason": reason
            },
            created_at=datetime.now(timezone.utc).isoformat()
        )
        
        self._store_event(event)
        return self.provider.send(event)
    
    def send_order_confirmation(
        self,
        recipient_email: str,
        order_id: str,
        order_number: str,
        amount: float,
        items: list
    ):
        """Send notification for order confirmation."""
        items_html = "".join([
            f"<li>{item.get('product_name', 'Product')} x {item.get('qty', 1)} - ₹{item.get('price', 0):,.2f}</li>"
            for item in items
        ])
        
        subject = f"Order Confirmed - {order_number}"
        
        body = f"""
        <html>
        <body>
            <h2>Order Confirmation</h2>
            <p><strong>Order Number:</strong> {order_number}</p>
            <p><strong>Order ID:</strong> {order_id}</p>
            <p><strong>Total Amount:</strong> ₹{amount:,.2f}</p>
            <p><strong>Time:</strong> {datetime.now(timezone.utc).isoformat()}</p>
            <h3>Items:</h3>
            <ul>{items_html}</ul>
            <hr>
            <p>Thank you for shopping with Copper & Char!</p>
            <p>This is an automated notification.</p>
        </body>
        </html>
        """
        
        event = NotificationEvent(
            event_type=NotificationEventType.ORDER_CONFIRMATION,
            recipient_email=recipient_email,
            subject=subject,
            body=body,
            metadata={
                "order_id": order_id,
                "order_number": order_number,
                "amount": amount,
                "items_count": len(items)
            },
            created_at=datetime.now(timezone.utc).isoformat()
        )
        
        self._store_event(event)
        return self.provider.send(event)


# Global instance
notification_service = NotificationService()