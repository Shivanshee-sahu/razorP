import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import './styles.css';

import AgentPanel from './components/AgentPanel';
import ApprovalQueue from './components/ApprovalQueue';
import AuditTrail from './components/AuditTrail';
import CheckoutModal from './components/CheckoutModal';

const CART_ID = 'demo-cart';

const money = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN')}`;

const getTotalRevenue = (revenue) => {
  return Number(
    revenue?.total_test_revenue ??
      revenue?.total_revenue ??
      revenue?.revenue ??
      0
  );
};

export default function App() {
  // ============================================================
  // CORE STATE
  // ============================================================

  const [catalog, setCatalog] = useState([]);
  const [cart, setCart] = useState(null);
  const [agent, setAgent] = useState(null);
  const [approvals, setApprovals] = useState([]);

  // ============================================================
  // BACKEND DATA
  // ============================================================

  const [agentCatalog, setAgentCatalog] = useState([]);
  const [policies, setPolicies] = useState(null);
  const [revenue, setRevenue] = useState(null);
  const [orders, setOrders] = useState([]);
  const [buyerResult, setBuyerResult] = useState(null);

  // ============================================================
  // UI STATE
  // ============================================================

  const [checkout, setCheckout] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [buyerLoading, setBuyerLoading] = useState(false);

  const [compact, setCompact] = useState(false);
  const [dark, setDark] = useState(false);
  const [mobile, setMobile] = useState(false);

  const [buyerMessage, setBuyerMessage] = useState('');

  // Products individually added from AI Buyer
  const [buyerAddedProducts, setBuyerAddedProducts] = useState({});

  // ============================================================
  // RECEIPT / FAILURE UI
  // ============================================================

  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [failureLoading, setFailureLoading] = useState(false);
  const [failureResult, setFailureResult] = useState(null);

  // ============================================================
  // ROUTER
  // ============================================================

  const validPages = [
    'dashboard',
    'products',
    'cart',
    'growth-ai',
    'buyer',
    'approvals',
    'orders',
    'revenue',
    'policies',
    'audit',
  ];

  const [activePage, setActivePage] = useState(() => {
    const hash = window.location.hash.replace('#', '');

    return validPages.includes(hash)
      ? hash
      : 'dashboard';
  });

  const navigateTo = (page) => {
    setActivePage(page);
    window.location.hash = page;
    setMobile(false);
  };

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');

      if (validPages.includes(hash)) {
        setActivePage(hash);
      }
    };

    window.addEventListener(
      'hashchange',
      handleHashChange
    );

    return () => {
      window.removeEventListener(
        'hashchange',
        handleHashChange
      );
    };
  }, []);

  // ============================================================
  // LOAD ALL BACKEND DATA
  // ============================================================
const downloadReceipt = async (orderId) => {
  try {
    const response = await fetch(
      `http://127.0.0.1:8000/api/orders/${orderId}/receipt`
    );

    if (!response.ok) {
      throw new Error("Failed to generate receipt");
    }

    const blob = await response.blob();

    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `receipt_${orderId}.pdf`;

    document.body.appendChild(a);
    a.click();

    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Receipt download failed:", error);
    alert("Unable to download receipt.");
  }
};
  const refresh = async () => {
    try {
      const [
        products,
        currentCart,
        pendingApprovals,
        revenueData,
        ordersData,
        policiesData,
        agentCatalogData,
      ] = await Promise.all([
        api('/api/catalog'),
        api(`/api/cart/${CART_ID}`),
        api('/api/approvals'),
        api('/api/revenue'),
        api('/api/orders'),
        api('/api/policies'),
        api('/api/agent/catalog'),
      ]);

      setCatalog(
        Array.isArray(products)
          ? products
          : []
      );

      setCart(currentCart);

      setApprovals(
        Array.isArray(pendingApprovals)
          ? pendingApprovals
          : []
      );

      setRevenue(revenueData);

      setOrders(
        Array.isArray(ordersData)
          ? ordersData
          : ordersData?.orders || []
      );

      setPolicies(policiesData);

      setAgentCatalog(
        Array.isArray(agentCatalogData)
          ? agentCatalogData
          : agentCatalogData?.products || []
      );

      setError('');
    } catch (e) {
      console.error(
        'REFRESH ERROR:',
        e
      );

      setError(
        e.message ||
          'Unable to load application data.'
      );
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // ============================================================
  // THEME
  // ============================================================

  useEffect(() => {
    document.documentElement.dataset.theme =
      dark ? 'dark' : 'light';
  }, [dark]);

  // ============================================================
  // NORMAL CART UPDATE
  // ============================================================

  const update = async (id, qty) => {
    try {
      await api(
        `/api/cart/${CART_ID}/items`,
        {
          method: 'POST',
          body: JSON.stringify({
            product_id: id,
            qty: Math.max(0, qty),
          }),
        }
      );

      await refresh();
    } catch (e) {
      console.error(
        'CART UPDATE ERROR:',
        e
      );

      setError(
        e.message ||
          'Unable to update cart.'
      );
    }
  };

  // ============================================================
  // RUN GROWTH AGENT
  // ============================================================

  const run = async () => {
    setLoading(true);
    setError('');

    try {
      const result = await api(
        '/api/agent/run',
        {
          method: 'POST',
          body: JSON.stringify({
            cart_id: CART_ID,
          }),
        }
      );

      setAgent(result);

      await refresh();
    } catch (e) {
      console.error(
        'AGENT ERROR:',
        e
      );

      setError(
        e.message ||
          'Growth agent failed.'
      );
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // AI BUYER REQUEST
  // ============================================================

  const processBuyerRequest = async () => {
    if (!buyerMessage.trim()) {
      setError(
        'Please enter what the AI buyer wants.'
      );
      return;
    }

    setBuyerLoading(true);
    setError('');
    setBuyerResult(null);

    // Reset individual added state for new recommendation set
    setBuyerAddedProducts({});

    try {
      const result = await api(
        '/api/agent/buyer',
        
        {
          method: 'POST',
          body: JSON.stringify({
            request: buyerMessage,
          }),
        }
      );

      setBuyerResult(result);
    } catch (e) {
      console.error(
        'BUYER REQUEST ERROR:',
        e
      );

      setError(
        e.message ||
          'Unable to process buyer request.'
      );
    } finally {
      setBuyerLoading(false);
    }
  };

  // ============================================================
  // GET AI BUYER RECOMMENDATIONS
  // ============================================================

  const getBuyerRecommendations = () => {
    if (!buyerResult) {
      return [];
    }

    if (
      Array.isArray(
        buyerResult.recommendations
      )
    ) {
      return buyerResult.recommendations;
    }

    if (
      Array.isArray(
        buyerResult.products
      )
    ) {
      return buyerResult.products;
    }

    return [];
  };

  // ============================================================
  // GET PRODUCT ID
  // ============================================================

  const getBuyerProductId = (product) => {
    const p =
      product?.product ||
      product;

    return (
      p?.product_id ||
      p?.id ||
      null
    );
  };

  // ============================================================
  // ADD ONE AI BUYER PRODUCT
  //
  // IMPORTANT:
  //
  // Do NOT use:
  //
  // /api/agent/buyer/add-to-cart
  //
  // here if that endpoint replaces the cart.
  //
  // Instead use the normal cart endpoint which updates
  // the selected product while preserving other products.
  // ============================================================

  const addBuyerToCart = async (product) => {
    try {
      setError('');

      const productId =
        getBuyerProductId(product);

      const quantity = Number(
        product?.quantity || 1
      );

      if (!productId) {
        setError(
          'Unable to identify the selected product.'
        );
        return;
      }

      // Find existing quantity of this product
      const existingItem =
        cart?.items?.find(
          (item) =>
            String(
              item.product_id ||
                item.id
            ) === String(productId)
        );

      const existingQuantity =
        Number(
          existingItem?.qty || 0
        );

      const newQuantity =
        existingQuantity +
        quantity;

      // Use the normal cart endpoint.
      // This preserves all other products.
      await api(
        `/api/cart/${CART_ID}/items`,
        {
          method: 'POST',
          body: JSON.stringify({
            product_id: productId,
            qty: newQuantity,
          }),
        }
      );

      // Mark this recommendation as added
      setBuyerAddedProducts(
        (previous) => ({
          ...previous,
          [productId]: true,
        })
      );

      // Refresh cart
      await refresh();

    } catch (e) {
      console.error(
        'AI BUYER ADD TO CART ERROR:',
        e
      );

      const message =
        typeof e === 'string'
          ? e
          : e?.detail
            ? typeof e.detail === 'string'
              ? e.detail
              : JSON.stringify(
                  e.detail
                )
            : e?.message ||
              'Unable to add product to cart.';

      setError(message);
    }
  };

  // ============================================================
  // ADD ALL AI BUYER ITEMS
  // ============================================================

  const addAllBuyerToCart = async () => {
    try {
      setError('');

      const recommendations =
        getBuyerRecommendations();

      if (!recommendations.length) {
        setError(
          'There are no AI buyer recommendations to add.'
        );
        return;
      }

      // Add recommendations one-by-one through the
      // normal cart endpoint.
      //
      // This is intentionally safer than relying on
      // /api/agent/buyer/add-to-cart if that endpoint
      // replaces the cart.
      for (const product of recommendations) {
        const productId =
          getBuyerProductId(product);

        if (!productId) {
          continue;
        }

        const quantity = Number(
          product?.quantity || 1
        );

        const existingItem =
          cart?.items?.find(
            (item) =>
              String(
                item.product_id ||
                  item.id
              ) === String(productId)
          );

        const existingQuantity =
          Number(
            existingItem?.qty || 0
          );

        await api(
          `/api/cart/${CART_ID}/items`,
          {
            method: 'POST',
            body: JSON.stringify({
              product_id: productId,
              qty:
                existingQuantity +
                quantity,
            }),
          }
        );

        setBuyerAddedProducts(
          (previous) => ({
            ...previous,
            [productId]: true,
          })
        );
      }

      await refresh();

    } catch (e) {
      console.error(
        'AI BUYER ADD ALL ERROR:',
        e
      );

      const message =
        typeof e === 'string'
          ? e
          : e?.detail
            ? typeof e.detail === 'string'
              ? e.detail
              : JSON.stringify(
                  e.detail
                )
            : e?.message ||
              'Unable to add AI recommendations to cart.';

      setError(message);
    }
  };

  // ============================================================
  // APPROVAL DECISION
  // ============================================================

  const handleApprovalDecision = async (
    id,
    decision
  ) => {
    try {
      await api(
        `/api/approvals/${id}/${decision}`,
        {
          method: 'POST',
        }
      );

      await refresh();

      setAgent((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          gate: {
            ...(previous.gate || {}),
            status:
              decision === 'approve'
                ? 'approved'
                : 'rejected',
          },
        };
      });
    } catch (e) {
      console.error(
        'APPROVAL ERROR:',
        e
      );

      setError(
        e.message ||
          'Unable to process approval.'
      );
    }
  };

  // ============================================================
  // GET RECEIPT
  // ============================================================

const viewReceipt = (orderId) => {
  if (!orderId) {
    console.error("Receipt error: Order ID is missing");
    return;
  }

  const apiUrl =
    import.meta.env.VITE_API_URL ||
    "http://127.0.0.1:8000";

  const receiptUrl =
    `${apiUrl}/orders/${encodeURIComponent(orderId)}/receipt`;

  window.open(
    receiptUrl,
    "_blank",
    "noopener,noreferrer"
  );
};
  // ============================================================
  // FAILURE SIMULATION
  // ============================================================

  const simulateFailure = async (
    scenario
  ) => {
    setFailureLoading(true);
    setFailureResult(null);
    setError('');

    try {
      const result = await api(
        `/api/test/failure/${scenario}`,
        {
          method: 'POST',
        }
      );

      setFailureResult(result);
    } catch (e) {
      setFailureResult({
        success: false,
        scenario,
        message:
          e.message ||
          'Simulated failure handled.',
      });
    } finally {
      setFailureLoading(false);
    }
  };

  // ============================================================
  // CART TOTALS
  // ============================================================

  const subtotal =
    Number(
      cart?.subtotal || 0
    );

  const total =
    Number(
      cart?.total || 0
    );

  const discount =
    subtotal - total;

  // ============================================================
  // DASHBOARD SUMMARY
  // ============================================================

  const summary = useMemo(
    () => [
      {
        label: 'CART VALUE',
        value: money(total),
        caption: `${
          cart?.items?.length || 0
        } items in cart`,
        page: 'cart',
      },

      {
        label: 'AI SUGGESTIONS',
        value:
          agent?.addons?.length ?? '—',
        caption: agent
          ? 'Recommendations generated'
          : 'Run the agent',
        page: 'growth-ai',
      },

      {
        label: 'PENDING APPROVALS',
        value: approvals.length,
        caption: approvals.length
          ? 'Action required'
          : 'All clear',
        page: 'approvals',
      },

      {
        label: 'TOTAL ORDERS',
        value: orders.length,
        caption:
          'Completed transactions',
        page: 'orders',
      },

     {
  label: 'REVENUE',
  value: money(getTotalRevenue(revenue)),
  caption: 'Merchant revenue',
  page: 'revenue',
},
    ],
    [
      cart,
      total,
      agent,
      approvals,
      orders,
      revenue,
    ]
  );

  // ============================================================
  // NAVIGATION
  // ============================================================

  const navItems = [
    {
      key: 'dashboard',
      label: 'Dashboard',
      icon: '◫',
    },

    {
      key: 'products',
      label: 'Products',
      icon: '▦',
    },

    {
      key: 'cart',
      label: 'Cart',
      icon: '▱',
      count:
        cart?.items?.length || 0,
    },

    {
      key: 'growth-ai',
      label: 'Growth AI',
      icon: '✦',
    },

    {
      key: 'buyer',
      label: 'AI Buyer',
      icon: '◎',
    },

    {
      key: 'approvals',
      label: 'Approvals',
      icon: '◷',
      count: approvals.length,
    },

    {
      key: 'orders',
      label: 'Orders',
      icon: '□',
    },

    {
      key: 'revenue',
      label: 'Revenue',
      icon: '₹',
    },

    {
      key: 'policies',
      label: 'Policies',
      icon: '◇',
    },

    {
      key: 'audit',
      label: 'Audit',
      icon: '◌',
    },
  ];

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="app-shell">

      {/* ======================================================
          SIDEBAR
      ====================================================== */}

      <aside
        className={`sidebar ${
          compact ? 'compact' : ''
        } ${
          mobile ? 'mobile-open' : ''
        }`}
      >
        <button
          className="brand"
          onClick={() =>
            setCompact(!compact)
          }
        >
          <span className="brand-mark">
            C
          </span>

          <span className="brand-copy">
            COPPER <i>&</i> CHAR
            <small>TEST MODE</small>
          </span>
        </button>

        <nav>
          {navItems.map((item) => (
            <a
              href={`#${item.key}`}
              key={item.key}
              className={
                activePage === item.key
                  ? 'active'
                  : ''
              }
              onClick={(e) => {
                e.preventDefault();
                navigateTo(item.key);
              }}
            >
              <span>
                {item.icon}
              </span>

              <b>
                {item.label}
              </b>

              {Boolean(item.count) && (
                <span className="nav-badge">
                  {item.count}
                </span>
              )}
            </a>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="merchant-avatar">
            CC
          </div>

          <span>
            <b>
              Merchant demo
            </b>

            <small>
              Human oversight on
            </small>
          </span>
        </div>
      </aside>

      {/* ======================================================
          WORKSPACE
      ====================================================== */}

      <div className="workspace">

        {/* ====================================================
            TOPBAR
        ==================================================== */}

        <header className="topbar">

          <button
            className="menu"
            onClick={() =>
              setMobile(!mobile)
            }
          >
            ☰
          </button>

          <div>
            <p className="eyebrow">
              COPPER & CHAR
              <span>•</span>
              {activePage
                .toUpperCase()
                .replace('-', ' ')}
            </p>

            <h1>
              {activePage ===
                'dashboard' &&
                'Commerce Control Room'}

              {activePage ===
                'products' &&
                'Curated Cookware Catalog'}

              {activePage ===
                'cart' &&
                'Your Active Cart'}

              {activePage ===
                'growth-ai' &&
                'Growth Agent Intelligence'}

              {activePage ===
                'buyer' &&
                'AI Buyer Commerce'}

              {activePage ===
                'approvals' &&
                'Human Oversight Queue'}

              {activePage ===
                'orders' &&
                'Transaction History'}

              {activePage ===
                'revenue' &&
                'Revenue Intelligence'}

              {activePage ===
                'policies' &&
                'Commerce Policies'}

              {activePage ===
                'audit' &&
                'System Audit Trail'}
            </h1>
          </div>

          <div className="top-actions">

            <span className="test-badge">
              ● TEST MODE
            </span>

            <button
              className="cart-count-btn"
              onClick={() =>
                navigateTo('cart')
              }
            >
              Cart

              <b>
                {cart?.items?.length || 0}
              </b>
            </button>

            <button
              className="icon-button"
              onClick={() =>
                setDark(!dark)
              }
            >
              {dark
                ? '☀'
                : '◐'}
            </button>

          </div>
        </header>

        {/* ====================================================
            MAIN
        ==================================================== */}

        <main className="page-container">

          {/* ==================================================
              ERROR
          ================================================== */}

          {error && (
            <section className="error-card">
              <div>
                <b>
                  We couldn't complete that request.
                </b>

                <p>
                  {error}
                </p>
              </div>

              <button
                onClick={() => {
                  setError('');
                  refresh();
                }}
              >
                Try again
              </button>
            </section>
          )}

          {/* ==================================================
              DASHBOARD
          ================================================== */}

          {activePage ===
            'dashboard' && (
            <div className="page-view dashboard-view">

              <section className="summary-grid">

                {summary.map((s) => (
                  <article
                    key={s.label}
                    className="clickable-summary"
                    onClick={() =>
                      navigateTo(
                        s.page
                      )
                    }
                  >
                    <span>
                      {s.label}
                    </span>

                    <strong>
                      {s.value}
                    </strong>

                    <small>
                      {s.caption}
                    </small>
                  </article>
                ))}

              </section>

              <section className="hero">

                <div>
                  <p className="section-kicker">
                    AGENTIC COMMERCE
                  </p>

                  <h2>
                    Grow every order responsibly.
                  </h2>

                  <p>
                    AI discovery →
                    recommendation →
                    policy validation →
                    human authorization →
                    Razorpay transaction →
                    audit.
                  </p>
                </div>

                <div className="workflow">
                  <span>
                    AI Buyer
                  </span>

                  <i>→</i>

                  <span>
                    Catalog
                  </span>

                  <i>→</i>

                  <span>
                    Suggest
                  </span>

                  <i>→</i>

                  <span>
                    Validate
                  </span>

                  <i>→</i>

                  <span>
                    Approve
                  </span>

                  <i>→</i>

                  <span>
                    Pay
                  </span>
                </div>

              </section>

              <div className="dashboard-previews">

                <article className="preview-card">
                  <div className="preview-head">

                    <h3>
                      ✦ AI Suggestions
                    </h3>

                    <button
                      onClick={() =>
                        navigateTo(
                          'growth-ai'
                        )
                      }
                    >
                      View →
                    </button>
                  </div>

                  <p>
                    {agent?.proposal?.reasoning ||
                      'Run the Growth Agent to generate policy-checked recommendations.'}
                  </p>

                </article>

                <article className="preview-card">

                  <div className="preview-head">

                    <h3>
                      ◎ AI Buyer
                    </h3>

                    <button
                      onClick={() =>
                        navigateTo(
                          'buyer'
                        )
                      }
                    >
                      Try →
                    </button>

                  </div>

                  <p>
                    Let an AI buyer
                    discover products
                    and add them to a
                    transaction.
                  </p>

                </article>

                <article className="preview-card">

                  <div className="preview-head">

                    <h3>
                      ◷ Approvals
                    </h3>

                    <button
                      onClick={() =>
                        navigateTo(
                          'approvals'
                        )
                      }
                    >
                      View →
                    </button>

                  </div>

                  <p>
                    {approvals.length
                      ? `${approvals.length} action(s) waiting for human authorization.`
                      : '✓ No actions are waiting for authorization.'}
                  </p>

                </article>

              </div>

            </div>
          )}

          {/* ==================================================
              PRODUCTS
          ================================================== */}

          {activePage ===
            'products' && (
            <div className="page-view products-view">

              <section className="store-head">

                <div>

                  <p className="section-kicker">
                    AGENT-READABLE CATALOG
                  </p>

                  <h2>
                    Cookware Catalog
                  </h2>

                </div>

                <span>
                  {catalog.length} pieces
                </span>

              </section>

              <div className="product-grid">

                {catalog.map((p) => {

                  const id =
                    p.id ||
                    p.product_id;

                  const price =
                    p.price ||
                    p.price_inr;

                  const qty =
                    cart?.items?.find(
                      (i) =>
                        (
                          i.id ||
                          i.product_id
                        ) === id
                    )?.qty || 0;

                  return (
                    <article
                      className="product-card"
                      key={id}
                    >

                      <div className="product-art">

                        {p.image_url && (
                          <img
                            src={
                              p.image_url
                            }
                            alt={
                              p.name
                            }
                          />
                        )}

                        <small>
                          {p.category}
                        </small>

                      </div>

                      <div className="product-copy">

                        <h3>
                          {p.name}
                        </h3>

                        <p>
                          {p.description}
                        </p>

                      </div>

                      <div className="product-bottom">

                        <b>
                          {money(price)}
                        </b>

                        <small>
                          {p.stock} in stock
                        </small>

                      </div>

                      <button
                        className={
                          qty
                            ? 'added'
                            : ''
                        }
                        onClick={() =>
                          update(
                            id,
                            qty + 1
                          )
                        }
                      >
                        {qty
                          ? `In cart · ${qty}`
                          : '+ Add to cart'}
                      </button>

                    </article>
                  );
                })}

              </div>

            </div>
          )}

          {/* ==================================================
              CART
          ================================================== */}

          {activePage ===
            'cart' && (
            <div className="page-view cart-view">

              <div className="cart-page-layout">

                <div className="cart-items-column">

                  <section className="cart-panel">

                    <div className="cart-heading">

                      <div>

                        <p className="section-kicker">
                          SELECTED ITEMS
                        </p>

                        <h2>
                          Your Selection
                        </h2>

                      </div>

                      <span>
                        {cart?.items?.length || 0}
                        {' '}
                        line items
                      </span>

                    </div>

                    {!cart?.items?.length ? (

                      <div className="empty-state">

                        <p>
                          Your shopping
                          cart is empty.
                        </p>

                        <button
                          className="primary"
                          onClick={() =>
                            navigateTo(
                              'products'
                            )
                          }
                        >
                          Browse Catalog
                        </button>

                      </div>

                    ) : (

                      <div className="cart-lines">

                        {cart.items.map(
                          (item) => {

                            const itemId =
                              item.product_id ||
                              item.id;

                            const itemPrice =
                              item.price ||
                              item.price_inr;

                            return (
                              <article
                                key={itemId}
                              >

                                <div className="line-art">

                                  {item.image_url && (
                                    <img
                                      src={
                                        item.image_url
                                      }
                                      alt={
                                        item.name
                                      }
                                    />
                                  )}

                                </div>

                                <div>

                                  <b>
                                    {item.name}
                                  </b>

                                  <small>
                                    {money(
                                      itemPrice
                                    )}
                                    {' × '}
                                    {item.qty}
                                  </small>

                                </div>

                                <div className="quantity">

                                  <button
                                    onClick={() =>
                                      update(
                                        itemId,
                                        item.qty -
                                          1
                                      )
                                    }
                                  >
                                    −
                                  </button>

                                  <span>
                                    {item.qty}
                                  </span>

                                  <button
                                    onClick={() =>
                                      update(
                                        itemId,
                                        item.qty +
                                          1
                                      )
                                    }
                                  >
                                    +
                                  </button>

                                </div>

                              </article>
                            );
                          }
                        )}

                      </div>
                    )}

                  </section>

                </div>

                <div className="cart-summary-column">

                  <section className="checkout-card-full">

                    <p className="section-kicker">
                      ORDER SUMMARY
                    </p>

                    <div className="price-summary">

                      <p>
                        <span>
                          Subtotal
                        </span>

                        <b>
                          {money(subtotal)}
                        </b>
                      </p>

                      <p
                        className={
                          discount
                            ? 'discount'
                            : ''
                        }
                      >

                        <span>
                          Policy discount
                        </span>

                        <b>
                          {discount
                            ? `−${money(
                                discount
                              )}`
                            : '—'}
                        </b>

                      </p>

                      <hr />

                      <p className="total">

                        <span>
                          Total Payable
                        </span>

                        <strong>
                          {money(total)}
                        </strong>

                      </p>

                    </div>

                    <button
                      className="primary full-width-btn"
                      disabled={
                        !cart?.items?.length
                      }
                      onClick={() =>
                        setCheckout(true)
                      }
                    >
                      Proceed to Checkout →
                    </button>

                    <div className="cart-ai-cta">

                      <small>
                        ✦ AI recommendations available
                      </small>

                      <button
                        onClick={() =>
                          navigateTo(
                            'growth-ai'
                          )
                        }
                      >
                        View Growth Suggestions
                      </button>

                    </div>

                  </section>

                </div>

              </div>

            </div>
          )}

          {/* ==================================================
              GROWTH AI
          ================================================== */}

          {activePage ===
            'growth-ai' && (
            <div className="page-view growth-view">

              <section className="growth-page-container">

                <AgentPanel
                  result={agent}
                  loading={loading}
                  onRun={run}
                />

                <div className="growth-footer-link">

                  <button
                    className="link-button"
                    onClick={() =>
                      navigateTo(
                        'audit'
                      )
                    }
                  >
                    View audit trail →
                  </button>

                </div>

              </section>

            </div>
          )}

          {/* ==================================================
              AI BUYER
          ================================================== */}

          {activePage === 'buyer' && (
            <div className="page-view buyer-view">

              {/* ==================================================
                  BUYER REQUEST
              ================================================== */}

              <section className="cart-panel buyer-request-panel">

                <div className="buyer-header">

                  <div>

                    <p className="section-kicker">
                      AGENT-TO-AGENT COMMERCE
                    </p>

                    <h2>
                      AI Buyer
                    </h2>

                    <p className="buyer-description">
                      Describe what the buyer wants.
                      The merchant's agent will search
                      the agent-readable catalog and
                      return compatible products.
                    </p>

                  </div>

                  <div className="buyer-status">
                    <span>●</span>
                    Agent Connected
                  </div>

                </div>

                <div className="buyer-input-wrapper">

                  <textarea
                    className="buyer-textarea"
                    value={buyerMessage}
                    onChange={(e) =>
                      setBuyerMessage(
                        e.target.value
                      )
                    }
                    placeholder="Example: I need a premium frying pan under ₹3000..."
                    rows={5}
                  />

                  <div className="buyer-input-footer">

                    <small>
                      ✦ AI will search{' '}
                      <b>
                        {agentCatalog.length}
                      </b>{' '}
                      products
                    </small>

                    <button
                      className="primary"
                      disabled={
                        buyerLoading
                      }
                      onClick={
                        processBuyerRequest
                      }
                    >
                      {buyerLoading
                        ? 'AI Buyer is thinking...'
                        : 'Ask Merchant Agent →'}
                    </button>

                  </div>

                </div>

              </section>

              {/* ==================================================
                  BUYER RESULT
              ================================================== */}

              {buyerResult && (
                <section className="cart-panel buyer-result-panel">

                  <div className="buyer-result-header">

                    <div>

                      <p className="section-kicker">
                        BUYER RESULT
                      </p>

                      <h2>
                        AI Recommendations
                      </h2>

                      <p>
                        Products selected by the
                        merchant agent based on
                        the buyer request.
                      </p>

                    </div>

                    {getBuyerRecommendations().length > 0 && (
                      <button
                        className="primary"
                        onClick={
                          addAllBuyerToCart
                        }
                      >
                        Add All to Cart →
                      </button>
                    )}

                  </div>

                  {/* ==================================================
                      AI REASONING
                  ================================================== */}

                  {(buyerResult.reasoning ||
                    buyerResult.explanation ||
                    buyerResult.message) && (

                    <div className="buyer-reasoning">

                      <span>
                        ✦
                      </span>

                      <div>

                        <b>
                          Merchant Agent
                        </b>

                        <p>
                          {buyerResult.reasoning ||
                            buyerResult.explanation ||
                            buyerResult.message}
                        </p>

                      </div>

                    </div>
                  )}

                  {buyerResult.requirements && (
                    <div className="buyer-requirements">
                      <div>
                        <span className="section-kicker">BUYER REQUIREMENTS</span>
                        <strong>{buyerResult.requirements.category}</strong>
                      </div>
                      {buyerResult.requirements.people && <span>People: {buyerResult.requirements.people}</span>}
                      <span>Budget: {money(buyerResult.requirements.budget)}</span>
                      <span>Goal: {buyerResult.requirements.use_case}</span>
                    </div>
                  )}

                  {/* ==================================================
                      PRODUCTS
                  ================================================== */}

                  {getBuyerRecommendations().length > 0 ? (

                    <div className="buyer-product-grid">

                      {getBuyerRecommendations().map(
                        (product, index) => {

                          const p =
                            product?.product ||
                            product;

                          const id =
                            p?.product_id ||
                            p?.id ||
                            index;

                          const price =
                            p?.price ||
                            p?.price_inr ||
                            0;

                          const quantity =
                            Number(
                              product?.quantity ||
                                1
                            );

                          const isAdded =
                            Boolean(
                              buyerAddedProducts[
                                id
                              ]
                            );

                          return (

                            <article
                              key={id}
                              className="buyer-product-card"
                            >

                              {/* PRODUCT IMAGE */}

                              <div className="buyer-product-image">

                                {p?.image_url ? (

                                  <img
                                    src={
                                      p.image_url
                                    }
                                    alt={
                                      p?.name ||
                                      'Product'
                                    }
                                  />

                                ) : (

                                  <span>
                                    ◫
                                  </span>

                                )}

                                {p?.category && (
                                  <small>
                                    {p.category}
                                  </small>
                                )}

                              </div>

                              {/* PRODUCT DETAILS */}

                              <div className="buyer-product-content">

                                <h3>
                                  {p?.name ||
                                    'Unnamed Product'}
                                </h3>

                                {p?.description && (
                                  <p>
                                    {p.description}
                                  </p>
                                )}

                                <div className="buyer-product-meta">

                                  <strong>
                                    {money(price)}
                                  </strong>

                                  <span>
                                    Qty: {quantity}
                                  </span>

                                </div>

                                {product.recommendation && (
                                  <details className="buyer-explanation">
                                    <summary>Why recommended? <b>{product.recommendation.score}% match</b></summary>
                                    <div className="buyer-factor-grid">
                                      {Object.entries(product.recommendation.match_factors || {}).map(([factor, value]) => (
                                        <span key={factor}>{factor.replaceAll('_', ' ')} <b>{value}%</b></span>
                                      ))}
                                    </div>
                                    <ul>
                                      {(product.recommendation.why_recommended || []).map((reason) => <li key={reason}>✓ {reason}</li>)}
                                    </ul>
                                    <small>Budget impact {money(product.recommendation.budget_impact)} · Remaining {money(product.recommendation.remaining_budget)}</small>
                                  </details>
                                )}

                                {/* ==================================================
                                    INDIVIDUAL ADD BUTTON
                                ================================================== */}

                                <button
                                  className={
                                    isAdded
                                      ? 'buyer-add-btn added'
                                      : 'buyer-add-btn'
                                  }
                                  onClick={() =>
                                    addBuyerToCart(
                                      product
                                    )
                                  }
                                >
                                  {isAdded
                                    ? '✓ Added to cart'
                                    : '+ Add to cart'}
                                </button>

                              </div>

                            </article>

                          );
                        }
                      )}

                    </div>

                  ) : (

                    <div className="empty-state">

                      <p>
                        No matching products
                        were found.
                      </p>

                      <small>
                        Try another product
                        type, budget, or
                        requirement.
                      </small>

                    </div>

                  )}

                  {buyerResult.excluded_products?.length > 0 && (
                    <details className="buyer-excluded">
                      <summary>Why were other products not selected? ({buyerResult.excluded_products.length})</summary>
                      <div>
                        {buyerResult.excluded_products.slice(0, 8).map((item) => (
                          <p key={item.product_id}><strong>{item.name}</strong> <span>{item.reason_codes.join(' · ')}</span></p>
                        ))}
                      </div>
                    </details>
                  )}

                </section>
              )}

              {/* ==================================================
                  AGENT CATALOG
              ================================================== */}

              <section className="cart-panel buyer-catalog-panel">

                <div>

                  <p className="section-kicker">
                    AGENT CATALOG
                  </p>

                  <h3>
                    {agentCatalog.length} products
                    {' '}
                    exposed to AI buyers
                  </h3>

                  <p>
                    These products are available
                    to the merchant agent for
                    agent-to-agent discovery.
                  </p>

                </div>

                <button
                  className="secondary"
                  onClick={() =>
                    navigateTo(
                      'products'
                    )
                  }
                >
                  View Catalog →
                </button>

              </section>

            </div>
          )}

          {/* ==================================================
              APPROVALS
          ================================================== */}

          {activePage === 'approvals' && (
            <div className="page-view approvals-view">

              <ApprovalQueue
                rows={approvals}
                onDecision={
                  handleApprovalDecision
                }
              />

            </div>
          )}

          {/* ==================================================
    ORDERS
================================================== */}

{activePage === 'orders' && (
  <div className="page-view">

    <section className="cart-panel">

      <p className="section-kicker">
        TRANSACTIONS
      </p>

      <h2>
        Orders
      </h2>

      {!orders.length ? (

        <div className="empty-state">
          No orders yet.
        </div>

      ) : (

        <div className="orders-list">

          {orders.map((order, index) => {

            const id =
              order.id ||
              order.order_id ||
              `order-${index}`;

            const amount =
              order.amount ??
              order.total ??
              0;

            const status =
              order.status ||
              'Completed';

            return (
              <article
                className="order-row"
                key={id}
              >

                {/* Order information */}
                <div className="order-info">

                  <span className="order-label">
                    Order
                  </span>

                  <strong className="order-id">
                    #{order.id || order.order_id}
                  </strong>

                  <span className="order-status">
                    {status}
                  </span>

                </div>

                {/* Amount */}
                <div className="order-amount">

                  <span className="amount-label">
                    Amount
                  </span>

                  <strong>
                    {money(amount)}
                  </strong>

                </div>

                {/* Receipt */}
                <button
  className="receipt-download-btn"
  onClick={() => downloadReceipt(order.id)}
>
  Download Receipt
</button>

              </article>
            );
          })}

        </div>
      )}

    </section>

  </div>
)}

        {/* ==================================================
    REVENUE
================================================== */}

{activePage === 'revenue' && (
  <div className="page-view revenue-view">

    {/* ==================================================
        PAGE HEADER
    ================================================== */}

    <section className="revenue-page-header">

      <div>
        <p className="section-kicker">
          REVENUE INTELLIGENCE
        </p>

        <h2>
          Merchant Revenue
        </h2>

        <p>
          Track transaction performance and the impact
          of AI-assisted commerce.
        </p>
      </div>

      <div className="revenue-live-status">
        <span className="status-dot"></span>
        Live test data
      </div>

    </section>


    {/* ==================================================
        KPI CARDS
    ================================================== */}

    <section className="revenue-kpi-grid">

      {/* TOTAL REVENUE */}

      <article className="revenue-kpi-card">

        <div className="revenue-kpi-top">
          <span>
            TOTAL REVENUE
          </span>

          <div className="revenue-kpi-icon">
            ₹
          </div>
        </div>

        <strong>
          {money(getTotalRevenue(revenue))}
        </strong>

        <small>
          Recorded transactions
        </small>

      </article>


      {/* ORDERS */}

      <article className="revenue-kpi-card">

        <div className="revenue-kpi-top">
          <span>
            ORDERS
          </span>

          <div className="revenue-kpi-icon">
            #
          </div>
        </div>

        <strong>
          {orders.length}
        </strong>

        <small>
          Completed transactions
        </small>

      </article>


      {/* AI REVENUE */}

      <article className="revenue-kpi-card">

        <div className="revenue-kpi-top">
          <span>
            AI-ASSISTED REVENUE
          </span>

          <div className="revenue-kpi-icon">
            ✦
          </div>
        </div>

        <strong>
          {money(
            revenue?.ai_assisted_revenue
          )}
        </strong>

        <small>
          Revenue influenced by AI
        </small>

      </article>


      {/* AI CONTRIBUTION */}

      <article className="revenue-kpi-card">

        <div className="revenue-kpi-top">
          <span>
            AI CONTRIBUTION
          </span>

          <div className="revenue-kpi-icon">
            %
          </div>
        </div>

        <strong>
          {revenue?.ai_revenue_contribution_pct ?? 0}%
        </strong>

        <small>
          Of total revenue
        </small>

      </article>


      {/* AOV */}

      <article className="revenue-kpi-card">

        <div className="revenue-kpi-top">
          <span>
            AVERAGE ORDER VALUE
          </span>

          <div className="revenue-kpi-icon">
            ↗
          </div>
        </div>

        <strong>
          {money(
            revenue?.average_order_value
          )}
        </strong>

        <small>
          Average transaction
        </small>

      </article>


      {/* UPSELL */}

      <article className="revenue-kpi-card">

        <div className="revenue-kpi-top">
          <span>
            UPSELL ACCEPTANCE
          </span>

          <div className="revenue-kpi-icon">
            ✓
          </div>
        </div>

        <strong>
          {revenue?.upsell_acceptance_pct ?? 0}%
        </strong>

        <small>
          AI recommendation acceptance
        </small>

      </article>

    </section>


    {/* ==================================================
        MAIN REVENUE CONTENT
    ================================================== */}

    <div className="revenue-content-grid">

      {/* ==================================================
          REVENUE BREAKDOWN
      ================================================== */}

      <section className="cart-panel revenue-breakdown-card">

        <div className="revenue-section-header">

          <div>
            <p className="section-kicker">
              PERFORMANCE
            </p>

            <h3>
              Revenue Breakdown
            </h3>
          </div>

          <span className="revenue-period">
            TEST MODE
          </span>

        </div>


        <div className="revenue-breakdown-list">

          {/* TOTAL */}

          <div className="revenue-row">

            <div className="revenue-row-info">

              <span className="revenue-row-icon">
                ₹
              </span>

              <div>
                <b>
                  Total Test Revenue
                </b>

                <small>
                  All completed test transactions
                </small>
              </div>

            </div>

            <strong>
              {money(
                revenue?.total_test_revenue
              )}
            </strong>

          </div>


          {/* AI ASSISTED */}

          <div className="revenue-row">

            <div className="revenue-row-info">

              <span className="revenue-row-icon">
                ✦
              </span>

              <div>
                <b>
                  AI-Assisted Revenue
                </b>

                <small>
                  Revenue influenced by AI recommendations
                </small>
              </div>

            </div>

            <strong>
              {money(
                revenue?.ai_assisted_revenue
              )}
            </strong>

          </div>


          {/* AI CONTRIBUTION */}

          <div className="revenue-row">

            <div className="revenue-row-info">

              <span className="revenue-row-icon">
                %
              </span>

              <div>
                <b>
                  AI Revenue Contribution
                </b>

                <small>
                  Share of revenue influenced by AI
                </small>
              </div>

            </div>

            <strong>
              {revenue?.ai_revenue_contribution_pct ?? 0}%
            </strong>

          </div>


          {/* AOV */}

          <div className="revenue-row">

            <div className="revenue-row-info">

              <span className="revenue-row-icon">
                ↗
              </span>

              <div>
                <b>
                  Average Order Value
                </b>

                <small>
                  Average completed transaction
                </small>
              </div>

            </div>

            <strong>
              {money(
                revenue?.average_order_value
              )}
            </strong>

          </div>


          {/* UPSELL */}

          <div className="revenue-row">

            <div className="revenue-row-info">

              <span className="revenue-row-icon">
                ✓
              </span>

              <div>
                <b>
                  Upsell Acceptance
                </b>

                <small>
                  AI recommendation acceptance rate
                </small>
              </div>

            </div>

            <strong>
              {revenue?.upsell_acceptance_pct ?? 0}%
            </strong>

          </div>


          {/* PAYMENT RECOVERY */}

          <div className="revenue-row">

            <div className="revenue-row-info">

              <span className="revenue-row-icon">
                ↻
              </span>

              <div>
                <b>
                  Payment Recovery
                </b>

                <small>
                  Successfully recovered payments
                </small>
              </div>

            </div>

            <strong>
              {revenue?.payment_recovery_pct ?? 0}%
            </strong>

          </div>

        </div>

      </section>


      {/* ==================================================
          REVENUE INSIGHT
      ================================================== */}

      <section className="cart-panel revenue-insight-card">

        <p className="section-kicker">
          AI COMMERCE
        </p>

        <h3>
          Revenue Insight
        </h3>

        <div className="revenue-insight-value">
          {revenue?.ai_revenue_contribution_pct ?? 0}%
        </div>

        <p>
          of your test revenue is currently attributed
          to AI-assisted commerce.
        </p>


        <div className="insight-stat">

          <span>
            AI-assisted revenue
          </span>

          <strong>
            {money(
              revenue?.ai_assisted_revenue
            )}
          </strong>

        </div>


        <div className="insight-stat">

          <span>
            Average order value
          </span>

          <strong>
            {money(
              revenue?.average_order_value
            )}
          </strong>

        </div>


        <div className="insight-stat">

          <span>
            Upsell acceptance
          </span>

          <strong>
            {revenue?.upsell_acceptance_pct ?? 0}%
          </strong>

        </div>

      </section>

    </div>


    {/* ==================================================
        API RESPONSE
    ================================================== */}

    <section className="cart-panel revenue-api-card">

      <div className="revenue-api-header">

        <div>

          <p className="section-kicker">
            SYSTEM DATA
          </p>

          <h3>
            Revenue API Response
          </h3>

        </div>

        <span>
          JSON
        </span>

      </div>

      <pre>
        {JSON.stringify(
          revenue,
          null,
          2
        )}
      </pre>

    </section>

  </div>
)}
{/* ==================================================
    POLICIES
================================================== */}

{activePage === 'policies' && (
  <div className="page-view policies-page">

    <div className="policies-header">
      <div>
        <p className="section-kicker">GOVERNANCE</p>
        <h2>Commerce Policies</h2>
        <p className="policies-description">
          Rules and permissions that control how AI agents can operate
          within the commerce system.
        </p>
      </div>

      <div className="policy-status">
        <span className="status-dot"></span>
        Policies Active
      </div>
    </div>

    {/* LIMITS */}
    <section className="policy-section">
      <div className="policy-section-header">
        <div>
          <h3>Commerce Limits</h3>
          <p>Maximum actions allowed without additional governance.</p>
        </div>
      </div>

      <div className="policy-limit-grid">

        <div className="policy-card">
          <span className="policy-card-label">
            AUTO APPROVAL THRESHOLD
          </span>
          <div className="policy-value">
            ₹{policies?.limits?.auto_approval_threshold?.toLocaleString()}
          </div>
          <p>Maximum order value eligible for automatic approval.</p>
        </div>

        <div className="policy-card">
          <span className="policy-card-label">
            MAX DISCOUNT
          </span>
          <div className="policy-value">
            {policies?.limits?.max_discount_pct}%
          </div>
          <p>Maximum discount an AI agent can apply.</p>
        </div>

        <div className="policy-card">
          <span className="policy-card-label">
            MAX AI ADD-ONS
          </span>
          <div className="policy-value">
            {policies?.limits?.max_ai_addons}
          </div>
          <p>Maximum AI-recommended add-ons per cart.</p>
        </div>

        <div className="policy-card">
          <span className="policy-card-label">
            MAX CART INCREASE
          </span>
          <div className="policy-value">
            {policies?.limits?.max_cart_increase_pct}%
          </div>
          <p>Maximum allowed increase to the original cart.</p>
        </div>

      </div>
    </section>

    {/* AGENT PERMISSIONS */}
    <section className="policy-section">
      <div className="policy-section-header">
        <div>
          <h3>Agent Permissions</h3>
          <p>Actions available to each AI commerce agent.</p>
        </div>
      </div>

      <div className="agent-permissions">

        {Object.entries(policies?.permissions || {}).map(
          ([agent, permissions]) => (
            <div className="agent-policy-card" key={agent}>

              <div className="agent-policy-header">
                <div>
                  <span className="agent-policy-label">
                    AI AGENT
                  </span>
                  <h4>{agent}</h4>
                </div>

                <span className="permission-count">
                  {permissions.length} permissions
                </span>
              </div>

              <div className="permission-list">
                {permissions.map((permission) => (
                  <div
                    className="permission-item"
                    key={permission}
                  >
                    <span className="permission-check">✓</span>
                    <span>{permission.replaceAll('_', ' ')}</span>
                  </div>
                ))}
              </div>

            </div>
          )
        )}

      </div>
    </section>

  </div>
)}

          {/* ==================================================
              AUDIT
          ================================================== */}

          {activePage ===
            'audit' && (
            <div className="page-view audit-view">

              <AuditTrail
                cartId={CART_ID}
              />

              <section className="cart-panel">

                <p className="section-kicker">
                  RESILIENCE TESTING
                </p>

                <h2>
                  Failure Simulation
                </h2>

                <p>
                  Demonstrate graceful
                  failure handling for
                  the hackathon demo.
                </p>

                <div
                  style={{
                    display:
                      'flex',
                    gap: '10px',
                    flexWrap:
                      'wrap',
                  }}
                >

                  <button
                    className="primary"
                    disabled={
                      failureLoading
                    }
                    onClick={() =>
                      simulateFailure(
                        'payment'
                      )
                    }
                  >
                    Simulate Payment Failure
                  </button>

                  <button
                    className="primary"
                    disabled={
                      failureLoading
                    }
                    onClick={() =>
                      simulateFailure(
                        'inventory'
                      )
                    }
                  >
                    Simulate Inventory Failure
                  </button>

                  <button
                    className="primary"
                    disabled={
                      failureLoading
                    }
                    onClick={() =>
                      simulateFailure(
                        'agent'
                      )
                    }
                  >
                    Simulate Agent Failure
                  </button>

                </div>

                {failureResult && (
                  <pre
                    style={{
                      whiteSpace:
                        'pre-wrap',
                      marginTop:
                        '20px',
                    }}
                  >
                    {JSON.stringify(
                      failureResult,
                      null,
                      2
                    )}
                  </pre>
                )}

              </section>

            </div>
          )}

        </main>
      </div>

      {/* ========================================================
          CHECKOUT
      ======================================================== */}

      {checkout && (
        <CheckoutModal
          cart={cart}
          cartId={CART_ID}
          close={() =>
            setCheckout(false)
          }
          refresh={refresh}
        />
      )}

      {/* ========================================================
          RECEIPT MODAL
      ======================================================== */}

      {selectedReceipt && (
        <div
          className="modal-backdrop"
          onClick={() =>
            setSelectedReceipt(null)
          }
        >

          <div
            className="checkout-modal"
            onClick={(e) =>
              e.stopPropagation()
            }
          >

            <div className="modal-header">

              <div>

                <p className="section-kicker">
                  PAYMENT RECEIPT
                </p>

                <h2>
                  Transaction Complete
                </h2>

              </div>

              <button
                onClick={() =>
                  setSelectedReceipt(null)
                }
              >
                ×
              </button>

            </div>

            <div className="receipt-content">

              <pre
                style={{
                  whiteSpace:
                    'pre-wrap',
                }}
              >
                {JSON.stringify(
                  selectedReceipt,
                  null,
                  2
                )}
              </pre>

            </div>

            <button
              className="primary full-width-btn"
              onClick={() =>
                window.print()
              }
            >
              Print / Save Receipt
            </button>

          </div>

        </div>
      )}

    </div>
  );
}