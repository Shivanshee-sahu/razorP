import RecommendationReason from './RecommendationReason';
import ApprovalStatus from './ApprovalStatus';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

export default function GrowthProposal({ result, cartItems = [], onApprove, onReject, busy = false }) {
  if (!result) return null;
  const impact = result.financial_impact || {};
  const status = result.outcome?.status || result.gate?.status || 'pending';
  return (
    <section className="growth-proposal">
      <ApprovalStatus status={status === 'executed' ? 'approved' : status} />
      <div className="proposal-financials">
        <div><span>CURRENT CART</span><strong>{money(impact.current_subtotal || result.cart?.subtotal)}</strong></div>
        <div><span>ADD-ON VALUE</span><strong>{money(impact.addon_total)}</strong></div>
        <div><span>PROJECTED FINAL</span><strong>{money(impact.estimated_total_after_discount)}</strong></div>
        <div><span>DISCOUNT</span><strong>{impact.discount_pct || 0}%</strong></div>
      </div>
      <div className="proposal-addons">
        {(result.addons || []).map((addon) => <article key={addon.product_id}><strong>{addon.product?.name || addon.product_name}</strong><span>{money(addon.product?.price)} x {addon.qty}</span><RecommendationReason addon={addon} cartItems={cartItems} /></article>)}
      </div>
      {status === 'pending' && <footer><button disabled={busy} onClick={onApprove}>{busy ? 'Approving...' : 'Approve & Apply'}</button><button disabled={busy} onClick={onReject}>Reject</button></footer>}
    </section>
  );
}
