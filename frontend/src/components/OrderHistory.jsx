import { useState, useEffect } from 'react';
import { api } from '../api';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function OrderHistory({ cartId }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadOrders();
  }, [cartId]);

  const loadOrders = async () => {
    try {
      setLoading(true);
      const data = await api('/api/orders');
      // Filter orders for this cart
      const cartOrders = data.filter(order => order.cart_id === cartId);
      setOrders(cartOrders);
    } catch (err) {
      setError('Failed to load orders');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const downloadReceipt = async (orderId) => {
    try {
      const response = await fetch(`http://127.0.0.1:8000/api/orders/${orderId}/receipt`);
      if (!response.ok) throw new Error('Failed to generate receipt');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt_${orderId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Receipt download failed:', err);
      alert('Unable to download receipt');
    }
  };

  if (loading) {
    return (
      <div className="order-history">
        <div className="loading">Loading orders...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="order-history">
        <div className="error">{error}</div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="order-history">
        <div className="empty-state">
          <h3>No orders yet</h3>
          <p>When you place orders, they will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="order-history">
      <div className="section-header">
        <h2>Order History</h2>
        <p className="section-subtitle">View your past orders and download receipts</p>
      </div>

      <div className="orders-list">
        {orders.map((order) => (
          <div key={order.id} className="order-card">
            <div className="order-header">
              <div>
                <h3>Order #{order.order_number}</h3>
                <p className="order-date">{new Date(order.created_at).toLocaleString()}</p>
              </div>
              <div className={`order-status status-${order.status.toLowerCase()}`}>
                {order.status}
              </div>
            </div>

            <div className="order-details">
              <div className="order-amount">
                <span className="label">Total</span>
                <span className="value">{money(order.amount)}</span>
              </div>

              <div className="order-payment">
                <span className="label">Payment ID</span>
                <span className="value">{order.razorpay_payment_id || 'N/A'}</span>
              </div>

              {order.ai_assisted && (
                <div className="order-ai-badge">
                  <span>✦ AI Assisted</span>
                </div>
              )}
            </div>

            <div className="order-actions">
              <button
                onClick={() => downloadReceipt(order.id)}
                className="receipt-button"
              >
                Download Receipt
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}