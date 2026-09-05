import { useState, useEffect } from 'react';
import { api } from '../api';

const money = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN')}`;

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
      setError('');

      const data = await api('/api/orders');

      const cartOrders = data.filter(
        (order) => order.cart_id === cartId
      );

      setOrders(cartOrders);
    } catch (err) {
      console.error(err);
      setError('Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  const downloadReceipt = async (orderId) => {
    try {
      const response = await fetch(
        `http://127.0.0.1:8000/api/orders/${orderId}/receipt`
      );

      if (!response.ok) {
        throw new Error('Failed to generate receipt');
      }

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

  // -----------------------------
  // LOADING
  // -----------------------------
  if (loading) {
    return (
      <div className="order-history">
        <div className="section-header">
          <h2>Order History</h2>
          <p>View your past orders and download receipts</p>
        </div>

        <div className="order-loading">
          <div className="loading-spinner"></div>
          <span>Loading your orders...</span>
        </div>
      </div>
    );
  }

  // -----------------------------
  // ERROR
  // -----------------------------
  if (error) {
    return (
      <div className="order-history">
        <div className="section-header">
          <h2>Order History</h2>
          <p>View your past orders and download receipts</p>
        </div>

        <div className="order-error">
          <div className="error-icon">!</div>

          <div>
            <h3>Unable to load orders</h3>
            <p>{error}</p>
          </div>

          <button
            className="retry-button"
            onClick={loadOrders}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // -----------------------------
  // EMPTY
  // -----------------------------
  if (orders.length === 0) {
    return (
      <div className="order-history">
        <div className="section-header">
          <h2>Order History</h2>
          <p>View your past orders and download receipts</p>
        </div>

        <div className="empty-orders">
          <div className="empty-icon">
            <svg
              width="42"
              height="42"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M6 2h12v20H6z" />
              <path d="M9 6h6M9 10h6M9 14h4" />
            </svg>
          </div>

          <h3>No orders yet</h3>

          <p>
            Your completed orders will appear here once
            you make a purchase.
          </p>
        </div>
      </div>
    );
  }

  // -----------------------------
  // ORDERS
  // -----------------------------
  return (
    <div className="order-history">

      <div className="section-header">
        <div>
          <h2>Order History</h2>
          <p>
            View your past orders and download receipts
          </p>
        </div>

        <div className="order-count">
          {orders.length} {orders.length === 1 ? 'Order' : 'Orders'}
        </div>
      </div>

      <div className="orders-list">

        {orders.map((order) => {

          const status = String(order.status || 'Unknown')
            .toLowerCase();

          return (
            <div
              key={order.id}
              className="order-card"
            >

              {/* TOP */}
              <div className="order-card-top">

                <div className="order-info">

                  <div className="order-icon">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M6 2h12v20H6z" />
                      <path d="M9 6h6M9 10h6M9 14h4" />
                    </svg>
                  </div>

                  <div>
                    <h3>
                      Order #{order.order_number}
                    </h3>

                    <p>
                      {new Date(
                        order.created_at
                      ).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>

                </div>

                <span
                  className={`order-status status-${status}`}
                >
                  <span className="status-dot"></span>
                  {order.status}
                </span>

              </div>

              {/* DIVIDER */}
              <div className="order-divider"></div>

              {/* DETAILS */}
              <div className="order-details">

                <div className="detail-item amount-detail">
                  <span className="detail-label">
                    Total Amount
                  </span>

                  <span className="detail-value amount">
                    {money(order.amount)}
                  </span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">
                    Payment ID
                  </span>

                  <span
                    className="detail-value payment-id"
                    title={order.razorpay_payment_id || 'N/A'}
                  >
                    {order.razorpay_payment_id || 'N/A'}
                  </span>
                </div>

                {order.ai_assisted && (
                  <div className="ai-badge">
                    <span>✦</span>
                    AI Assisted
                  </div>
                )}

              </div>

              {/* FOOTER */}
              <div className="order-footer">

                <span className="secure-text">
                  🔒 Secure payment
                </span>

                <button
                  onClick={() =>
                    downloadReceipt(order.id)
                  }
                  className="receipt-button"
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 3v12" />
                    <path d="m7 10 5 5 5-5" />
                    <path d="M5 21h14" />
                  </svg>

                  Download Receipt
                </button>

              </div>

            </div>
          );
        })}

      </div>
    </div>
  );
}