export default function RecommendationReason({ addon, cartItems = [] }) {
  const related = cartItems.find((item) => item.category && addon.product?.category && item.category === addon.product.category);
  return (
    <details className="recommendation-reason">
      <summary>Why this product?</summary>
      <div>
        <p>{addon.reasoning || `Complements ${related?.name || 'the products already in your cart'}.`}</p>
        <ul>
          <li>✓ {related ? `Related to ${related.name}` : 'Complements the current cart'}</li>
          <li>✓ {addon.product?.stock || 0} available in stock</li>
          <li>✓ Product and price verified by the merchant backend</li>
        </ul>
      </div>
    </details>
  );
}
