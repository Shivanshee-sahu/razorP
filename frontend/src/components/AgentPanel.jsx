import React, { useMemo } from 'react';

const money = (n) => `₹${(n || 0).toLocaleString('en-IN')}`;

export default function AgentPanel({ result, loading, onRun }) {
  const gateStatus = result?.gate?.status;
  const pending = gateStatus === 'pending';
  const approved = gateStatus === 'approved';
  const rejected = gateStatus === 'rejected';
  const blocked = result?.validator?.status === 'blocked';

  // Memoize total calculation
  const totalAddonValue = useMemo(() => {
    return result?.addons?.reduce((sum, item) => sum + ((item.product?.price || 0) * (item.qty || 1)), 0) || 0;
  }, [result?.addons]);
  const currentCartValue = Number(result?.cart?.subtotal || 0);
  const cartIncrease = currentCartValue ? (totalAddonValue / currentCartValue) * 100 : 0;

  // Status helper mapping
  const bannerStatusClass = pending ? 'pending' : rejected ? 'rejected' : 'approved';
  const gateActionClass = pending ? 'pending' : rejected ? 'blocked' : 'accepted';

  return (
    <section id="growth-ai" className="agent-panel">
      {/* Header */}
      <header className="agent-header">
        <div className="agent-title">
          <div className="agent-logo" aria-hidden="true">✦</div>
          <div>
            <p className="section-kicker">AI COMMERCE ENGINE</p>
            <h2>Growth Agent</h2>
            <p className="agent-subtitle">
              Cart-aware recommendations with policy enforcement
            </p>
          </div>
        </div>

        <div 
          className={`agent-status ${loading ? 'analyzing' : ''}`}
          aria-live="polite"
        >
          <span />
          {loading ? 'ANALYZING' : 'READY'}
        </div>
      </header>

      {/* Empty State */}
      {!loading && !result && (
        <div className="agent-empty-new">
          <div className="agent-empty-icon" aria-hidden="true">✦</div>
          <h3>Grow the order responsibly</h3>
          <p>
            The Growth Agent analyzes the current cart, finds complementary
            products, checks inventory, validates discounts and applies
            approval rules before anything is executed.
          </p>

          <div className="agent-capabilities">
            <div><span>01</span><b>Analyze</b><small>Understand cart context</small></div>
            <div><span>02</span><b>Suggest</b><small>Find complementary items</small></div>
            <div><span>03</span><b>Validate</b><small>Enforce business policy</small></div>
            <div><span>04</span><b>Review</b><small>Human approval when needed</small></div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="agent-loading-new" aria-live="polite">
          <div className="loading-orbit">
            <span aria-hidden="true">✦</span>
          </div>
          <div>
            <h3>Analyzing your cart</h3>
            <p>Checking inventory, product compatibility and policy constraints.</p>
            <div className="loading-steps">
              <span>Cart analysis</span>
              <span>Product matching</span>
              <span>Policy validation</span>
            </div>
          </div>
        </div>
      )}

      {/* Result State */}
      {!loading && result && (
        <div className="agent-result">
          {/* Decision Banner */}
          <div className={`agent-decision-banner ${bannerStatusClass}`}>
            <div className="decision-icon" aria-hidden="true">
              {pending ? '!' : rejected ? '×' : '✓'}
            </div>
            <div>
              <strong>
                {pending
                  ? 'Human approval required'
                  : approved
                  ? 'Human approval granted'
                  : rejected
                  ? 'Human approval rejected'
                  : 'Action ready to execute'}
              </strong>
              <p>
                {pending
                  ? 'The recommended action exceeds the automatic approval threshold.'
                  : approved
                  ? 'The action was approved by a human reviewer and executed successfully.'
                  : rejected
                  ? 'The recommended action was rejected and was not added to the cart.'
                  : 'The recommendation passed the configured governance checks.'}
              </p>
            </div>
            <span className="decision-amount">{money(totalAddonValue)}</span>
          </div>

          {/* Reasoning */}
   <div className="agent-reasoning-card">
  <div className="card-label">
    <span>AI REASONING</span>
    <span className="verified-label">● BOUNDED</span>
  </div>

  <p>
    {result?.reasoning ??
      result?.proposal?.reasoning ??
      'No reasoning was returned by the agent.'}
  </p>

  {result?.fallback && (
    <small>
      Using local fallback reasoning because the AI service was unavailable.
    </small>
  )}
</div>

          <div className="growth-opportunity-card">
            <div>
              <span className="card-label">REVENUE OPPORTUNITY</span>
              <h3>{money(totalAddonValue)} potential add-on value</h3>
              <p>Current cart {money(currentCartValue)} · Potential increase {cartIncrease.toFixed(1)}%</p>
            </div>
            <div className={`opportunity-status ${pending ? 'pending' : 'approved'}`}>
              {pending ? 'HUMAN APPROVAL REQUIRED' : 'WITHIN AUTO-ACTION LIMIT'}
            </div>
          </div>

          {/* Recommendations */}
          <div className="agent-section">
            <div className="agent-section-heading">
              <div>
                <span className="section-number">01</span>
                <div>
                  <h3>Recommended add-ons</h3>
                  <p>Products selected for the current cart</p>
                </div>
              </div>
              <span className="count-pill">
                {result.addons?.length || 0} items
              </span>
            </div>

            {!result.addons?.length ? (
              <div className="agent-no-results">
                No relevant add-ons were found for this cart.
              </div>
            ) : (
              <div className="recommendations-new">
                {result.addons.map((addon, index) => (
                  <article 
                    className="recommendation-card" 
                    key={addon.product_id || addon.product?.id || index}
                  >
                    <div className="recommendation-number">0{index + 1}</div>
                    <div className="recommendation-art" aria-hidden="true">◇</div>
                    <div className="recommendation-info">
                      <h4>{addon.product?.name || 'Unknown Product'}</h4>
                      <p>{addon.reasoning}</p>
                      <span>{addon.product?.stock ?? 0} in stock</span>
                    </div>
                    <strong>{money(addon.product?.price)}</strong>
                  </article>
                ))}
              </div>
            )}
          </div>

          {/* Policy Validation */}
          <div className="agent-section">
            <div className="agent-section-heading">
              <div>
                <span className="section-number">02</span>
                <div>
                  <h3>Policy validation</h3>
                  <p>Hard limits enforced before execution</p>
                </div>
              </div>
            </div>

            <div className="policy-grid-new">
              <article className={`policy-card ${blocked ? 'blocked' : ''}`}>
                <span>DISCOUNT REQUESTED</span>
                <strong>{result.validator?.requested ?? 0}%</strong>
                <small>{blocked ? 'Exceeded configured limit' : 'Requested by agent'}</small>
              </article>

              <article className="policy-card accepted">
                <span>DISCOUNT APPLIED</span>
                <strong>{result.validator?.accepted ?? 0}%</strong>
                <small>{blocked ? 'Clamped by policy' : 'Within configured limit'}</small>
              </article>

              <article className={`policy-card ${gateActionClass}`}>
                <span>ACTION GATE</span>
                <strong>
                  {pending ? 'REVIEW' : approved ? 'APPROVED' : rejected ? 'REJECTED' : 'AUTO'}
                </strong>
                <small>
                  {pending
                    ? 'Human approval required'
                    : approved
                    ? 'Human approval completed'
                    : rejected
                    ? 'Human approval rejected'
                    : 'Automatically approved'}
                </small>
              </article>
            </div>
          </div>

          {/* Governance */}
          <div className="agent-section">
            <div className="agent-section-heading">
              <div>
                <span className="section-number">03</span>
                <div>
                  <h3>Governance checks</h3>
                  <p>Every decision is auditable</p>
                </div>
              </div>
            </div>

            <div className="governance-list">
              <div>
                <span className="check success">✓</span>
                <span>Cart analyzed</span>
                <small>OK</small>
              </div>
              <div>
                <span className="check success">✓</span>
                <span>Inventory validated</span>
                <small>OK</small>
              </div>
              <div>
                <span className="check success">✓</span>
                <span>Discount policy checked</span>
                <small>{blocked ? 'CLAMPED' : 'OK'}</small>
              </div>
              <div>
                <span className={`check ${pending ? 'warning' : rejected ? 'error' : 'success'}`}>
                  {pending ? '!' : rejected ? '×' : '✓'}
                </span>
                <span>Execution authorization</span>
                <small>{pending ? 'PENDING' : rejected ? 'REJECTED' : 'APPROVED'}</small>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action Button */}
      <button
        className="agent-run-button"
        disabled={loading}
        onClick={onRun}
      >
        <span aria-hidden="true">✦</span>
        {loading ? 'Analyzing cart...' : result ? 'Run Again' : 'Run Growth Agent'}
        {!loading && <b aria-hidden="true">→</b>}
      </button>
    </section>
  );
}