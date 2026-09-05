import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

const money = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function Wishlist({ cartId }) {
  const [wishlist, setWishlist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [error, setError] = useState('');

  // ============================================================
  // LOAD WISHLIST
  // ============================================================
  const loadWishlist = useCallback(async () => {
    if (!cartId) {
      setWishlist([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError('');

      const data = await api(`/api/wishlist/${cartId}`);

      setWishlist(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load wishlist:', err);
      setError('Unable to load your wishlist.');
    } finally {
      setLoading(false);
    }
  }, [cartId]);

  // ============================================================
  // LOAD WHEN CART ID CHANGES
  // ============================================================
  useEffect(() => {
    loadWishlist();
  }, [loadWishlist]);

  // ============================================================
  // REMOVE FROM WISHLIST
  // ============================================================
  const removeFromWishlist = async (productId) => {
    if (!cartId) return;

    try {
      setActionLoading(`remove-${productId}`);

      await api(
        `/api/wishlist/${cartId}/${productId}`,
        {
          method: 'DELETE',
        }
      );

      await loadWishlist();
    } catch (err) {
      console.error(
        'Failed to remove from wishlist:',
        err
      );

      setError('Failed to remove item from wishlist.');
    } finally {
      setActionLoading(null);
    }
  };

  // ============================================================
  // MOVE TO CART
  // ============================================================
  const moveToCart = async (productId) => {
    if (!cartId) return;

    try {
      setActionLoading(`cart-${productId}`);
      setError('');

      await api(
        `/api/wishlist/${cartId}/${productId}/move-to-cart`,
        {
          method: 'POST',
        }
      );

      /*
       * Reload wishlist first so the item disappears
       * from the wishlist before refreshing the page.
       */
      await loadWishlist();

      /*
       * Refresh the application so the cart count,
       * cart items, totals, etc. are updated.
       */
      window.location.reload();
    } catch (err) {
      console.error(
        'Failed to move item to cart:',
        err
      );

      setError('Failed to move item to cart.');
      setActionLoading(null);
    }
  };

  // ============================================================
  // LOADING STATE
  // ============================================================
  if (loading) {
    return (
      <div className="wishlist">
        <div className="wishlist-loading">
          <div className="wishlist-spinner"></div>
          <p>Loading your wishlist...</p>
        </div>
      </div>
    );
  }

  // ============================================================
  // MAIN UI
  // ============================================================
  return (
    <div className="wishlist">

      {/* ======================================================
          HEADER
      ====================================================== */}
      <div className="wishlist-header">
        <div>
          <p className="section-kicker">
            YOUR SAVED ITEMS
          </p>

          <h2>Wishlist</h2>

          <p className="wishlist-subtitle">
            Products you've saved for later
          </p>
        </div>

        <div className="wishlist-count">
          <span>{wishlist.length}</span>

          <small>
            {wishlist.length === 1 ? 'item' : 'items'}
          </small>
        </div>
      </div>

      {/* ======================================================
          ERROR
      ====================================================== */}
      {error && (
        <div className="wishlist-error">
          <span>⚠</span>
          <p>{error}</p>

          <button onClick={loadWishlist}>
            Try again
          </button>
        </div>
      )}

      {/* ======================================================
          EMPTY STATE
      ====================================================== */}
      {wishlist.length === 0 ? (
        <div className="wishlist-empty">

          <div className="wishlist-empty-icon">
            <svg
              width="42"
              height="42"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </div>

          <h3>Your wishlist is empty</h3>

          <p>
            Save products you love and come back to them
            whenever you're ready.
          </p>

        </div>
      ) : (

        /* ====================================================
           WISHLIST GRID
        ==================================================== */
        <div className="wishlist-grid">

          {wishlist.map((item) => {

            const removeLoading =
              actionLoading === `remove-${item.product_id}`;

            const cartLoading =
              actionLoading === `cart-${item.product_id}`;

            return (
              <article
                key={item.id}
                className="wishlist-item"
              >

                {/* PRODUCT IMAGE */}
                <div className="wishlist-item-image">

                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.name}
                    />
                  ) : (
                    <div className="wishlist-image-placeholder">
                      <span>♡</span>
                    </div>
                  )}

                  <span className="wishlist-saved-badge">
                    Saved
                  </span>

                </div>

                {/* PRODUCT DETAILS */}
                <div className="wishlist-item-details">

                  {item.category && (
                    <span className="wishlist-item-category">
                      {item.category}
                    </span>
                  )}

                  <h3>{item.name}</h3>

                  <p className="wishlist-item-price">
                    {money(item.price)}
                  </p>

                </div>

                {/* ACTIONS */}
                <div className="wishlist-item-actions">

                  <button
                    type="button"
                    className="move-to-cart-button"
                    onClick={() =>
                      moveToCart(item.product_id)
                    }
                    disabled={
                      actionLoading !== null
                    }
                  >
                    {cartLoading ? (
                      <>
                        <span className="button-spinner"></span>
                        Adding...
                      </>
                    ) : (
                      <>
                        <svg
                          width="17"
                          height="17"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle
                            cx="9"
                            cy="21"
                            r="1"
                          />
                          <circle
                            cx="20"
                            cy="21"
                            r="1"
                          />
                          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                        </svg>

                        Add to Cart
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    className="remove-button"
                    onClick={() =>
                      removeFromWishlist(
                        item.product_id
                      )
                    }
                    disabled={
                      actionLoading !== null
                    }
                  >
                    {removeLoading ? (
                      <span className="button-spinner dark"></span>
                    ) : (
                      'Remove'
                    )}
                  </button>

                </div>

              </article>
            );
          })}

        </div>
      )}

    </div>
  );
}