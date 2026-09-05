import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Reviews({ cartId, orders = [] }) {
  const [reviews, setReviews] = useState([]);
  const [reviewableProducts, setReviewableProducts] = useState([]);

  const [loading, setLoading] = useState(true);
  const [reviewableLoading, setReviewableLoading] = useState(false);

  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ============================================================
  // LOAD REVIEWS
  // ============================================================
  const loadReviews = async () => {
    if (!cartId) {
      setReviews([]);
      return;
    }

    try {
      setLoading(true);

      const data = await api(
        `/api/reviews/customer/${cartId}`
      );

      setReviews(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load reviews:', err);
      setReviews([]);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // LOAD REVIEWABLE PRODUCTS
  // ============================================================
  const loadReviewableProducts = async () => {
    if (!cartId) {
      setReviewableProducts([]);
      return;
    }

    try {
      setReviewableLoading(true);

      console.log('Reviews cartId:', cartId);
      console.log('Reviews orders:', orders);

      const data = await api(
        `/api/reviews/reviewable/${cartId}`
      );

      console.log('Backend reviewable products:', data);

      const products = Array.isArray(data) ? data : [];

      /*
       * Products that the customer has already reviewed.
       */
      const reviewedProductIds = new Set(
        reviews.map((review) => String(review.product_id))
      );

      /*
       * Remove already-reviewed products.
       */
      const available = products.filter(
        (item) =>
          !reviewedProductIds.has(
            String(item.product_id)
          )
      );

      console.log('Available for review:', available);

      setReviewableProducts(available);
    } catch (err) {
      console.error(
        'Failed to load reviewable products:',
        err
      );

      setReviewableProducts([]);
    } finally {
      setReviewableLoading(false);
    }
  };

  // ============================================================
  // LOAD EVERYTHING
  // ============================================================
  useEffect(() => {
    if (!cartId) {
      setLoading(false);
      return;
    }

    loadReviews();
  }, [cartId]);

  /*
   * Load reviewable products after reviews are loaded.
   */
  useEffect(() => {
    if (!cartId) return;

    loadReviewableProducts();
  }, [cartId, reviews]);

  // ============================================================
  // SUBMIT REVIEW
  // ============================================================
  const handleSubmitReview = async () => {
    if (!selectedOrder || !selectedProduct) {
      alert('Please select a product to review.');
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        order_id: selectedOrder.order_id,
        product_id: selectedProduct.product_id,
        customer_id: cartId,
        rating: Number(rating),
        review_text: reviewText.trim()
      };

      console.log('Submitting review:', payload);

      await api('/api/reviews', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      alert('Review submitted successfully!');

      // Close modal
      setShowReviewModal(false);

      // Reset form
      setSelectedOrder(null);
      setSelectedProduct(null);
      setReviewText('');
      setRating(5);

      // Reload reviews
      await loadReviews();
    } catch (err) {
      console.error('Failed to submit review:', err);

      alert(
        err?.message ||
        'Failed to submit review. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // WRITE REVIEW
  // ============================================================
  const handleWriteReview = async () => {
    /*
     * If products haven't loaded yet, load them first.
     */
    let products = reviewableProducts;

    if (products.length === 0) {
      await loadReviewableProducts();

      /*
       * State updates are asynchronous, so we cannot immediately
       * rely on reviewableProducts after calling the function.
       *
       * Fetch directly here instead.
       */
      try {
        setReviewableLoading(true);

        const data = await api(
          `/api/reviews/reviewable/${cartId}`
        );

        const allProducts = Array.isArray(data)
          ? data
          : [];

        const reviewedProductIds = new Set(
          reviews.map((review) =>
            String(review.product_id)
          )
        );

        products = allProducts.filter(
          (item) =>
            !reviewedProductIds.has(
              String(item.product_id)
            )
        );

        setReviewableProducts(products);
      } catch (err) {
        console.error(
          'Failed to fetch reviewable products:',
          err
        );

        products = [];
      } finally {
        setReviewableLoading(false);
      }
    }

    console.log(
      'Products available for review:',
      products
    );

    if (products.length === 0) {
      alert(
        'No items available for review. You can review products from your paid orders.'
      );
      return;
    }

    /*
     * Pick the first purchased product.
     */
    const product = products[0];

    setSelectedOrder(product);
    setSelectedProduct(product);
    setRating(5);
    setReviewText('');
    setShowReviewModal(true);
  };

  // ============================================================
  // STAR RATING
  // ============================================================
  const getStarRating = (rating) => {
    const value = Number(rating) || 0;

    return (
      '★'.repeat(value) +
      '☆'.repeat(5 - value)
    );
  };

  // ============================================================
  // LOADING
  // ============================================================
  if (loading) {
    return (
      <div className="reviews">
        <div className="reviews-loading">
          <div className="wishlist-spinner"></div>
          <p>Loading your reviews...</p>
        </div>
      </div>
    );
  }

  // ============================================================
  // UI
  // ============================================================
  return (
    <div className="reviews">

      {/* ======================================================
          HEADER
      ====================================================== */}
      <div className="section-header">
        <div>
          <h2>My Reviews</h2>

          <p>
            Review products you have purchased.
          </p>
        </div>

        <button
          onClick={handleWriteReview}
          className="primary-button"
          disabled={reviewableLoading}
        >
          {reviewableLoading
            ? 'Loading...'
            : 'Write a Review'}
        </button>
      </div>

      {/* ======================================================
          REVIEW MODAL
      ====================================================== */}
      {showReviewModal && (
        <div
          className="modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowReviewModal(false);
            }
          }}
        >
          <div className="modal-content">

            <h3>Write a Review</h3>

            <p>
              Reviewing:{' '}
              <strong>
                {selectedProduct?.product_name ||
                  'Product'}
              </strong>
            </p>

            {selectedProduct?.order_number && (
              <p>
                Order #{selectedProduct.order_number}
              </p>
            )}

            {/* RATING */}
            <div className="rating-input">
              <label>Rating:</label>

              <select
                value={rating}
                onChange={(e) =>
                  setRating(
                    Number(e.target.value)
                  )
                }
              >
                {[1, 2, 3, 4, 5].map((star) => (
                  <option
                    key={star}
                    value={star}
                  >
                    {getStarRating(star)}
                  </option>
                ))}
              </select>
            </div>

            {/* REVIEW TEXT */}
            <textarea
              value={reviewText}
              onChange={(e) =>
                setReviewText(e.target.value)
              }
              placeholder="Share your experience (optional)"
              className="textarea-field"
              maxLength={1000}
            />

            <div className="modal-actions">

              <button
                onClick={() => {
                  setShowReviewModal(false);
                  setSelectedOrder(null);
                  setSelectedProduct(null);
                }}
                disabled={submitting}
              >
                Cancel
              </button>

              <button
                onClick={handleSubmitReview}
                className="primary-button"
                disabled={submitting}
              >
                {submitting
                  ? 'Submitting...'
                  : 'Submit Review'}
              </button>

            </div>
          </div>
        </div>
      )}

      {/* ======================================================
          EXISTING REVIEWS
      ====================================================== */}
      {reviews.length === 0 ? (
        <div className="empty-state">
          <p>
            You haven't written any reviews yet.
          </p>

          <p>
            Review products you've purchased!
          </p>
        </div>
      ) : (
        <div className="reviews-list">

          {reviews.map((review) => (
            <div
              key={review.id}
              className="review-card"
            >

              <div className="review-header">

                <h3>
                  {review.product_name}
                </h3>

                <span className="review-rating">
                  {getStarRating(review.rating)}
                </span>

              </div>

              <p className="review-text">
                {review.review_text ||
                  'No review text provided'}
              </p>

              <p className="review-date">
                Order #{review.order_number}
                {' • '}
                {new Date(
                  review.created_at
                ).toLocaleDateString()}
              </p>

            </div>
          ))}

        </div>
      )}

    </div>
  );
}