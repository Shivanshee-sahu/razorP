import React, { useMemo } from 'react';
import RecommendationReason from './RecommendationReason';

const money = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN')}`;

export default function AgentPanel({
  result,
  loading,
  onRun,
  onAddApproved,
  onRequestDiscount,
  maxDiscountPct = 10,
}) {
  const [discountRequests, setDiscountRequests] = React.useState({});
  const [requestPending, setRequestPending] = React.useState({});
  const [addedAddons, setAddedAddons] = React.useState({});

  const gateStatus = result?.gate?.status;

  const pending =
    gateStatus === 'pending' ||
    gateStatus === 'merchant_pending';

  const rejected = gateStatus === 'rejected';

  const approved =
    gateStatus === 'approved' ||
    result?.outcome?.status === 'approved';

  const blocked = result?.validator?.status === 'blocked';

  const totalAddonValue = useMemo(() => {
    return (
      result?.addons?.reduce(
        (sum, addon) =>
          sum + ((addon.product?.price || 0) * (addon.qty || 1)),
        0
      ) || 0
    );
  }, [result?.addons]);

  const bannerStatus = pending
    ? 'pending'
    : rejected
    ? 'rejected'
    : 'approved';

  const handleRequestDiscount = async (addon) => {
    const productId = addon.product_id || addon.product?.id;

    const requestedDiscount = Number(
      discountRequests[productId] ?? addon.requested_discount_pct ?? 0
    );

    if (!productId) {
      console.error('Missing product ID for discount request');
      return;
    }

    if (requestPending[productId]) return;

    if (requestedDiscount < 0 || requestedDiscount > maxDiscountPct) {
      alert(`Discount must be between 0% and ${maxDiscountPct}%.`);
      return;
    }

    setRequestPending((previous) => ({
      ...previous,
      [productId]: true,
    }));

    try {
      await onRequestDiscount(addon, requestedDiscount);
    } catch (error) {
      console.error('Failed to request discount:', error);
      setRequestPending((previous) => ({
        ...previous,
        [productId]: false,
      }));
    }
  };

  const handleAddApproved = (addon) => {
    const productId = addon.product_id || addon.product?.id;
    if (productId) {
      setAddedAddons((prev) => ({
        ...prev,
        [productId]: true,
      }));
    }
    if (onAddApproved) {
      onAddApproved(addon);
    }
  };

  React.useEffect(() => {
    if (!result?.addons) return;

    setRequestPending((previous) => {
      const next = { ...previous };

      result.addons.forEach((addon) => {
        const productId = addon.product_id || addon.product?.id;
        const status = String(addon.approval_status || 'PENDING').toUpperCase();

        if (status === 'APPROVED' || status === 'REJECTED') {
          delete next[productId];
        }
      });

      return next;
    });
  }, [result?.addons]);

  return (
    <section id="growth-ai" className="agent-panel">
      {/* HEADER */}
      <header className="agent-header">
        <div className="agent-title">
          <div className="agent-logo">✦</div>
          <div>
            <p className="section-kicker">AI COMMERCE ENGINE</p>
            <h2>Growth Agent</h2>
            <p className="agent-subtitle">
              Analyzes the current cart and sends bounded proposals for merchant approval.
            </p>
          </div>
        </div>

        <div className={`agent-status ${loading ? 'analyzing' : ''}`}>
          <span />
          {loading ? 'ANALYZING' : 'READY'}
        </div>
      </header>

      {/* EMPTY STATE */}
      {!loading && !result && (
        <div className="agent-empty-new">
          <div className="agent-empty-icon">✦</div>
          <h3>Find useful additions for this cart</h3>
          <p>
            Run the Growth Agent to generate complementary recommendations.
            Nothing changes until the merchant approves and the buyer adds an approved item.
          </p>
        </div>
      )}

      {/* LOADING */}
      {loading && (
        <div className="agent-loading-new" aria-live="polite">
          <div className="loading-orbit">✦</div>
          <div>
            <h3>Analyzing your cart</h3>
            <p>Checking compatibility, inventory and policy limits.</p>
          </div>
        </div>
      )}

      {/* RESULT */}
      {!loading && result && (
        <div className="agent-result">
          {/* DECISION BANNER */}
          <div className={`agent-decision-banner ${bannerStatus}`}>
            <div className="decision-icon">
              {rejected ? '×' : pending ? '!' : '✓'}
            </div>
            <div>
              <strong>
                {pending
                  ? 'Merchant approval required'
                  : rejected
                  ? 'Merchant approval rejected'
                  : approved
                  ? 'Merchant approval granted'
                  : 'Proposal generated'}
              </strong>
              <p>
                {pending
                  ? 'Recommendations are waiting in the Merchant Approval Queue. The cart has not changed.'
                  : rejected
                  ? 'The rejected recommendation was not added to the cart.'
                  : approved
                  ? 'Approved items are available for the buyer to add explicitly.'
                  : 'The proposal is ready for review.'}
              </p>
            </div>
            <span className="decision-amount">{money(totalAddonValue)}</span>
          </div>

          {/* AI REASONING */}
          <div className="agent-reasoning-card">
            <div className="card-label">
              <span>AI REASONING</span>
              <span className="verified-label">● BOUNDED</span>
            </div>
            <p>
              {result.explanation?.summary ||
                result.proposal?.reasoning ||
                result.reasoning ||
                'Recommendations are based on the current cart and verified catalog data.'}
            </p>
          </div>

          {/* RECOMMENDATIONS */}
          <div className="agent-section">
            <div className="agent-section-heading">
              <div>
                <span className="section-number">01</span>
                <div>
                  <h3>Recommended add-ons</h3>
                  <p>Each item was evaluated against the current cart.</p>
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
                {result.addons.map((addon, index) => {
                  const productId = addon.product_id || addon.product?.id;
                  const backendStatus = String(
                    addon.approval_status || 'PENDING'
                  ).toUpperCase();

                  const locallyPending = requestPending[productId];

                  const status =
                    backendStatus === 'APPROVED'
                      ? 'APPROVED'
                      : backendStatus === 'REJECTED'
                      ? 'REJECTED'
                      : locallyPending
                      ? 'REQUESTED'
                      : backendStatus;

                  const requested =
                    discountRequests[productId] ??
                    addon.requested_discount_pct ??
                    0;

                  // PERSISTENCE FIX: Check backend cart items array first
                  const isAlreadyInCart = result.cart?.items?.some((cartItem) => {
                    const cartId = cartItem.product_id || cartItem.id || cartItem.product?.id;
                    return String(cartId) === String(productId);
                  });

                  const isAdded = isAlreadyInCart || Boolean(addedAddons[productId]);

                  return (
                    <article className="recommendation-card" key={productId || index}>
                      <div className="recommendation-number">
                        {String(index + 1).padStart(2, '0')}
                      </div>

                      <div className="recommendation-art" aria-hidden="true">
                        ◇
                      </div>

                      <div className="recommendation-info">
                        <h4>{addon.product?.name || 'Unknown Product'}</h4>
                        <p>
                          {addon.reasoning ||
                            `Complements the current cart: ${
                              (
                                addon.based_on_cart_items ||
                                result.cart?.items?.map((item) => item.name) ||
                                []
                              ).join(', ')
                            }.`}
                        </p>

                        <span>{addon.product?.stock ?? 0} in stock</span>

                        <span
                          className={`addon-approval-status ${String(
                            status
                          ).toLowerCase()}`}
                        >
                          {status === 'REQUESTED'
                            ? 'DISCOUNT REQUEST PENDING'
                            : status}
                        </span>

                        <RecommendationReason
                          addon={addon}
                          cartItems={result.cart?.items || []}
                        />

                        {/* APPROVED */}
                        {status === 'APPROVED' && (
                          <div className="action-row">
                            <span className="discount-approved">
                              DISCOUNT APPROVED {addon.approved_discount_pct || 0}% ·{' '}
                              {money(addon.final_price || addon.product?.price)}
                            </span>
                            <button
                              type="button"
                              className={`addon-select-button ${
                                isAdded ? 'added-button' : 'success'
                              }`}
                              disabled={isAdded}
                              onClick={() => handleAddApproved(addon)}
                            >
                              {isAdded ? '✓ Added to Cart' : 'Add Approved Add-on'}
                            </button>
                          </div>
                        )}

                        {/* REJECTED */}
                        {status === 'REJECTED' && (
                          <span className="addon-lock">
                            Discount request rejected
                          </span>
                        )}

                        {/* PENDING / INPUT FORM */}
                        {status === 'PENDING' && (
  <div className="requested-wrapper">
    <span className="discount-requested">
      ⏳ Merchant Approval Pending
    </span>

    <small className="addon-helper-text">
      This recommendation has been sent to the merchant.
      The product will be added to the cart only after merchant approval.
    </small>
  </div>
)}

                        {/* REQUESTED */}
                        {status === 'REQUESTED' && (
                          <div className="requested-wrapper">
                            <span className="discount-requested">
                              Requested: {requested}%
                            </span>
                            <button
                              type="button"
                              className="addon-select-button pending-button"
                              disabled
                            >
                              ⏳ Discount Request Pending
                            </button>
                            <small className="addon-helper-text">
                              Waiting for merchant approval. You cannot add this product yet.
                            </small>
                          </div>
                        )}
                      </div>

                      <strong>{money(addon.product?.price)}</strong>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          {/* GOVERNANCE */}
          <div className="agent-section">
            <div className="agent-section-heading">
              <div>
                <span className="section-number">02</span>
                <div>
                  <h3>Governance</h3>
                  <p>AI proposes. Policy validates. Merchant authorizes.</p>
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
                <small>{blocked ? 'BLOCKED' : 'OK'}</small>
              </div>

              <div>
                <span
                  className={`check ${
                    pending ? 'warning' : rejected ? 'error' : 'success'
                  }`}
                >
                  {pending ? '!' : rejected ? '×' : '✓'}
                </span>
                <span>Merchant authorization</span>
                <small>
                  {pending ? 'PENDING' : rejected ? 'REJECTED' : 'APPROVED'}
                </small>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RUN AGENT */}
      <button
        className="agent-run-button"
        disabled={loading}
        onClick={onRun}
      >
        <span>✦</span>
        {loading
          ? 'Analyzing cart...'
          : result
          ? 'Run Again'
          : 'Run Growth Agent'}
        {!loading && <b>→</b>}
      </button>
    </section>
  );
}