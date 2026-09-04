import { useState, useEffect } from 'react';
import { api } from '../api';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function SavedCarts({ cartId }) {
  const [savedCarts, setSavedCarts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [cartName, setCartName] = useState('');

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
    if (!cartName.trim()) return;
    
    try {
      await api('/api/saved-carts', {
        method: 'POST',
        body: JSON.stringify({ cart_id: cartId, name: cartName })
      });
      setCartName('');
      setShowSaveModal(false);
      loadSavedCarts();
    } catch (err) {
      console.error('Failed to save cart:', err);
      alert('Failed to save cart');
    }
  };

  const handleRestoreCart = async (savedCartId) => {
    if (!confirm('This will replace your current cart. Continue?')) return;
    
    try {
      await api(`/api/saved-carts/${savedCartId}/restore`, {
        method: 'POST',
        body: JSON.stringify({ target_cart_id: cartId })
      });
      window.location.reload(); // Refresh to show updated cart
    } catch (err) {
      console.error('Failed to restore cart:', err);
      alert('Failed to restore cart');
    }
  };

  const handleDeleteCart = async (savedCartId) => {
    if (!confirm('Delete this saved cart?')) return;
    
    try {
      await api(`/api/saved-carts/${savedCartId}`, { method: 'DELETE' });
      loadSavedCarts();
    } catch (err) {
      console.error('Failed to delete cart:', err);
      alert('Failed to delete cart');
    }
  };

  if (loading) {
    return <div className="saved-carts">Loading...</div>;
  }

  return (
    <div className="saved-carts">
      <div className="section-header">
        <h2>Saved Carts</h2>
        <button
          onClick={() => setShowSaveModal(true)}
          className="primary-button"
        >
          Save Current Cart
        </button>
      </div>

      {showSaveModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>Save Current Cart</h3>
            <input
              type="text"
              value={cartName}
              onChange={(e) => setCartName(e.target.value)}
              placeholder="Cart name (e.g., 'Kitchen Essentials')"
              className="input-field"
            />
            <div className="modal-actions">
              <button onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button onClick={handleSaveCart} className="primary-button">Save</button>
            </div>
          </div>
        </div>
      )}

      {savedCarts.length === 0 ? (
        <div className="empty-state">
          <p>No saved carts yet. Save your current cart to access it later.</p>
        </div>
      ) : (
        <div className="saved-carts-list">
          {savedCarts.map((savedCart) => (
            <div key={savedCart.id} className="saved-cart-card">
              <div className="saved-cart-info">
                <h3>{savedCart.name}</h3>
                <p>{savedCart.item_count} items</p>
                <p className="saved-cart-date">
                  {new Date(savedCart.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="saved-cart-actions">
                <button
                  onClick={() => handleRestoreCart(savedCart.id)}
                  className="restore-button"
                >
                  Restore
                </button>
                <button
                  onClick={() => handleDeleteCart(savedCart.id)}
                  className="delete-button"
                >
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