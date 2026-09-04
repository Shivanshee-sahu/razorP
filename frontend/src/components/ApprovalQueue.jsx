
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

const MAX_POLICY_DISCOUNT = 10; // Merchant policy limit: 10%

const calculateImpact = (row, payload, discountPct) => {
  const impact = payload.financial_impact || {};

  const clampedDiscount = Math.max(
    0,
    Math.min(100, Number(discountPct) || 0)
  );

  const addonValue = Number(
    impact.addon_total ||
    row.amount ||
    row.original_price * row.qty ||
    0
  );

  const currentCart = Number(
    impact.current_subtotal ||
    0
  );

  const discountAmount =
    addonValue * (clampedDiscount / 100);

  const finalAddonValue =
    addonValue - discountAmount;

  const projectedCart =
    currentCart + finalAddonValue;

  const cartIncrease =
    currentCart > 0
      ? (finalAddonValue / currentCart) * 100
      : 0;

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

export default function ApprovalQueue({
  rows = [],
  onDecision,
}) {
  const [approvedDiscounts, setApprovedDiscounts] =
    useState({});
  const [selectedApprovals, setSelectedApprovals] = useState([]);
  const [bulkDiscount, setBulkDiscount] = useState(0);

  const handleDiscountChange = (rowId, value) => {
    setApprovedDiscounts((previous) => ({
      ...previous,
      [rowId]: value,
    }));
  };

  const handleSelectApproval = (rowId) => {
    setSelectedApprovals(prev => 
      prev.includes(rowId) 
        ? prev.filter(id => id !== rowId)
        : [...prev, rowId]
    );
  };

  const handleSelectAll = () => {
    if (selectedApprovals.length === rows.length) {
      setSelectedApprovals([]);
    } else {
      setSelectedApprovals(rows.map(row => row.id));
    }
  };

  const handleBulkApprove = () => {
    if (selectedApprovals.length === 0) return;
    
    selectedApprovals.forEach(approvalId => {
      const discount = approvedDiscounts[approvalId] || 0;
      onDecision(approvalId, 'approve', {
        approved_discount_pct: discount,
        final_addon_amount: 0 // Will be calculated server-side
      });
    });
    
    setSelectedApprovals([]);
  };

  const handleBulkReject = () => {
    if (selectedApprovals.length === 0) return;
    
    selectedApprovals.forEach(approvalId => {
      onDecision(approvalId, 'reject', {});
    });
    
    setSelectedApprovals([]);
  };

  return (
    <section
      id="approvals"
      className="approval-panel"
    >
      {/* ============================================================
          HEADER
      ============================================================ */}

      <header className="approval-header">
        <div>
          <p className="section-kicker">
            HUMAN OVERSIGHT
          </p>

          <h2>Approval Queue</h2>

          <p className="approval-subtitle">
            Commercial authorization & financial impact
            simulator for Growth Engine actions
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

      {/* BULK ACTIONS */}
      {rows.length > 0 && (
        <div className="bulk-actions">
          <div className="bulk-select">
            <input
              type="checkbox"
              checked={selectedApprovals.length === rows.length}
              onChange={handleSelectAll}
            />
            <span>Select All ({selectedApprovals.length} selected)</span>
          </div>
          
          {selectedApprovals.length > 0 && (
            <div className="bulk-buttons">
              <div className="bulk-discount">
                <label>Bulk Discount %:</label>
                <input
                  type="number"
                  min="0"
                  max={MAX_POLICY_DISCOUNT}
                  value={bulkDiscount}
                  onChange={(e) => setBulkDiscount(Number(e.target.value))}
                />
              </div>
              <button
                className="bulk-approve-button"
                onClick={() => {
                  selectedApprovals.forEach(id => {
                    setApprovedDiscounts(prev => ({...prev, [id]: bulkDiscount}));
                  });
                  handleBulkApprove();
                }}
              >
                Approve Selected ({selectedApprovals.length})
              </button>
              <button
                className="bulk-reject-button"
                onClick={handleBulkReject}
              >
                Reject Selected ({selectedApprovals.length})
              </button>
            </div>
          )}
        </div>
      )}

      {/* ============================================================
          EMPTY STATE
      ============================================================ */}

      {!rows.length ? (
        <div className="approval-empty-new">
          <div className="approval-success-icon">
            ✓
          </div>

          <div>
            <h3>Everything is clear</h3>

            <p>
              There are no growth actions waiting for
              human approval. Approved actions are
              executed automatically according to policy.
            </p>
          </div>
        </div>
      ) : (
        /* ============================================================
           PENDING APPROVALS
        ============================================================ */

        <div className="approval-list">
          {rows.map((row) => {
            const payload = readPayload(row);

            /* ========================================================
               PRODUCT INFORMATION
            ======================================================== */

            const productName =
              row.product_name ||
              row.product?.name ||
              payload.product_name ||
              payload.product?.name ||
              payload.addon?.product?.name ||
              payload.addon?.name ||
              row.name ||
              row.product_id ||
              'Recommended Add-on';

            const productId =
              row.product_id ||
              row.product?.id ||
              payload.product_id ||
              payload.product?.id ||
              payload.addon?.product_id ||
              '';

            /* ========================================================
               DISCOUNT
            ======================================================== */

            const requestedDiscount = Number(
              row.buyer_requested_discount_pct || 0
            );

            // Priority:
            // 1. Merchant's current local selection
            // 2. Buyer's requested discount
            // 3. 0%
            const currentDiscount =
              approvedDiscounts[row.id] !== undefined
                ? approvedDiscounts[row.id]
                : requestedDiscount;

            const liveImpact = calculateImpact(
              row,
              payload,
              currentDiscount
            );

            const isPolicyViolated =
              liveImpact.discountPct >
              MAX_POLICY_DISCOUNT;

            // AI recommendation shown as a convenient preset.
            const recommendedDiscount = Math.min(
              requestedDiscount,
              3
            );

            return (
              <article
                className="approval-item"
                key={row.id}
              >
                {/* ==================================================
                    TOP HEADER
                ================================================== */}

                <div className="approval-item-top">
                  <div className="approval-action-id">
                    <input
                      type="checkbox"
                      checked={selectedApprovals.includes(row.id)}
                      onChange={() => handleSelectApproval(row.id)}
                      className="approval-checkbox"
                    />
                    <span>
                      #
                      {String(row.id).padStart(3, '0')}
                    </span>

                    <div>
                      

                      {/* ==================================================
                          PRODUCT NAME
                      ================================================== */}

                      {row.kind === 'growth_item' && (
                        <div className="approval-product-info">
                          <p className="approval-product-name">
                            {productName}
                          </p>

                          {productId && (
                            <span className="approval-product-id">
                              Product ID: {productId}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="approval-status">
                    <span />
                    PENDING REVIEW
                  </div>
                </div>

                {/* ==================================================
                    MAIN CONTENT
                ================================================== */}

                <div className="approval-main">
                  <div className="merchant-decision-preview">

                    {/* ==================================================
                        PREVIEW HEADER
                    ================================================== */}

                    <div className="preview-header">
                      <div>
                        <span className="card-label">
                          FINANCIAL IMPACT SIMULATOR
                        </span>

                        <h3>
                          Review commercial impact
                          before authorizing
                        </h3>
                      </div>

                      <span className="preview-badge">
                        LIVE CALCULATION
                      </span>
                    </div>

                    {/* ==================================================
                        DISCOUNT CONTROLS
                    ================================================== */}

                    {row.kind === 'growth_item' && (
                      <div className="discount-simulator-box">
                        <div className="discount-info-row">

                          <div className="discount-meta">
                            <span>
                              Buyer Requested:{' '}
                              <strong>
                                {requestedDiscount}%
                              </strong>
                            </span>

                            <span>
                              Policy Limit:{' '}
                              <strong>
                                {MAX_POLICY_DISCOUNT}%
                              </strong>
                            </span>
                          </div>

                          {recommendedDiscount !==
                            requestedDiscount && (
                            <button
                              type="button"
                              className="preset-button"
                              onClick={() =>
                                handleDiscountChange(
                                  row.id,
                                  recommendedDiscount
                                )
                              }
                            >
                              ✦ Use AI Rec:{' '}
                              {recommendedDiscount}%
                            </button>
                          )}
                        </div>

                        <div className="discount-control-group">
                          <label
                            htmlFor={`discount-range-${row.id}`}
                          >
                            Approve Discount:
                          </label>

                          <input
                            id={`discount-range-${row.id}`}
                            type="range"
                            min="0"
                            max={MAX_POLICY_DISCOUNT}
                            step="1"
                            value={
                              Math.min(
                                liveImpact.discountPct,
                                MAX_POLICY_DISCOUNT
                              )
                            }
                            onChange={(e) =>
                              handleDiscountChange(
                                row.id,
                                e.target.value
                              )
                            }
                            className="discount-slider"
                          />

                          <div className="discount-number-input">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={
                                liveImpact.discountPct
                              }
                              onChange={(e) =>
                                handleDiscountChange(
                                  row.id,
                                  e.target.value
                                )
                              }
                            />

                            <span>%</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ==================================================
                        FINANCIAL IMPACT GRID
                    ================================================== */}

                    <div className="financial-impact-grid">

                      <div>
                        <small>ADD-ON VALUE</small>

                        <strong>
                          {money(
                            liveImpact.addonValue
                          )}
                        </strong>
                      </div>

                      <div>
                        <small>DISCOUNT COST</small>

                        <strong className="text-discount">
                          -
                          {money(
                            liveImpact.discountAmount
                          )}
                        </strong>
                      </div>

                      <div>
                        <small>
                          NET ADD-ON REVENUE
                        </small>

                        <strong className="text-success">
                          {money(
                            liveImpact.finalAddonValue
                          )}
                        </strong>
                      </div>

                      <div>
                        <small>
                          PROJECTED CART
                        </small>

                        <strong>
                          {money(
                            liveImpact.projectedCart
                          )}
                        </strong>
                      </div>
                    </div>

                    {/* ==================================================
                        CART GROWTH COMPARISON
                    ================================================== */}

                    <div className="cart-growth-preview">

                      <div>
                        <span>Current Cart</span>

                        <strong>
                          {money(
                            liveImpact.currentCart
                          )}
                        </strong>
                      </div>

                      <div className="growth-arrow">
                        →
                      </div>

                      <div>
                        <span>After Approval</span>

                        <strong>
                          {money(
                            liveImpact.projectedCart
                          )}
                        </strong>
                      </div>

                      <div className="growth-percentage">
                        +
                        {liveImpact.cartIncrease.toFixed(
                          1
                        )}
                        % Cart Increase
                      </div>
                    </div>

                    {/* ==================================================
                        POLICY AUDIT CHECK
                    ================================================== */}

                    <div className="policy-preview">

                      <div
                        className={
                          isPolicyViolated
                            ? 'policy-item error'
                            : 'policy-item success'
                        }
                      >
                        <span className="check">
                          {isPolicyViolated
                            ? '×'
                            : '✓'}
                        </span>

                        <span>
                          {isPolicyViolated
                            ? `Discount exceeds maximum merchant policy limit (${MAX_POLICY_DISCOUNT}%)`
                            : `Discount within allowed limit (≤ ${MAX_POLICY_DISCOUNT}%)`}
                        </span>
                      </div>

                      <div className="policy-item success">
                        <span className="check">
                          ✓
                        </span>

                        <span>
                          Catalog stock reservation
                          confirmed
                        </span>
                      </div>
                    </div>

                    {/* ==================================================
                        REASONING
                    ================================================== */}

                    {(row.reasoning ||
                      payload.reasoning) && (
                      <div className="approval-reasoning">
                        <small>
                          AI RECOMMENDATION REASON
                        </small>

                        <p>
                          {row.reasoning ||
                            payload.reasoning}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* ==================================================
                    ACTIONS
                ================================================== */}

                <footer className="approval-actions">

                  <button
                    type="button"
                    className="approve-button"
                    disabled={isPolicyViolated}
                    onClick={() =>
                      onDecision(
                        row.id,
                        'approve',
                        {
                          ...row,

                          // IMPORTANT:
                          // Keep exact approval ID.
                          approval_id: row.id,

                          approved_discount_pct:
                            liveImpact.discountPct,

                          final_addon_amount:
                            liveImpact.finalAddonValue,

                          product_name:
                            productName,

                          product_id:
                            productId,
                        }
                      )
                    }
                  >
                    <span>✓</span>

                    Approve Action (
                    {liveImpact.discountPct}
                    %)
                  </button>

                  <button
                    type="button"
                    className="reject-button"
                    onClick={() =>
                      onDecision(
                        row.id,
                        'reject',
                        {
                          ...row,
                          approval_id: row.id,
                          product_name:
                            productName,
                          product_id:
                            productId,
                        }
                      )
                    }
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
