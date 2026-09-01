import { useState } from 'react';
import { api } from '../api';

const emptyProduct = {
  name: '',
  description: '',
  category: 'Cookware',
  price: '',
  stock: 0,
  active: true,
  ai_buyer_enabled: true,
  growth_agent_enabled: true,
  max_ai_discount_pct: 10,
  max_recommended_qty: 1,
  image_url: '',
};

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

export default function MerchantCatalog({ products = [], onRefresh }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyProduct);
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const openForm = (product = null) => {
    setEditing(product?.id || null);
    setForm(product ? { ...emptyProduct, ...product } : emptyProduct);
    setError('');
    setIsOpen(true);
  };

  const closeForm = () => {
    setEditing(null);
    setForm(emptyProduct);
    setIsOpen(false);
    setError('');
  };

  const update = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));

  const save = async (event) => {
    event.preventDefault();
    if (
      !form.name.trim() ||
      !form.category.trim() ||
      Number(form.price) <= 0 ||
      Number(form.stock) < 0 ||
      Number(form.max_ai_discount_pct) < 0 ||
      Number(form.max_ai_discount_pct) > 100 ||
      Number(form.max_recommended_qty) < 1
    ) {
      setError('Enter a valid name, category, price, stock, discount, and quantity limit.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await api(editing ? `/api/merchant/catalog/${editing}` : '/api/merchant/catalog', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...form,
          price: Number(form.price),
          stock: Number(form.stock),
          max_ai_discount_pct: Number(form.max_ai_discount_pct),
          max_recommended_qty: Number(form.max_recommended_qty),
        }),
      });
      closeForm();
      await onRefresh();
    } catch (e) {
      setError(e.message || 'Unable to save product.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async (id) => {
    setBusy(true);
    try {
      await api(`/api/merchant/catalog/${id}`, { method: 'DELETE' });
      await onRefresh();
    } catch (e) {
      setError(e.message || 'Unable to disable product.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="merchant-catalog-page">
      <header className="merchant-catalog-header">
        <div>
          <p className="section-kicker">MERCHANT CONSOLE</p>
          <h2>PRODUCT CATALOG</h2>
          <p>Manage products, inventory, pricing and AI selling permissions.</p>
        </div>
        <button className="primary" onClick={() => openForm()}>
          + Add Product
        </button>
      </header>

      {error && !isOpen && <div className="inline-error">{error}</div>}

      <div className="merchant-catalog-list">
        {products.map((product) => (
          <article className="merchant-product-row" key={product.id}>
            <div className="merchant-product-main">
              {product.image_url && <img src={product.image_url} alt="" />}
              <div>
                <h3>{product.name}</h3>
                <p>
                  {product.category} · {product.description}
                </p>
              </div>
            </div>
            <strong>{money(product.price)}</strong>
            <span>{product.stock} in stock</span>
            <span className={product.active ? 'catalog-active' : 'catalog-inactive'}>
              {product.active ? 'ACTIVE' : 'INACTIVE'}
            </span>
            <span>AI Buyer {product.ai_buyer_enabled ? '✓' : '—'}</span>
            <span>Growth Agent {product.growth_agent_enabled ? '✓' : '—'}</span>
            <span>Max discount: {product.max_ai_discount_pct}%</span>
            <div className="merchant-product-actions">
              <button className="secondary" onClick={() => openForm(product)}>
                Edit
              </button>
              {product.active && (
                <button className="secondary" disabled={busy} onClick={() => disable(product.id)}>
                  Disable
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      {isOpen && (
        <div className="catalog-modal-backdrop">
          <form className="catalog-modal" onSubmit={save}>
            <div className="modal-header">
              <div>
                <p className="section-kicker">{editing ? 'EDIT PRODUCT' : 'NEW PRODUCT'}</p>
                <h3>{editing ? 'Update catalog product' : 'Add product'}</h3>
              </div>
              <button type="button" className="icon-button" onClick={closeForm}>
                ×
              </button>
            </div>

            {error && <div className="inline-error">{error}</div>}

            <label>
              Name
              <input value={form.name} onChange={(e) => update('name', e.target.value)} />
            </label>
            <label>
              Description
              <textarea value={form.description} onChange={(e) => update('description', e.target.value)} />
            </label>
            <div className="catalog-form-grid">
              <label>
                Category
                <input value={form.category} onChange={(e) => update('category', e.target.value)} />
              </label>
              <label>
                Price
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => update('price', e.target.value)}
                />
              </label>
              <label>
                Stock
                <input
                  type="number"
                  min="0"
                  value={form.stock}
                  onChange={(e) => update('stock', e.target.value)}
                />
              </label>
              <label>
                Max AI discount %
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={form.max_ai_discount_pct}
                  onChange={(e) => update('max_ai_discount_pct', e.target.value)}
                />
              </label>
              <label>
                Max recommended qty
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={form.max_recommended_qty}
                  onChange={(e) => update('max_recommended_qty', e.target.value)}
                />
              </label>
            </div>
            <label>
              Image URL
              <input value={form.image_url || ''} onChange={(e) => update('image_url', e.target.value)} />
            </label>
            <div className="catalog-toggles">
              <label>
                <input
                  type="checkbox"
                  checked={!!form.ai_buyer_enabled}
                  onChange={(e) => update('ai_buyer_enabled', e.target.checked)}
                />{' '}
                AI Buyer discoverable
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={!!form.growth_agent_enabled}
                  onChange={(e) => update('growth_agent_enabled', e.target.checked)}
                />{' '}
                Growth Agent eligible
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={!!form.active}
                  onChange={(e) => update('active', e.target.checked)}
                />{' '}
                Active
              </label>
            </div>
            <footer>
              <button type="button" className="secondary" onClick={closeForm}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? 'Saving...' : editing ? 'Save Changes' : 'Add Product'}
              </button>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}