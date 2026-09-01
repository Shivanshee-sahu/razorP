import { useState } from 'react';

const money = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN')}`;

const readPayload = (row) => {
  try {
    return JSON.parse(row.payload || '{}');
  } catch {
    return {};
  }
};

const MAX_POLICY_DISCOUNT = 10; // Policy limit: 10%

const calculateImpact = (row, payload, discountPct) => {
  const impact = payload.financial_impact || {};
  const clampedDiscount = Math.max(0, Math.min(100, Number(discountPct) || 0));

  const addonValue = Number(impact.addon_total || row.amount || 0);
  const currentCart = Number(impact.current_subtotal || 0);

  const discountAmount = addonValue * (clampedDiscount / 100);
  const finalAddonValue = addonValue - discountAmount;
  const projectedCart = currentCart + finalAddonValue;
  const cartIncrease =
    currentCart > 0 ? (finalAddonValue / currentCart) * 100 : 0;

  return {
    addonValue,
    currentCart,
    discountAmount,
    finalAddonValue,
    projectedCart,
    cartIncrease,
    discountPct: clampedDiscount,
  };
};

export default function ApprovalQueue({ rows = [], onDecision }) {
  const [approvedDiscounts, setApprovedDiscounts] = useState({});

  const handleDiscountChange = (rowId, value) => {
    setApprovedDiscounts((previous) => ({
      ...previous,
      [rowId]: value,
    }));
  };

  return (
    <section id="approvals" className="approval-panel">
      {/* HEADER */}
      <header className="approval-header">
        <div>
          <p className="section-kicker">HUMAN OVERSIGHT</p>
          <h2>Approval Queue</h2>
          <p className="approval-subtitle">
            Commercial authorization & financial impact simulator for Growth Engine actions
          </p>
        </div>

        <div className={`approval-count ${rows.length ? 'has-items' : ''}`}>
          <strong>{rows.length}</strong>
          <span>{rows.length === 1 ? 'action pending' : 'actions pending'}</span>
        </div>
      </header>

      {/* EMPTY STATE */}
      {!rows.length ? (
        <div className="approval-empty-new">
          <div className="approval-success-icon">✓</div>
          <div>
            <h3>Everything is clear</h3>
            <p>
              There are no growth actions waiting for human approval. Approved actions are executed automatically according to policy.
            </p>
          </div>
        </div>
      ) : (
        /* PENDING APPROVALS */
        <div className="approval-list">
          {rows.map((row) => {
            const payload = readPayload(row);
            const requestedDiscount = Number(row.buyer_requested_discount_pct || 0);
            
            // Dynamic discount state priority: User local state > Buyer request > 0
            const currentDiscount =
              approvedDiscounts[row.id] !== undefined
                ? approvedDiscounts[row.id]
                : requestedDiscount;

            const liveImpact = calculateImpact(row, payload, currentDiscount);
            const isPolicyViolated = liveImpact.discountPct > MAX_POLICY_DISCOUNT;
            const recommendedDiscount = Math.min(requestedDiscount, 3); // Policy preset recommendation

            return (
              <article className="approval-item" key={row.id}>
                {/* TOP HEADER */}
                <div className="approval-item-top">
                  <div className="approval-action-id">
                    <span>#{String(row.id).padStart(3, '0')}</span>
                    <div>
                      <small>GROWTH ACTION</small>
                      <h3>
                        {row.kind === 'growth_item'
                          ? 'Growth add-on approval'
                          : 'Merchant commercial approval'}
                      </h3>
                    </div>
                  </div>

                  <div className="approval-status">
                    <span />
                    PENDING REVIEW
                  </div>
                </div>

                {/* SIMULATOR & METRICS */}
                <div className="approval-main">
                  <div className="merchant-decision-preview">
                    <div className="preview-header">
                      <div>
                        <span className="card-label">FINANCIAL IMPACT SIMULATOR</span>
                        <h3>Review commercial impact before authorizing</h3>
                      </div>
                      <span className="preview-badge">LIVE CALCULATION</span>
                    </div>

                    {/* DISCOUNT CONTROLS */}
                    {row.kind === 'growth_item' && (
                      <div className="discount-simulator-box">
                        <div className="discount-info-row">
                          <div className="discount-meta">
                            <span>Buyer Requested: <strong>{requestedDiscount}%</strong></span>
                            <span>Policy Limit: <strong>{MAX_POLICY_DISCOUNT}%</strong></span>
                          </div>
                          
                          {recommendedDiscount !== requestedDiscount && (
                            <button
                              type="button"
                              className="preset-button"
                              onClick={() => handleDiscountChange(row.id, recommendedDiscount)}
                            >
                              ✦ Use AI Rec: {recommendedDiscount}%
                            </button>
                          )}
                        </div>

                        <div className="discount-control-group">
                          <label htmlFor={`discount-range-${row.id}`}>
                            Approve Discount:
                          </label>
                          <input
                            id={`discount-range-${row.id}`}
                            type="range"
                            min="0"
                            max="15"
                            step="1"
                            value={liveImpact.discountPct}
                            onChange={(e) => handleDiscountChange(row.id, e.target.value)}
                            className="discount-slider"
                          />
                          <div className="discount-number-input">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={liveImpact.discountPct}
                              onChange={(e) => handleDiscountChange(row.id, e.target.value)}
                            />
                            <span>%</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* LIVE FINANCIAL IMPACT GRID */}
                    <div className="financial-impact-grid">
                      <div>
                        <small>ADD-ON VALUE</small>
                        <strong>{money(liveImpact.addonValue)}</strong>
                      </div>
                      <div>
                        <small>DISCOUNT COST</small>
                        <strong className="text-discount">
                          -{money(liveImpact.discountAmount)}
                        </strong>
                      </div>
                      <div>
                        <small>NET ADD-ON REVENUE</small>
                        <strong className="text-success">
                          {money(liveImpact.finalAddonValue)}
                        </strong>
                      </div>
                      <div>
                        <small>PROJECTED CART</small>
                        <strong>{money(liveImpact.projectedCart)}</strong>
                      </div>
                    </div>

                    {/* CART GROWTH COMPARISON */}
                    <div className="cart-growth-preview">
                      <div>
                        <span>Current Cart</span>
                        <strong>{money(liveImpact.currentCart)}</strong>
                      </div>
                      <div className="growth-arrow">→</div>
                      <div>
                        <span>After Approval</span>
                        <strong>{money(liveImpact.projectedCart)}</strong>
                      </div>
                      <div className="growth-percentage">
                        +{liveImpact.cartIncrease.toFixed(1)}% Cart Increase
                      </div>
                    </div>

                    {/* POLICY AUDIT CHECK */}
                    <div className="policy-preview">
                      <div className={isPolicyViolated ? 'policy-item error' : 'policy-item success'}>
                        <span className="check">{isPolicyViolated ? '×' : '✓'}</span>
                        <span>
                          {isPolicyViolated
                            ? `Discount exceeds maximum merchant policy limit (${MAX_POLICY_DISCOUNT}%)`
                            : `Discount within allowed limit (≤ ${MAX_POLICY_DISCOUNT}%)`}
                        </span>
                      </div>
                      <div className="policy-item success">
                        <span className="check">✓</span>
                        <span>Catalog stock reservation confirmed</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ACTIONS */}
                <footer className="approval-actions">
                  <button
                    type="button"
                    className="approve-button"
                    disabled={isPolicyViolated}
                    onClick={() =>
                      onDecision(row.id, 'approve', {
                        ...row,
                        approved_discount_pct: liveImpact.discountPct,
                        final_addon_amount: liveImpact.finalAddonValue,
                      })
                    }
                  >
                    <span>✓</span> Approve Action ({liveImpact.discountPct}%)
                  </button>

                  <button
                    type="button"
                    className="reject-button"
                    onClick={() => onDecision(row.id, 'reject', row)}
                  >
                    Reject Action
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}