import React, { useMemo } from 'react';
import RecommendationReason from './RecommendationReason';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

export default function AgentPanel({ result, loading, onRun, onAddApproved }) {
  const gateStatus = result?.gate?.status;
  const pending = gateStatus === 'pending' || gateStatus === 'merchant_pending';
  const rejected = gateStatus === 'rejected';
  const approved = gateStatus === 'approved' || result?.outcome?.status === 'approved';
  const blocked = result?.validator?.status === 'blocked';
  const totalAddonValue = useMemo(() => result?.addons?.reduce((sum, addon) => sum + ((addon.product?.price || 0) * (addon.qty || 1)), 0) || 0, [result?.addons]);
  const currentCartValue = Number(result?.cart?.subtotal || 0);
  const cartIncrease = currentCartValue ? (totalAddonValue / currentCartValue) * 100 : 0;
  const bannerStatus = pending ? 'pending' : rejected ? 'rejected' : 'approved';

  return (
    <section id="growth-ai" className="agent-panel">
      <header className="agent-header"><div className="agent-title"><div className="agent-logo">✦</div><div><p className="section-kicker">AI COMMERCE ENGINE</p><h2>Growth Agent</h2><p className="agent-subtitle">Analyzes the current cart and sends bounded proposals for merchant approval.</p></div></div><div className={`agent-status ${loading ? 'analyzing' : ''}`}><span />{loading ? 'ANALYZING' : 'READY'}</div></header>
      {!loading && !result && <div className="agent-empty-new"><div className="agent-empty-icon">✦</div><h3>Find useful additions for this cart</h3><p>Run the Growth Agent to generate complementary recommendations. Nothing changes until the merchant approves and the buyer adds an approved item.</p></div>}
      {loading && <div className="agent-loading-new" aria-live="polite"><div className="loading-orbit">✦</div><div><h3>Analyzing your cart</h3><p>Checking compatibility, inventory and policy limits.</p></div></div>}
      {!loading && result && <div className="agent-result">
        <div className={`agent-decision-banner ${bannerStatus}`}><div className="decision-icon">{rejected ? '×' : pending ? '!' : '✓'}</div><div><strong>{pending ? 'Merchant approval required' : rejected ? 'Merchant approval rejected' : approved ? 'Merchant approval granted' : 'Proposal generated'}</strong><p>{pending ? 'Recommendations are waiting in the Merchant Approval Queue. The cart has not changed.' : rejected ? 'The rejected recommendation was not added to the cart.' : approved ? 'Approved items are available for the buyer to add explicitly.' : 'The proposal is ready for review.'}</p></div><span className="decision-amount">{money(totalAddonValue)}</span></div>
        <div className="agent-reasoning-card"><div className="card-label"><span>AI REASONING</span><span className="verified-label">● BOUNDED</span></div><p>{result.explanation?.summary || result.proposal?.reasoning || result.reasoning || 'Recommendations are based on the current cart and verified catalog data.'}</p></div>
        <div className="growth-opportunity-card"><div><span className="card-label">REVENUE OPPORTUNITY</span><h3>{money(totalAddonValue)} potential add-on value</h3><p>Current cart {money(currentCartValue)} · Potential increase {cartIncrease.toFixed(1)}%</p></div><div className={`opportunity-status ${pending ? 'pending' : 'approved'}`}>{pending ? 'MERCHANT REVIEW' : 'REVIEWED'}</div></div>
        <div className="agent-section"><div className="agent-section-heading"><div><span className="section-number">01</span><div><h3>Recommended add-ons</h3><p>Each item was evaluated against the current cart.</p></div></div><span className="count-pill">{result.addons?.length || 0} items</span></div>{!result.addons?.length ? <div className="agent-no-results">No relevant add-ons were found for this cart.</div> : <div className="recommendations-new">{result.addons.map((addon, index) => <article className="recommendation-card" key={addon.product_id || index}><div className="recommendation-number">0{index + 1}</div><div className="recommendation-art">◇</div><div className="recommendation-info"><h4>{addon.product?.name || 'Unknown Product'}</h4><p>{addon.reasoning || `Complements the current cart: ${(addon.based_on_cart_items || result.cart?.items?.map((item) => item.name) || []).join(', ')}.`}</p><span>{addon.product?.stock ?? 0} in stock</span><span className={`addon-approval-status ${String(addon.approval_status || 'PENDING').toLowerCase()}`}>{addon.approval_status || 'PENDING'}</span><RecommendationReason addon={addon} cartItems={result.cart?.items || []} />{addon.approval_status === 'APPROVED' && <button className="addon-select-button" onClick={() => onAddApproved(addon)}>Add Approved Add-on</button>}{addon.approval_status === 'PENDING' && <span className="addon-lock">Merchant approval required before adding</span>}</div><strong>{money(addon.product?.price)}</strong></article>)}</div>}</div>
        <div className="agent-section"><div className="agent-section-heading"><div><span className="section-number">02</span><div><h3>Governance</h3><p>AI proposes. Policy validates. Merchant authorizes.</p></div></div></div><div className="governance-list"><div><span className="check success">✓</span><span>Cart analyzed</span><small>OK</small></div><div><span className="check success">✓</span><span>Inventory validated</span><small>OK</small></div><div><span className="check success">✓</span><span>Discount policy checked</span><small>{blocked ? 'BLOCKED' : 'OK'}</small></div><div><span className={`check ${pending ? 'warning' : rejected ? 'error' : 'success'}`}>{pending ? '!' : rejected ? '×' : '✓'}</span><span>Merchant authorization</span><small>{pending ? 'PENDING' : rejected ? 'REJECTED' : 'APPROVED'}</small></div></div></div>
      </div>}
      <button className="agent-run-button" disabled={loading} onClick={onRun}><span>✦</span>{loading ? 'Analyzing cart...' : result ? 'Run Again' : 'Run Growth Agent'}{!loading && <b>→</b>}</button>
    </section>
  );
}
