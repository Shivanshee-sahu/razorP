import { useState, useEffect } from 'react';
import { api } from '../api';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function Wishlist({ cartId, catalog }) {
  const [wishlist, setWishlist] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWishlist();
  }, [cartId]);

  const loadWishlist = async () => {
    try {
      setLoading(true);
      const data = await api(`/api/wishlist/${cartId}`);
      setWishlist(data);
    } catch (err) {
      console.error('Failed to load wishlist:', err);
    } finally {
      setLoading(false);
    }
  };

  const addToWishlist = async (productId) => {
    try {
      await api('/api/wishlist', {
        method: 'POST',
        body: JSON.stringify({ cart_id: cartId, product_id: productId })
      });
      loadWishlist();
    } catch (err) {
      console.error('Failed to add to wishlist:', err);
    }
  };

  const removeFromWishlist = async (productId) => {
    try {
      await api(`/api/wishlist/${cartId}/${productId}`, { method: 'DELETE' });
      loadWishlist();
    } catch (err) {
      console.error('Failed to remove from wishlist:', err);
    }
  };

  const moveToCart = async (productId) => {
    try {
      await api(`/api/wishlist/${cartId}/${productId}/move-to-cart`, { method: 'POST' });
      loadWishlist();
      window.location.reload(); // Refresh to show updated cart
    } catch (err) {
      console.error('Failed to move to cart:', err);
      alert('Failed to move item to cart');
    }
  };

  const isInWishlist = (productId) => {
    return wishlist.some(item => item.product_id === productId);
  };

  if (loading) {
    return <div className="wishlist">Loading...</div>;
  }

  return (
    <div className="wishlist">
      <div className="section-header">
        <h2>Wishlist</h2>
        <p className="section-subtitle">{wishlist.length} items</p>
      </div>

      {wishlist.length === 0 ? (
        <div className="empty-state">
          <p>Your wishlist is empty. Add products you love to see them here.</p>
        </div>
      ) : (
        <div className="wishlist-grid">
          {wishlist.map((item) => (
            <div key={item.id} className="wishlist-item">
              <div className="wishlist-item-image">
                {item.image_url && <img src={item.image_url} alt={item.name} />}
              </div>
              <div className="wishlist-item-details">
                <h3>{item.name}</h3>
                <p className="wishlist-item-price">{money(item.price)}</p>
                <p className="wishlist-item-category">{item.category}</p>
              </div>
              <div className="wishlist-item-actions">
                <button
                  onClick={() => moveToCart(item.product_id)}
                  className="move-to-cart-button"
                >
                  Add to Cart
                </button>
                <button
                  onClick={() => removeFromWishlist(item.product_id)}
                  className="remove-button"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}