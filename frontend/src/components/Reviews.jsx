import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Reviews({ cartId, orders }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');

  useEffect(() => {
    loadReviews();
  }, [cartId]);

  const loadReviews = async () => {
    try {
      setLoading(true);
      const data = await api(`/api/reviews/customer/${cartId}`);
      setReviews(data);
    } catch (err) {
      console.error('Failed to load reviews:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!selectedOrder || !selectedProduct) return;

    try {
      await api('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          order_id: selectedOrder.id,
          product_id: selectedProduct.product_id,
          customer_id: cartId,
          rating,
          review_text: reviewText
        })
      });
      setShowReviewModal(false);
      setReviewText('');
      setRating(5);
      loadReviews();
    } catch (err) {
      console.error('Failed to submit review:', err);
      alert('Failed to submit review');
    }
  };

  const getStarRating = (rating) => {
    return '★'.repeat(rating) + '☆'.repeat(5 - rating);
  };

  // Get products from paid orders that haven't been reviewed yet
  const getReviewableProducts = () => {
    const reviewable = [];
    const reviewedProductIds = new Set(reviews.map(r => r.product_id));
    
    orders.filter(order => order.status === 'PAID').forEach(order => {
      // In a real app, you'd fetch order items. For now, we'll just use the order itself
      if (!reviewedProductIds.has(order.id)) {
        reviewable.push({
          order_id: order.id,
          product_id: order.id, // Using order.id as placeholder
          product_name: `Order #${order.order_number}`,
          order_number: order.order_number
        });
      }
    });
    
    return reviewable;
  };

  if (loading) {
    return <div className="reviews">Loading...</div>;
  }

  return (
    <div className="reviews">
      <div className="section-header">
        <h2>My Reviews</h2>
        <button
          onClick={() => {
            const reviewable = getReviewableProducts();
            if (reviewable.length > 0) {
              setSelectedOrder(reviewable[0]);
              setSelectedProduct(reviewable[0]);
              setShowReviewModal(true);
            } else {
              alert('No items available for review');
            }
          }}
          className="primary-button"
        >
          Write a Review
        </button>
      </div>

      {showReviewModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>Write a Review</h3>
            <p>Reviewing: {selectedProduct?.product_name}</p>
            
            <div className="rating-input">
              <label>Rating:</label>
              <select value={rating} onChange={(e) => setRating(parseInt(e.target.value))}>
                {[1, 2, 3, 4, 5].map(star => (
                  <option key={star} value={star}>{getStarRating(star)}</option>
                ))}
              </select>
            </div>
            
            <textarea
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="Share your experience (optional)"
              className="textarea-field"
              maxLength="1000"
            />
            
            <div className="modal-actions">
              <button onClick={() => setShowReviewModal(false)}>Cancel</button>
              <button onClick={handleSubmitReview} className="primary-button">Submit Review</button>
            </div>
          </div>
        </div>
      )}

      {reviews.length === 0 ? (
        <div className="empty-state">
          <p>You haven't written any reviews yet. Review products you've purchased!</p>
        </div>
      ) : (
        <div className="reviews-list">
          {reviews.map((review) => (
            <div key={review.id} className="review-card">
              <div className="review-header">
                <h3>{review.product_name}</h3>
                <span className="review-rating">{getStarRating(review.rating)}</span>
              </div>
              <p className="review-text">{review.review_text || 'No review text provided'}</p>
              <p className="review-date">
                Order #{review.order_number} • {new Date(review.created_at).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}