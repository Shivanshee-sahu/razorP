import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function AIBuyerPage({ cartId, onRefreshCart }) {
  const [requestText, setRequestText] = useState('I need cookware for 4 people under ₹8,000.');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [cartCreated, setCartCreated] = useState(false);
  const navigate = useNavigate();

  const handleAskMerchant = async () => {
    setLoading(true);
    setCartCreated(false);
    try {
      const res = await fetch('/api/agent/buyer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: requestText })
      });
      const data = await res.json();
      setResult(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCart = async () => {
    if (!result) return;
    const items = result.recommendations.map(r => ({ product_id: r.product_id, quantity: 1 }));
    const res = await fetch('/api/agent/buyer/add-to-cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cart_id: cartId, items })
    });
    if (res.ok) {
      setCartCreated(true);
      if (onRefreshCart) onRefreshCart();
    }
  };

  return (
    <div className="page-container">
      <header className="page-header">
        <h1>AI BUYER</h1>
        <p>Agent-to-agent autonomous commerce</p>
      </header>

      <div className="card prompt-card">
        <h3>Tell the merchant what you need</h3>
        <div className="prompt-input-group">
          <input 
            type="text" 
            value={requestText} 
            onChange={(e) => setRequestText(e.target.value)}
            placeholder="e.g. Cookware for 4 people under ₹8,000"
          />
          <button className="btn-primary" onClick={handleAskMerchant} disabled={loading}>
            {loading ? 'Analyzing...' : 'Ask Merchant Agent →'}
          </button>
        </div>
      </div>

      {result && (
        <div className="buyer-result-container">
          <div className="card trace-card">
            <h4>DECISION TRACE</h4>
            <div className="trace-list">
              {result.decision_trace.map((t, idx) => (
                <div key={idx} className="trace-item">
                  <span className="check success">✓</span>
                  <div><strong>{t.step}:</strong> {t.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card recommendations-card">
            <h3>RECOMMENDED FOR YOU</h3>
            <div className="recommendations-grid">
              {result.recommendations.map((item, idx) => (
                <div key={idx} className="rec-item card">
                  <strong>{item.name}</strong>
                  <div className="price">₹{item.price.toLocaleString('en-IN')}</div>
                  <small>✓ In stock • {item.reason}</small>
                </div>
              ))}
            </div>

            <div className="budget-summary-banner">
              <div>Estimated Total: <strong>₹{result.subtotal.toLocaleString('en-IN')}</strong></div>
              <div>Budget: ₹{result.budget.toLocaleString('en-IN')} | Remaining: ₹{result.remaining.toLocaleString('en-IN')}</div>
              <span className="badge success">✓ Within budget • Stock verified</span>
            </div>

            {!cartCreated ? (
              <button className="btn-success" onClick={handleAddToCart}>[ Add Recommended Cart ]</button>
            ) : (
              <div className="success-banner card">
                <h4>✓ CART CREATED</h4>
                <p>Your AI buyer request has been converted into a merchant cart.</p>
                <div className="action-buttons">
                  <button className="btn-secondary" onClick={() => navigate('/cart')}>View Cart →</button>
                  <button className="btn-primary" onClick={() => navigate('/growth')}>Run Growth Agent →</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}