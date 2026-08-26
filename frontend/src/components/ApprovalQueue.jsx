const money = (n) =>
  `₹${(n || 0).toLocaleString('en-IN')}`;

const readPayload = (row) => {
  try { return JSON.parse(row.payload || '{}'); } catch { return {}; }
};

export default function ApprovalQueue({ rows = [], onDecision }) {
  return (
    <section id="approvals" className="approval-panel">

      {/* HEADER */}
      <header className="approval-header">
        <div>
          <p className="section-kicker">
            HUMAN OVERSIGHT
          </p>

          <h2>Approval Queue</h2>

          <p className="approval-subtitle">
            High-value growth actions waiting for authorization
          </p>
        </div>

        <div
          className={`approval-count ${
            rows.length ? 'has-items' : ''
          }`}
        >
          <strong>{rows.length}</strong>

          <span>
            {rows.length === 1
              ? 'action pending'
              : 'actions pending'}
          </span>
        </div>
      </header>

      {/* EMPTY STATE */}
      {!rows.length ? (
        <div className="approval-empty-new">
          <div className="approval-success-icon">
            ✓
          </div>

          <div>
            <h3>Everything is clear</h3>

            <p>
              There are no growth actions waiting for human
              approval. Approved actions are executed
              automatically according to policy.
            </p>
          </div>
        </div>
      ) : (

        /* PENDING APPROVALS */
        <div className="approval-list">

          {rows.map((row) => (

            (() => {
              const payload = readPayload(row);
              const impact = payload.financial_impact || {};
              return (

            <article
              className="approval-item"
              key={row.id}
            >

              {/* TOP */}
              <div className="approval-item-top">

                <div className="approval-action-id">

                  <span>
                    #{String(row.id).padStart(3, '0')}
                  </span>

                  <div>
                    <small>
                      GROWTH ACTION
                    </small>

                    <h3>
                      Recommended add-ons
                    </h3>
                  </div>

                </div>

                <div className="approval-status">
                  <span />
                  PENDING REVIEW
                </div>

              </div>


              {/* MAIN */}
              <div className="approval-main">

                <div className="approval-warning">
                  <span>!</span>
                </div>

                <div className="approval-description">

                  <p>
                    Recommended add-ons total{' '}
                    <strong>
                      {money(row.amount)}
                    </strong>.
                  </p>

                  <small>
                    This exceeds the ₹2,000 automatic
                    approval threshold. Human authorization
                    is required before execution.
                  </small>

                  <div className="approval-proposal-details">
                    <strong>AI GROWTH PROPOSAL</strong>
                    <span>Current cart: {money(impact.current_subtotal)}</span>
                    {payload.addons?.map((addon) => <span key={addon.product_id}>{addon.product_name || addon.product_id} · {money(addon.price_snapshot)} x {addon.qty}<br />{addon.reasoning}</span>)}
                    <span>Projected cart: {money(impact.estimated_total_before_discount)} · Final: {money(impact.estimated_total_after_discount)}</span>
                    <span>Discount: {impact.discount_pct || payload.discount_pct || 0}% · Increase: {impact.cart_increase_pct || 0}%</span>
                  </div>

                </div>

                <div className="approval-value">

                  <small>
                    ACTION VALUE
                  </small>

                  <strong>
                    {money(row.amount)}
                  </strong>

                </div>

              </div>


              {/* POLICY */}
              <div className="approval-policy-note">

                <span>✓</span>

                Policy validation completed. Human review
                is the final gate before this action can
                modify the cart.

              </div>


              {/* ACTIONS */}
              <footer className="approval-actions">

                <button
                  type="button"
                  className="approve-button"
                  onClick={() =>
                    onDecision(row.id, 'approve')
                  }
                >
                  <span>✓</span>
                  Approve action
                </button>

                <button
                  type="button"
                  className="reject-button"
                  onClick={() =>
                    onDecision(row.id, 'reject')
                  }
                >
                  Reject
                </button>

              </footer>

            </article>

              );
            })()

          ))}

        </div>
      )}

    </section>
  );
}