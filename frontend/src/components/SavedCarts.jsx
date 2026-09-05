import { useState, useEffect } from 'react';
import { api } from '../api';

const money = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function SavedCarts({ cartId }) {
  const [savedCarts, setSavedCarts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [cartName, setCartName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSavedCarts();
  }, [cartId]);

  const loadSavedCarts = async () => {
    try {
      setLoading(true);

      const data = await api(`/api/saved-carts/${cartId}`);

      setSavedCarts(data);
    } catch (err) {
      console.error('Failed to load saved carts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCart = async () => {
    if (!cartName.trim() || saving) return;

    try {
      setSaving(true);

      await api('/api/saved-carts', {
        method: 'POST',
        body: JSON.stringify({
          cart_id: cartId,
          name: cartName.trim(),
        }),
      });

      setCartName('');
      setShowSaveModal(false);

      await loadSavedCarts();
    } catch (err) {
      console.error('Failed to save cart:', err);
      alert('Failed to save cart');
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreCart = async (savedCartId) => {
    if (!confirm('This will replace your current cart. Continue?')) {
      return;
    }

    try {
      await api(`/api/saved-carts/${savedCartId}/restore`, {
        method: 'POST',
        body: JSON.stringify({
          target_cart_id: cartId,
        }),
      });

      window.location.reload();
    } catch (err) {
      console.error('Failed to restore cart:', err);
      alert('Failed to restore cart');
    }
  };

  const handleDeleteCart = async (savedCartId) => {
    if (!confirm('Delete this saved cart?')) {
      return;
    }

    try {
      await api(`/api/saved-carts/${savedCartId}`, {
        method: 'DELETE',
      });

      await loadSavedCarts();
    } catch (err) {
      console.error('Failed to delete cart:', err);
      alert('Failed to delete cart');
    }
  };

  if (loading) {
    return (
      <div className="saved-carts">
        <div className="section-header">
          <div>
            <h2>Saved Carts</h2>
            <p>
              Save your favorite carts and restore them anytime
            </p>
          </div>
        </div>

        <div className="saved-cart-loading">
          <div className="loading-spinner"></div>
          <span>Loading saved carts...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="saved-carts">

      {/* =========================================
          HEADER
      ========================================= */}

      <div className="section-header">
        <div>
          <h2>Saved Carts</h2>
          <p>
            Save your favorite carts and restore them anytime
          </p>
        </div>

        <button
          onClick={() => setShowSaveModal(true)}
          className="save-cart-button"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>

          Save Current Cart
        </button>
      </div>

      {/* =========================================
          SAVE MODAL
      ========================================= */}

      {showSaveModal && (
        <div
          className="saved-cart-modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShowSaveModal(false);
            }
          }}
        >
          <div className="saved-cart-modal">

            <div className="modal-header">
              <div className="modal-title-wrapper">

                <div className="modal-icon">
                  <svg
                    width="21"
                    height="21"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path d="M6 3h12v18H6z" />
                    <path d="M9 7h6" />
                    <path d="M9 11h6" />
                  </svg>
                </div>

                <div>
                  <h3>Save Current Cart</h3>
                  <p>
                    Give your cart a name so you can find it later.
                  </p>
                </div>

              </div>

              <button
                className="modal-close"
                onClick={() => setShowSaveModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="modal-body">

              <label className="modal-label">
                Cart Name
              </label>

              <input
                type="text"
                value={cartName}
                onChange={(e) => setCartName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveCart();
                  }
                }}
                placeholder="e.g. Kitchen Essentials"
                className="cart-name-input"
                autoFocus
                maxLength={80}
              />

              <p className="input-hint">
                Choose a memorable name for this cart.
              </p>

            </div>

            <div className="modal-actions">

              <button
                onClick={() => {
                  setCartName('');
                  setShowSaveModal(false);
                }}
                className="modal-cancel-button"
              >
                Cancel
              </button>

              <button
                onClick={handleSaveCart}
                className="modal-save-button"
                disabled={!cartName.trim() || saving}
              >
                {saving ? (
                  <>
                    <span className="button-spinner"></span>
                    Saving...
                  </>
                ) : (
                  <>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M5 12l4 4L19 6" />
                    </svg>
                    Save Cart
                  </>
                )}
              </button>

            </div>

          </div>
        </div>
      )}

      {/* =========================================
          EMPTY STATE
      ========================================= */}

      {savedCarts.length === 0 ? (
        <div className="saved-carts-empty">

          <div className="saved-cart-empty-icon">
            <svg
              width="42"
              height="42"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="9" cy="20" r="1" />
              <circle cx="19" cy="20" r="1" />
              <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 1.9-1.4L21 8H6" />
              <path d="M12 5v6" />
              <path d="M9 8h6" />
            </svg>
          </div>

          <h3>No saved carts yet</h3>

          <p>
            Save your current cart to quickly restore it
            whenever you need it.
          </p>

          <button
            className="empty-save-button"
            onClick={() => setShowSaveModal(true)}
          >
            Save Current Cart
          </button>

        </div>
      ) : (

        /* =========================================
           SAVED CART LIST
        ========================================= */

        <div className="saved-carts-list">

          {savedCarts.map((savedCart) => (
            <div
              key={savedCart.id}
              className="saved-cart-card"
            >

              <div className="saved-cart-main">

                <div className="saved-cart-icon">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  >
                    <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 1.9-1.4L21 8H6" />
                    <circle cx="9" cy="20" r="1" />
                    <circle cx="19" cy="20" r="1" />
                  </svg>
                </div>

                <div className="saved-cart-info">

                  <h3>{savedCart.name}</h3>

                  <div className="saved-cart-meta">

                    <span>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <path d="M6 3h12v18H6z" />
                        <path d="M9 7h6M9 11h6M9 15h4" />
                      </svg>

                      {savedCart.item_count || 0}{' '}
                      {savedCart.item_count === 1
                        ? 'item'
                        : 'items'}
                    </span>

                    <span className="meta-separator">•</span>

                    <span>
                      {new Date(
                        savedCart.created_at
                      ).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>

                  </div>

                </div>

              </div>

              <div className="saved-cart-actions">

                <button
                  onClick={() =>
                    handleRestoreCart(savedCart.id)
                  }
                  className="restore-button"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M3 12a9 9 0 1 0 3-6.7" />
                    <path d="M3 4v6h6" />
                  </svg>

                  Restore
                </button>

                <button
                  onClick={() =>
                    handleDeleteCart(savedCart.id)
                  }
                  className="delete-button"
                  title="Delete saved cart"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M4 7h16" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M6 7l1 14h10l1-14" />
                    <path d="M9 7V4h6v3" />
                  </svg>

                  Delete
                </button>

              </div>

            </div>
          ))}

        </div>
      )}

    </div>
  );
}
