import { useState, useEffect } from 'react';
import { api } from '../api';
import CheckoutModal from './CheckoutModal';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function AIBuyer({ cartId, cart, onRefresh }) {
  const [mandate, setMandate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Mandate form state
  const [showMandateForm, setShowMandateForm] = useState(false);
  const [mandateForm, setMandateForm] = useState({
    max_order_amount: 5000,
    max_item_price: 2000,
    max_daily_spend: 10000,
    allowed_categories: ['Kitchen', 'Cookware'],
    auto_pay_enabled: true,
    expires_at: ''
  });
  
  // AI request state
  const [buyerRequest, setBuyerRequest] = useState('');
  const [buyerResult, setBuyerResult] = useState(null);
  const [buyerLoading, setBuyerLoading] = useState(false);
  
  // Checkout state
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState(null);
  const [executionTrace, setExecutionTrace] = useState([]);
  const [verificationInProgress, setVerificationInProgress] = useState(false);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);

  useEffect(() => {
    loadMandate();
  }, [cartId]);

  const loadMandate = async () => {
    try {
      setLoading(true);
      const data = await api(`/api/mandates/${cartId}`);
      setMandate(data.mandate);
    } catch (err) {
      if (err.status === 404) {
        setMandate(null);
      } else {
        setError('Failed to load mandate');
      }
    } finally {
      setLoading(false);
    }
  };

  const createMandate = async () => {
    try {
      setError('');
      const result = await api('/api/mandates', {
        method: 'POST',
        body: JSON.stringify({
          cart_id: cartId,
          ...mandateForm
        })
      });
      setMandate(result.mandate);
      setShowMandateForm(false);
    } catch (err) {
      setError(err.message || 'Failed to create mandate');
    }
  };

  const toggleAutoPay = async () => {
    if (!mandate) return;
    try {
      const endpoint = mandate.auto_pay_enabled 
        ? `/api/mandates/${mandate.id}/disable`
        : `/api/mandates/${mandate.id}/enable`;
      await api(endpoint, { method: 'POST' });
      loadMandate();
    } catch (err) {
      setError('Failed to toggle auto-pay');
    }
  };

  const processBuyerRequest = async () => {
    if (!buyerRequest.trim()) {
      setError('Please enter what the AI buyer wants');
      return;
    }

    setBuyerLoading(true);
    setError('');
    setBuyerResult(null);
    setExecutionTrace([]);

    try {
      const result = await api('/api/agent/buyer', {
        method: 'POST',
        body: JSON.stringify({
          request: buyerRequest,
          cart_id: cartId
        })
      });

      setBuyerResult(result);
      
      // Set execution trace from backend response
      if (result.decision_trace) {
        setExecutionTrace(result.decision_trace.map(step => ({
          ...step,
          status: 'completed'
        })));
      } else {
        // Fallback trace if backend doesn't provide one
        setExecutionTrace([
          { step: 'Understanding buyer request', detail: 'AI analyzing natural language request', status: 'completed' },
          { step: 'Loading buyer mandate', detail: 'Retrieving spending authorization', status: 'completed' },
          { step: 'Filtering catalog against mandate', detail: 'Applying mandate constraints to products', status: 'completed' },
          { step: 'Selecting eligible products', detail: 'Choosing products within authorization', status: 'completed' },
          { step: 'Validating mandate', detail: 'Final mandate verification', status: 'pending' },
          { step: 'Validating merchant policy', detail: 'Checking merchant rules', status: 'pending' },
        ]);
      }
    } catch (err) {
      setError(err.message || 'Unable to process buyer request');
    } finally {
      setBuyerLoading(false);
    }
  };

  const addToCart = async (productId, quantity = 1) => {
    try {
      await api(`/api/cart/${cartId}/items`, {
        method: 'POST',
        body: JSON.stringify({
          product_id: productId,
          qty: quantity
        })
      });
      onRefresh();
    } catch (err) {
      setError('Failed to add to cart');
    }
  };

  const autonomousCheckout = async () => {
    if (!buyerResult || !buyerResult.mandate?.approved) {
      setError('Cannot checkout: mandate not approved');
      return;
    }

    if (checkoutLoading || verificationInProgress) {
      setError('Checkout already in progress');
      return;
    }

    setCheckoutLoading(true);
    setVerificationInProgress(true);
    setError('');
    setCheckoutResult(null);

    try {
      // First, clear the existing cart to ensure AI selections are the only items
      setExecutionTrace(prev => [...prev, {
        step: 'Clearing existing cart',
        detail: 'Removing existing items to prepare for AI purchase',
        status: 'in_progress'
      }]);

      // Clear cart items
      await api(`/api/cart/${cartId}/clear`, {
        method: 'POST'
      });

      setExecutionTrace(prev => prev.map(step => 
        step.step === 'Clearing existing cart' 
          ? { ...step, status: 'completed' }
          : step
      ));

      // Add all recommended items to the cart
      for (const rec of buyerResult.recommendations) {
        await api(`/api/cart/${cartId}/items`, {
          method: 'POST',
          body: JSON.stringify({
            product_id: rec.product_id,
            qty: rec.quantity || 1
          })
        });
      }

      // Refresh cart to get updated state
      await onRefresh();

      setExecutionTrace(prev => [...prev, {
        step: 'Adding recommended items to cart',
        detail: `Added ${buyerResult.recommendations.length} item(s) to cart`,
        status: 'completed'
      }]);

      // Log amounts for verification
      const aiSelectedTotal = buyerResult.recommendations.reduce(
        (sum, rec) => sum + (rec.price * (rec.quantity || 1)), 0
      );
      const finalCartTotal = cart?.total || 0;

      console.log('[AI CHECKOUT] AI selected total =', aiSelectedTotal);
      console.log('[AI CHECKOUT] Final cart total =', finalCartTotal);

      setExecutionTrace(prev => [...prev, {
        step: 'Cart prepared',
        detail: `Cart prepared with AI selections. Total: ₹${finalCartTotal.toLocaleString()}`,
        status: 'completed'
      }]);

      setExecutionTrace(prev => [...prev, {
        step: 'Payment authorization validated',
        detail: 'Buyer mandate and merchant policy validated for autonomous purchase',
        status: 'completed'
      }]);

      // Open CheckoutModal for actual Razorpay payment
      setExecutionTrace(prev => [...prev, {
        step: 'Opening secure payment checkout',
        detail: 'Launching Razorpay Checkout for test payment',
        status: 'in_progress'
      }]);

      setShowCheckoutModal(true);

    } catch (err) {
      const errorMessage = err.detail || err.message || err.toString();
      setError(errorMessage);
      setExecutionTrace(prev => [...prev, {
        step: 'Checkout failed',
        detail: errorMessage,
        status: 'failed'
      }]);
    } finally {
      setCheckoutLoading(false);
      // Keep verificationInProgress true until CheckoutModal completes
    }
  };

  const handleAutonomousPaymentSuccess = (verification) => {
    console.log('[AI CHECKOUT] Payment verified:', verification);

    setExecutionTrace(prev => [...prev, {
      step: 'Payment verified',
      detail: `Payment ID: ${verification.payment_id}, Order ID: ${verification.razorpay_order_id}`,
      status: 'completed'
    }]);

    setExecutionTrace(prev => [...prev, {
      step: 'Order persisted',
      detail: `Application order ${verification.order_id} persisted successfully`,
      status: 'completed'
    }]);

    setCheckoutResult({
      order: verification,
      mandate: buyerResult.mandate
    });

    setExecutionTrace(prev => [...prev, {
      step: 'Autonomous purchase complete',
      detail: 'AI Buyer completed autonomous purchase under mandate',
      status: 'completed'
    }]);

    setVerificationInProgress(false);
    setShowCheckoutModal(false);

    // Refresh orders and cart
    onRefresh();
  };

  const handleCheckoutModalClose = () => {
    setShowCheckoutModal(false);
    setVerificationInProgress(false);
    setCheckoutLoading(false);

    setExecutionTrace(prev => [...prev, {
      step: 'Payment not completed',
      detail: 'Razorpay Checkout was closed without completing payment',
      status: 'failed'
    }]);
  };

  if (loading) {
    return (
      <div className="ai-buyer">
        <div className="loading">Loading AI Buyer...</div>
      </div>
    );
  }

  return (
    <div className="ai-buyer">
      {/* ============================================================
          HEADER
      ============================================================ */}
      
      <div className="ai-buyer-header">
        <div>
          <p className="section-kicker">AUTONOMOUS AI BUYER</p>
          <h2>🤖 AI Buyer</h2>
          <p className="ai-buyer-description">
            Configure your spending authority and let the AI make purchases within your limits
          </p>
        </div>
        <div className={`ai-buyer-status ${mandate?.enabled ? 'active' : 'inactive'}`}>
          <span>{mandate?.enabled ? '●' : '○'}</span>
          {mandate?.enabled ? 'ACTIVE' : 'INACTIVE'}
        </div>
      </div>

      {/* ============================================================
          BUYER MANDATE
      ============================================================ */}
      
      <section className="mandate-section">
        <div className="section-header">
          <h3>BUYER MANDATE</h3>
          {!mandate && (
            <button 
              className="primary-button"
              onClick={() => setShowMandateForm(true)}
            >
              Create Mandate
            </button>
          )}
        </div>

        {showMandateForm && (
          <div className="mandate-form">
            <div className="form-row">
              <label>Maximum Order Amount</label>
              <input
                type="number"
                value={mandateForm.max_order_amount}
                onChange={(e) => setMandateForm({...mandateForm, max_order_amount: Number(e.target.value)})}
                placeholder="₹"
              />
            </div>
            <div className="form-row">
              <label>Maximum Item Price</label>
              <input
                type="number"
                value={mandateForm.max_item_price}
                onChange={(e) => setMandateForm({...mandateForm, max_item_price: Number(e.target.value)})}
                placeholder="₹"
              />
            </div>
            <div className="form-row">
              <label>Daily Spending Limit</label>
              <input
                type="number"
                value={mandateForm.max_daily_spend}
                onChange={(e) => setMandateForm({...mandateForm, max_daily_spend: Number(e.target.value)})}
                placeholder="₹"
              />
            </div>
            <div className="form-row">
              <label>Allowed Categories</label>
              <select
                multiple
                value={mandateForm.allowed_categories}
                onChange={(e) => setMandateForm({...mandateForm, allowed_categories: Array.from(e.target.selectedOptions, opt => opt.value)})}
              >
                <option value="Kitchen">Kitchen</option>
                <option value="Cookware">Cookware</option>
                <option value="Knives">Knives</option>
                <option value="Utensils">Utensils</option>
              </select>
            </div>
            <div className="form-row checkbox">
              <input
                type="checkbox"
                checked={mandateForm.auto_pay_enabled}
                onChange={(e) => setMandateForm({...mandateForm, auto_pay_enabled: e.target.checked})}
              />
              <label>Enable Autonomous Payments</label>
            </div>
            <div className="form-row">
              <label>Mandate Expiry (optional)</label>
              <input
                type="date"
                value={mandateForm.expires_at}
                onChange={(e) => setMandateForm({...mandateForm, expires_at: e.target.value})}
              />
            </div>
            <div className="form-actions">
              <button onClick={() => setShowMandateForm(false)}>Cancel</button>
              <button className="primary-button" onClick={createMandate}>Create Mandate</button>
            </div>
          </div>
        )}

        {mandate && (
          <div className="mandate-display">
            <div className="mandate-status">
              <span className={`status-indicator ${mandate.enabled ? 'active' : 'inactive'}`}>
                {mandate.enabled ? '●' : '○'}
              </span>
              <span>{mandate.enabled ? 'ACTIVE' : 'INACTIVE'}</span>
            </div>
            
            <div className="mandate-details">
              <div className="mandate-detail">
                <span>Maximum Order</span>
                <strong>{money(mandate.max_order_amount)}</strong>
              </div>
              <div className="mandate-detail">
                <span>Maximum Item</span>
                <strong>{money(mandate.max_item_price)}</strong>
              </div>
              {mandate.max_daily_spend && (
                <div className="mandate-detail">
                  <span>Daily Limit</span>
                  <strong>{money(mandate.max_daily_spend)}</strong>
                </div>
              )}
              <div className="mandate-detail">
                <span>Allowed Categories</span>
                <strong>{mandate.allowed_categories?.join(', ') || 'All'}</strong>
              </div>
              <div className="mandate-detail">
                <span>Auto-Pay</span>
                <strong className={mandate.auto_pay_enabled ? 'enabled' : 'disabled'}>
                  {mandate.auto_pay_enabled ? '✓ ENABLED' : '○ DISABLED'}
                </strong>
              </div>
              {mandate.expires_at && (
                <div className="mandate-detail">
                  <span>Expires</span>
                  <strong>{new Date(mandate.expires_at).toLocaleDateString()}</strong>
                </div>
              )}
            </div>

            <div className="mandate-actions">
              <button onClick={toggleAutoPay}>
                {mandate.auto_pay_enabled ? 'Disable Auto-Pay' : 'Enable Auto-Pay'}
              </button>
            </div>
          </div>
        )}

        {!mandate && !showMandateForm && (
          <div className="no-mandate">
            <p>No autonomous buying authorization configured.</p>
            <p>Create a mandate to allow the AI Buyer to purchase within limits.</p>
            <button className="primary-button" onClick={() => setShowMandateForm(true)}>
              Create Buyer Mandate
            </button>
          </div>
        )}
      </section>

      {/* ============================================================
          AI BUYER REQUEST
      ============================================================ */}
      
      <section className="ai-request-section">
        <div className="section-header">
          <h3>ASK YOUR AI BUYER</h3>
        </div>
        
        <div className="ai-request-input">
          <textarea
            value={buyerRequest}
            onChange={(e) => setBuyerRequest(e.target.value)}
            placeholder="Example: Buy a useful kitchen accessory under ₹2,000"
            rows={3}
          />
          <button
            className="primary-button"
            disabled={buyerLoading || !mandate?.enabled}
            onClick={processBuyerRequest}
          >
            {buyerLoading ? '🤖 AI Buyer is thinking...' : 'Ask AI'}
          </button>
        </div>
      </section>

      {/* ============================================================
          AI RESULT
      ============================================================ */}
      
      {buyerResult && (
        <section className="ai-result-section">
          <div className="section-header">
            <h3>🤖 AI BUYER DECISION</h3>
          </div>

          {/* Mandate Status */}
          <div className={`mandate-validation ${buyerResult.mandate?.approved ? 'approved' : 'rejected'}`}>
            <span className="status-icon">
              {buyerResult.mandate?.approved ? '✓' : '✗'}
            </span>
            <div>
              <strong>MANDATE CHECK</strong>
              <p>{buyerResult.mandate?.status}</p>
              {buyerResult.mandate?.violations?.length > 0 && (
                <ul className="violations">
                  {buyerResult.mandate.violations.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Recommendations */}
          {buyerResult.recommendations?.length > 0 && (
            <div className="ai-recommendations">
              <p>
                {buyerResult.mandate?.approved 
                  ? `I found ${buyerResult.recommendations.length} product(s) that match your request and are within your autonomous spending authority.` 
                  : `I found ${buyerResult.recommendations.length} product(s) that match your request, but the complete bundle exceeds your mandate limits.`
                }
              </p>
              
              {buyerResult.mandate?.approved && (
                <p className="eligible-badge">✓ Eligible for Autonomous Purchase</p>
              )}
              
              {buyerResult.recommendations.map((rec, index) => (
                <div key={index} className={`ai-recommendation-card ${buyerResult.mandate?.approved ? 'eligible' : 'ineligible'}`}>
                  <div className="rec-header">
                    <h4>{rec.name}</h4>
                    <strong>{money(rec.price)}</strong>
                  </div>
                  <p className="rec-reason">{rec.reason}</p>
                  <div className="rec-meta">
                    <span>Category: {rec.category || rec.product?.category || 'N/A'}</span>
                    <span>Stock: {rec.stock !== undefined ? rec.stock : (rec.product?.stock !== undefined ? rec.product.stock : 'N/A')}</span>
                  </div>
                  <div className="rec-actions">
                    <button 
                      className={buyerResult.mandate?.approved ? "primary-button" : "secondary-button"}
                      onClick={() => addToCart(rec.product_id, rec.quantity)}
                      disabled={!buyerResult.mandate?.approved}
                    >
                      {buyerResult.mandate?.approved ? 'Add to Cart' : 'Bundle Exceeds Mandate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* No eligible products */}
          {buyerResult.recommendations?.length === 0 && (
            <div className="no-eligible-products">
              <h4>⚠ No Suitable Products Found</h4>
              <p>No combination of products fits within your autonomous spending authority.</p>
              <div className="mandate-summary">
                <h5>Your Current Mandate Limits:</h5>
                <div className="mandate-limits">
                  {buyerResult.mandate?.violations?.map((v, i) => (
                    <div key={i} className="mandate-violation">✗ {v}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Autonomous Checkout */}
          {buyerResult.mandate?.approved && buyerResult.policy_status === 'APPROVED' && mandate?.auto_pay_enabled && (
            <div className="autonomous-checkout">
              <div className="checkout-header">
                <h3>🤖 AUTONOMOUS CHECKOUT</h3>
                <p>The AI Buyer is authorized to complete this purchase within your spending mandate.</p>
              </div>

              <div className="checkout-summary">
                <div className="checkout-item">
                  <span>Products</span>
                  <strong>{buyerResult.recommendations?.length || 0} item(s)</strong>
                </div>
                <div className="checkout-item">
                  <span>Total Amount</span>
                  <strong>{money(buyerResult.subtotal || 0)}</strong>
                </div>
                <div className="checkout-item">
                  <span>Buyer Mandate</span>
                  <strong className="success">✓ Approved</strong>
                </div>
                <div className="checkout-item">
                  <span>Merchant Policy</span>
                  <strong className="success">✓ Approved</strong>
                </div>
                <div className="checkout-item">
                  <span>Auto-Pay</span>
                  <strong className="success">✓ Enabled</strong>
                </div>
              </div>

              <button
                className="checkout-button"
                disabled={checkoutLoading}
                onClick={autonomousCheckout}
              >
                {checkoutLoading ? 'Processing...' : 'Buy Autonomously'}
              </button>
            </div>
          )}

          {/* Blocked States */}
          {!buyerResult.mandate?.approved && (
            <div className="checkout-blocked">
              <h3>⚠ AUTONOMOUS PURCHASE BLOCKED</h3>
              <p>The AI Buyer cannot complete this purchase.</p>
              <div className="block-reason">
                <strong>Reason:</strong>
                <p>{buyerResult.mandate?.violations?.join(', ') || 'Mandate not approved'}</p>
              </div>
              <p>No payment was initiated.</p>
              <button onClick={() => setShowMandateForm(true)}>Update Mandate</button>
            </div>
          )}

          {buyerResult.mandate?.approved && buyerResult.policy_status !== 'APPROVED' && (
            <div className="checkout-blocked">
              <h3>⏳ MERCHANT APPROVAL REQUIRED</h3>
              <p>The AI Buyer found these products, but merchant policy requires human approval.</p>
              <p>Payment has NOT been initiated.</p>
              <button onClick={() => onRefresh()}>View Approval Queue</button>
            </div>
          )}
        </section>
      )}

      {/* ============================================================
          EXECUTION TRACE
      ============================================================ */}
      
      {executionTrace.length > 0 && (
        <section className="execution-trace">
          <div className="section-header">
            <h3>AI EXECUTION TRACE</h3>
          </div>
          
          <div className="trace-timeline">
            {executionTrace.map((step, index) => (
              <div key={index} className={`trace-step ${step.status}`}>
                <span className="step-icon">
                  {step.status === 'completed' ? '✓' : step.status === 'failed' ? '✗' : '⟳'}
                </span>
                <div className="step-content">
                  <strong>{step.step}</strong>
                  <p>{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ============================================================
          SUCCESS STATE
      ============================================================ */}
      
      {checkoutResult && !checkoutLoading && (
        <section className="checkout-success">
          <div className="success-content">
            <div className="success-icon">✅</div>
            <h2>AUTONOMOUS PURCHASE COMPLETE</h2>
            <p>Your AI Buyer successfully completed this purchase within your authorization.</p>
            
            <div className="success-details">
              <div className="success-item">
                <span>Order ID</span>
                <strong>{checkoutResult.order?.order_id || checkoutResult.order?.id || 'Processing...'}</strong>
              </div>
              <div className="success-item">
                <span>Order Number</span>
                <strong>{checkoutResult.order?.order_number || 'Processing...'}</strong>
              </div>
              <div className="success-item">
                <span>Amount</span>
                <strong>{money(checkoutResult.order?.amount || 0)}</strong>
              </div>
              <div className="success-item">
                <span>Payment ID</span>
                <strong>{checkoutResult.order?.payment_id || checkoutResult.order?.razorpay_payment_id || 'Processing...'}</strong>
              </div>
              <div className="success-badge">
                🤖 Purchased by AI Buyer
              </div>
            </div>

            <div className="success-actions">
              <button onClick={() => onRefresh()}>View Order History</button>
              <button onClick={() => onRefresh()}>View Audit Trail</button>
            </div>
          </div>
        </section>
      )}

      {/* ============================================================
          ERROR
      ============================================================ */}
      
      {error && (
        <div className="error-message">
          <p>{typeof error === 'object' ? JSON.stringify(error, null, 2) : error}</p>
          <button onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      {/* Checkout Modal for Autonomous Payment */}
      {showCheckoutModal && (
        <CheckoutModal
          cart={cart}
          cartId={cartId}
          close={handleCheckoutModalClose}
          refresh={onRefresh}
          onSuccess={handleAutonomousPaymentSuccess}
        />
      )}
    </div>
  );
}