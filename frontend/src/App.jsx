import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import './styles.css';

import AgentPanel from './components/AgentPanel';
import ApprovalQueue from './components/ApprovalQueue';
import AuditTrail from './components/AuditTrail';
import CheckoutModal from './components/CheckoutModal';
import AgentFlow from './components/AgentFlow';
import AgentActivityFeed from './components/AgentActivityFeed';
import MerchantCatalog from './components/MerchantCatalog';
import OrderHistory from './components/OrderHistory';
import SavedCarts from './components/SavedCarts';
import Wishlist from './components/Wishlist';
import Reviews from './components/Reviews';
import Support from './components/Support';
import AIBuyer from './components/AIBuyer';

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

const readSession = (key, fallback = null) => {
  try {
    const value = window.sessionStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const writeSession = (key, value) => {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Session persistence is only a UX enhancement; backend state remains authoritative.
  }
};

export default function App() {
  // ============================================================
  // CORE STATE
  // ============================================================

  const [catalog, setCatalog] = useState([]);
  const [merchantCatalog, setMerchantCatalog] = useState([]);
  const [cart, setCart] = useState(null);
  const [agent, setAgent] = useState(() => readSession('cc-growth-session'));
  const [approvals, setApprovals] = useState([]);

  // ============================================================
  // BACKEND DATA
  // ============================================================

  const [agentCatalog, setAgentCatalog] = useState([]);
  const [policies, setPolicies] = useState(null);
  const [revenue, setRevenue] = useState(null);
  const [orders, setOrders] = useState([]);
  const [buyerResult, setBuyerResult] = useState(() => readSession('cc-buyer-result'));
  const [auditEvents, setAuditEvents] = useState([]);

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

  const [buyerMessage, setBuyerMessage] = useState(() => readSession('cc-buyer-request', ''));
  const [experience, setExperience] = useState(() =>
    window.localStorage.getItem('cc-experience') || 'buyer'
  );

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
    'catalog',
    'cart',
    'growth-ai',
    'buyer',
    'approvals',
    'orders',
    'revenue',
    'policies',
    'audit',
    'saved-carts',
    'wishlist',
    'reviews',
    'support',
    'segments',
    'discount-rules',
    'settings',
  ];

  const buyerPages = new Set(['buyer', 'products', 'cart', 'growth-ai', 'orders', 'saved-carts', 'wishlist', 'reviews', 'support']);
  const merchantPages = new Set(['dashboard', 'catalog', 'approvals', 'orders', 'revenue', 'policies', 'audit','segments', 'discount-rules', 'settings']);

  const pageForExperience = (page, role = experience) => {
    if (role === 'buyer' && !buyerPages.has(page)) return 'buyer';
    if (role === 'merchant' && !merchantPages.has(page)) return 'dashboard';
    return page;
  };
/// ============================================================
// WISHLIST
// ============================================================

const [wishlist, setWishlist] = useState([]);

const loadWishlist = async () => {
  const currentCartId = cart?.id;

  if (!currentCartId) {
    setWishlist([]);
    return;
  }

  try {
    const data = await api(
      `/api/wishlist/${currentCartId}`
    );

    setWishlist(
      Array.isArray(data) ? data : []
    );
  } catch (err) {
    console.error(
      'Failed to load wishlist:',
      err
    );
  }
};

useEffect(() => {
  if (cart?.id) {
    loadWishlist();
  }
}, [cart?.id]);

const isInWishlist = (productId) => {
  return wishlist.some(
    (item) =>
      item.product_id === productId
  );
};

const toggleWishlist = async (productId) => {
  const currentCartId = cart?.id;

  if (!currentCartId) {
    console.error('No cart ID available');
    return;
  }

  try {
    if (isInWishlist(productId)) {

      await api(
        `/api/wishlist/${currentCartId}/${productId}`,
        {
          method: 'DELETE',
        }
      );

    } else {

      await api(
        '/api/wishlist',
        {
          method: 'POST',
          body: JSON.stringify({
            cart_id: currentCartId,
            product_id: productId,
          }),
        }
      );
    }

    await loadWishlist();

  } catch (err) {
    console.error(
      'Failed to update wishlist:',
      err
    );
  }
};
  const [activePage, setActivePage] = useState(() => {
    const hash = window.location.hash.replace('#', '');
    const requestedPage = hash.replace(/^buyer\//, '').replace(/^merchant\//, '');

    if (!validPages.includes(requestedPage)) return 'buyer';
    if (experience === 'buyer' && !buyerPages.has(requestedPage)) return 'buyer';
    if (experience === 'merchant' && !merchantPages.has(requestedPage)) return 'dashboard';
    return requestedPage;
  });

  const navigateTo = (page) => {
    const nextPage = pageForExperience(page);
    setActivePage(nextPage);
    window.location.hash = `${experience}/${nextPage}`;
    setMobile(false);
  };

  const switchExperience = (role) => {
    setExperience(role);
    window.localStorage.setItem('cc-experience', role);
    const nextPage = role === 'buyer' ? 'buyer' : 'dashboard';
    setActivePage(nextPage);
    window.location.hash = `${role}/${nextPage}`;
  };

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      const page = hash.replace(/^buyer\//, '').replace(/^merchant\//, '');

      if (validPages.includes(page)) {
        setActivePage(pageForExperience(page));
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

  useEffect(() => {
    writeSession('cc-buyer-request', buyerMessage);
  }, [buyerMessage]);

  useEffect(() => {
    writeSession('cc-buyer-result', buyerResult);
  }, [buyerResult]);

  useEffect(() => {
    writeSession('cc-growth-session', agent);
  }, [agent]);

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
        auditData,
        growthApprovals,
        growthRecommendationData,
        merchantCatalogData,
      ] = await Promise.all([
        api('/api/catalog'),
        api(`/api/cart/${CART_ID}`),
        api('/api/approvals'),
        api('/api/revenue'),
        api('/api/orders'),
        api('/api/policies'),
        api('/api/agent/catalog'),
        api(`/api/audit/${CART_ID}`),
        api(`/api/growth/approvals/buyer/${CART_ID}`),
        api(`/api/agent/growth/recommendations/${CART_ID}`),
        api('/api/merchant/catalog'),
      ]);

      setCatalog(
        Array.isArray(products)
          ? products
          : []
      );
      setMerchantCatalog(Array.isArray(merchantCatalogData) ? merchantCatalogData : []);

      setCart(currentCart);
      setAgent((previous) => {
        const recovered = previous || (growthRecommendationData?.addons?.length ? growthRecommendationData : null);
        if (!recovered) return previous;
       const approvalsById = new Map(
  (growthApprovals || []).map((item) => [
    String(item.id),
    item,
  ])
);

return {
  ...recovered,
  cart: currentCart,
  addons: (recovered.addons || []).map((addon) => {
    const approval = addon.approval_id
  ? approvalsById.get(String(addon.approval_id))
  : null;

    return {
      ...addon,

      // IMPORTANT:
      // Never trust an old approval_status from a previous agent run.
      approval_status: approval?.status || 'PENDING',

      approved_discount_pct:
        approval?.merchant_approved_discount_pct ?? null,

      final_price:
        approval?.final_price ?? null,

      requested_discount_pct:
        approval?.buyer_requested_discount_pct ??
        addon.requested_discount_pct ??
        addon.discount_pct ??
        0,
    };
  }),
};
      });

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

      setAuditEvents(Array.isArray(auditData) ? auditData : []);

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
    if (['cart', 'products', 'growth-ai', 'approvals', 'orders'].includes(activePage)) {
      refresh();
    }
  }, [activePage]);

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
      if (result.cart) {
        setCart(result.cart);
      }

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

  const selectGrowthAddons = async (items) => {
    try {
      setError('');
      const result = await api('/api/agent/growth/select', {
        method: 'POST',
        body: JSON.stringify({ cart_id: CART_ID, items: items.map((item) => ({ product_id: item.product_id, quantity: item.qty || 1, requested_discount_pct: item.requested_discount_pct || 0 })) }),
      });
      if (result.cart) setCart(result.cart);
      setAgent((previous) => previous ? { ...previous, cart: result.cart, outcome: { ...(previous.outcome || {}), status: 'buyer_pending' }, addons: (previous.addons || []).map((addon) => items.some((item) => item.product_id === addon.product_id) ? { ...addon, approval_status: 'PENDING' } : addon) } : previous);
      await refresh();
    } catch (e) {
      setError(e.message || 'Unable to add the selected Growth recommendations. Your cart was not changed.');
    }
  };

  const requestGrowthDiscount = async (addon, requestedDiscountPct) => {
    try {
      setError('');
      const result = await api('/api/growth/approval/request', {
        method: 'POST',
        body: JSON.stringify({ cart_id: CART_ID, product_id: addon.product_id, qty: addon.qty || 1, requested_discount_pct: Number(requestedDiscountPct) }),
      });
      setAgent((previous) => previous ? {
        ...previous,
        addons: (previous.addons || []).map((item) => item.product_id === addon.product_id ? { ...item, approval_status: 'PENDING', requested_discount_pct: Number(requestedDiscountPct), approval_id: result.approval_id } : item),
      } : previous);
      await refresh();
      return result;
    } catch (e) {
      setError(e.message || 'Unable to send the discount request.');
      return null;
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
  decision,
  approvalRow
) => {
  try {
    const isGrowthApproval =
      approvalRow?.kind === 'growth_item';

    const approvedDiscount =
      approvalRow?.approved_discount_pct ??
      approvalRow?.buyer_requested_discount_pct ??
      0;

    const decisionResult = await api(
      isGrowthApproval
        ? `/api/growth/approvals/${id}/${decision}`
        : `/api/approvals/${id}/${decision}`,
      {
        method: 'POST',
        body: isGrowthApproval
          ? JSON.stringify(
              decision === 'approve'
                ? {
                    approved_discount_pct:
                      approvedDiscount,
                  }
                : {
                    reason:
                      'Rejected by merchant.',
                  }
            )
          : undefined,
      }
    );

    // ==========================================================
    // UPDATE CART
    // ==========================================================

    if (decisionResult.cart) {
      setCart(decisionResult.cart);
    }

    // ==========================================================
    // UPDATE AGENT RESULT
    // ==========================================================

    setAgent((previous) => {
      if (!previous) {
        return previous;
      }

      const updatedAddons = (
        previous.addons || []
      ).map((addon) => {

        // IMPORTANT:
        // Match the exact approval request,
        // NOT just the product.
        if (
          String(addon.approval_id) !==
          String(id)
        ) {
          return addon;
        }

        return {
          ...addon,

          approval_status:
            decision === 'approve'
              ? 'APPROVED'
              : 'REJECTED',

          approved_discount_pct:
            decision === 'approve'
              ? approvedDiscount
              : null,

          final_price:
            decision === 'approve'
              ? (
                  decisionResult.final_price ??
                  addon.final_price ??
                  addon.product?.price
                )
              : null,
        };
      });

      return {
        ...previous,

        addons: updatedAddons,

        // IMPORTANT:
        // Don't blindly make the entire proposal
        // approved/rejected if there are multiple addons.
        gate: {
          ...(previous.gate || {}),
          status:
            decision === 'approve'
              ? 'approved'
              : 'rejected',
        },

        outcome: {
          ...(previous.outcome || {}),
          status:
            decision === 'approve'
              ? 'executed'
              : 'rejected',
        },
      };
    });

    // ==========================================================
    // REFRESH BACKEND DATA
    // ==========================================================

    await refresh();

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
      key: 'catalog',
      label: 'Product Catalog',
      icon: '▤',
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
      key: 'saved-carts',
      label: 'Saved Carts',
      icon: '💾',
    },

    {
      key: 'wishlist',
      label: 'Wishlist',
      icon: '❤',
    },

    {
      key: 'reviews',
      label: 'Reviews',
      icon: '★',
    },

    {
      key: 'support',
      label: 'Support',
      icon: '💬',
    },

    {
      key: 'revenue',
      label: 'Revenue',
      icon: '₹',
    },

    

    {
      key: 'segments',
      label: 'Segments',
      icon: '👥',
    },

    {
      key: 'discount-rules',
      label: 'Discount Rules',
      icon: '📋',
    },

    {
      key: 'settings',
      label: 'Settings',
      icon: '⚙',
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

  const visibleNavItems = navItems.filter((item) =>
    experience === 'buyer' ? buyerPages.has(item.key) : merchantPages.has(item.key)
  );

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
          <div className="experience-switcher" role="group" aria-label="Experience">
            <button className={experience === 'buyer' ? 'active' : ''} onClick={() => switchExperience('buyer')}>Buyer View</button>
            <button className={experience === 'merchant' ? 'active' : ''} onClick={() => switchExperience('merchant')}>Merchant View</button>
          </div>
          <p className="nav-context">{experience === 'buyer' ? 'SHOPPING EXPERIENCE' : 'MERCHANT CONSOLE'}</p>
          {visibleNavItems.map((item) => (
            <a
              href={`#${experience}/${item.key}`}
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
                'catalog' &&
                'Product Catalog Management'}

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

{activePage === 'dashboard' && (
  <div className="page-view dashboard-view">

    {/* ================= KPI ROW ================= */}

    <section className="dashboard-kpi-grid">

      {summary.map((s, index) => (
        <article
          key={s.label}
          className={`dashboard-kpi-card ${
            index === 0 ? 'primary-kpi' : ''
          }`}
          onClick={() => navigateTo(s.page)}
        >
          <div className="dashboard-kpi-header">
            <span>{s.label}</span>
            <span className="dashboard-kpi-arrow">↗</span>
          </div>

          <strong>{s.value}</strong>

          <small>{s.caption}</small>
        </article>
      ))}

    </section>


    {/* ================= MAIN HERO ================= */}

    <section className="dashboard-main-card">

      <div className="dashboard-main-content">

        <div className="agent-online-badge">
          <span></span>
          GROWTH AGENT ONLINE
        </div>

        <span className="section-kicker">
          AGENTIC COMMERCE
        </span>

        <h1>
          Grow every order,
          <span> responsibly.</span>
        </h1>

        <p>
          AI discovers opportunities, recommends products,
          validates merchant policies, and keeps humans in
          control before every transaction.
        </p>

        <div className="dashboard-main-actions">

          <button
            className="dashboard-primary-action"
            onClick={() => navigateTo('growth-ai')}
          >
            ✦ Run Growth AI
          </button>

          <button
            className="dashboard-secondary-action"
            onClick={() => navigateTo('analytics')}
          >
            View Analytics →
          </button>

        </div>

      </div>


      {/* ================= AI SUMMARY ================= */}

      <div className="dashboard-ai-summary">

        <div className="ai-summary-header">
          <span>AI COMMERCE</span>
          <span className="ai-live">LIVE</span>
        </div>

        <div className="ai-summary-value">
          {agent?.proposal?.addons?.length || 0}
        </div>

        <p>
          Active AI suggestions
        </p>

        <div className="ai-summary-divider"></div>

        <div className="ai-summary-row">
          <span>Pending approvals</span>
          <strong>{approvals.length}</strong>
        </div>

        <div className="ai-summary-row">
          <span>Orders completed</span>
          <strong>{orders.length}</strong>
        </div>

      </div>

    </section>


    {/* ================= WORKFLOW ================= */}

    <section className="workflow-panel">

      <div className="workflow-panel-header">

        <div>
          <span className="section-kicker">
            EXECUTION PIPELINE
          </span>

          <h3>
            Agent Workflow
          </h3>
        </div>

        <span className="workflow-status">
          Policy Controlled
        </span>

      </div>


      <div className="agent-workflow">

        <div className="workflow-node active">

          <div className="workflow-node-number">
            01
          </div>

          <div className="workflow-node-icon">
            ◎
          </div>

          <strong>
            AI Buyer
          </strong>

          <small>
            Intent
          </small>

        </div>


        <div className="workflow-connector">
          →
        </div>


        <div className="workflow-node">

          <div className="workflow-node-number">
            02
          </div>

          <div className="workflow-node-icon">
            ▦
          </div>

          <strong>
            Catalog
          </strong>

          <small>
            Discovery
          </small>

        </div>


        <div className="workflow-connector">
          →
        </div>


        <div className="workflow-node">

          <div className="workflow-node-number">
            03
          </div>

          <div className="workflow-node-icon">
            ✦
          </div>

          <strong>
            Suggest
          </strong>

          <small>
            Upsell
          </small>

        </div>


        <div className="workflow-connector">
          →
        </div>


        <div className="workflow-node">

          <div className="workflow-node-number">
            04
          </div>

          <div className="workflow-node-icon">
            ✓
          </div>

          <strong>
            Validate
          </strong>

          <small>
            Policy
          </small>

        </div>


        <div className="workflow-connector">
          →
        </div>


        <div className="workflow-node">

          <div className="workflow-node-number">
            05
          </div>

          <div className="workflow-node-icon">
            ◷
          </div>

          <strong>
            Approve
          </strong>

          <small>
            Human
          </small>

        </div>


        <div className="workflow-connector">
          →
        </div>


        <div className="workflow-node">

          <div className="workflow-node-number">
            06
          </div>

          <div className="workflow-node-icon">
            ₹
          </div>

          <strong>
            Pay
          </strong>

          <small>
            Razorpay
          </small>

        </div>

      </div>

    </section>


    {/* ================= INSIGHTS ================= */}

    <section className="dashboard-insights-section">

      <div className="dashboard-section-heading">

        <div>
          <span className="section-kicker">
            COMMAND CENTER
          </span>

          <h3>
            Today's Insights
          </h3>
        </div>

        <button
          onClick={() => navigateTo('analytics')}
        >
          Full Analytics →
        </button>

      </div>


      <div className="dashboard-insight-grid">

        {/* AI SUGGESTION */}

        <article className="dashboard-insight">

          <div className="insight-top">

            <div className="insight-symbol ai">
              ✦
            </div>

            <div>
              <span>
                GROWTH AI
              </span>

              <h4>
                Latest Recommendation
              </h4>
            </div>

          </div>

          <p>
            {agent?.proposal?.reasoning ||
              'Run Growth AI to discover policy-checked upsell opportunities for the current cart.'}
          </p>

          <button
            onClick={() => navigateTo('growth-ai')}
          >
            Open Recommendation →
          </button>

        </article>


        {/* APPROVALS */}

        <article className="dashboard-insight">

          <div className="insight-top">

            <div className="insight-symbol approval">
              ◷
            </div>

            <div>
              <span>
                HUMAN OVERSIGHT
              </span>

              <h4>
                Approval Queue
              </h4>
            </div>

          </div>

          <div className="approval-dashboard-number">
            {approvals.length}
            <small>pending actions</small>
          </div>

          <p>
            {approvals.length
              ? 'AI actions are waiting for merchant authorization.'
              : '✓ No actions are currently waiting for authorization.'}
          </p>

          <button
            onClick={() => navigateTo('approvals')}
          >
            Review Approvals →
          </button>

        </article>


        {/* SYSTEM STATUS */}

        <article className="dashboard-insight">

          <div className="insight-top">

            <div className="insight-symbol system">
              ◉
            </div>

            <div>
              <span>
                SYSTEM STATUS
              </span>

              <h4>
                Commerce Engine
              </h4>
            </div>

          </div>

          <div className="system-status-list">

            <div>
              <span>Growth Agent</span>
              <strong>Operational</strong>
            </div>

            <div>
              <span>Policy Engine</span>
              <strong>Operational</strong>
            </div>

            <div>
              <span>Payment Layer</span>
              <strong>Operational</strong>
            </div>

          </div>

          <button
            onClick={() => navigateTo('audit')}
          >
            View Audit Trail →
          </button>

        </article>

      </div>

    </section>

  </div>
)}
         {/* ==================================================
    PRODUCTS
================================================== */}

{activePage === 'catalog' && (
  <div className="page-view catalog-view">
    <MerchantCatalog
      products={merchantCatalog}
      onRefresh={refresh}
    />
  </div>
)}

{activePage === 'products' && (
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
          p.id ??
          p.product_id;

        const price =
          p.price ??
          p.price_inr;

        const qty =
          cart?.items?.find(
            (i) =>
              (i.id ?? i.product_id) === id
          )?.qty || 0;

        const wished =
          isInWishlist(id);

        return (
          <article
            className="product-card"
            key={id}
          >

            {/* ==================================================
                PRODUCT IMAGE
            ================================================== */}

            <div className="product-art">

              {p.image_url ? (
                <img
                  src={p.image_url}
                  alt={p.name}
                />
              ) : (
                <div className="product-image-placeholder">
                  No image
                </div>
              )}

              {/* Category */}
              <small className="product-category">
                {p.category}
              </small>

              {/* ==================================================
                  WISHLIST HEART
              ================================================== */}

              <button
                type="button"
                className={`wishlist-heart ${
                  wished ? 'active' : ''
                }`}
                onClick={() => toggleWishlist(id)}
                aria-label={
                  wished
                    ? `Remove ${p.name} from wishlist`
                    : `Add ${p.name} to wishlist`
                }
                title={
                  wished
                    ? 'Remove from wishlist'
                    : 'Add to wishlist'
                }
              >
                <svg
  width="21"
  height="21"
  viewBox="0 0 24 24"
  aria-hidden="true"
>
  <path
    d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"
    fill={wished ? '#26734d' : 'none'}
    stroke="#26734d"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
</svg>
              </button>

            </div>

            {/* ==================================================
                PRODUCT DETAILS
            ================================================== */}

            <div className="product-copy">

              <h3>
                {p.name}
              </h3>

              <p>
                {p.description}
              </p>

            </div>

            {/* ==================================================
                PRICE / STOCK
            ================================================== */}

            <div className="product-bottom">

              <b>
                {money(price)}
              </b>

              <small>
                {p.stock} in stock
              </small>

            </div>

            {/* ==================================================
                ADD TO CART
            ================================================== */}

            <button
              type="button"
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

                <AgentFlow mode="merchant" current={agent ? (agent.outcome?.status === 'pending' ? 2 : 4) : 0} />

                <AgentPanel
                  result={agent}
                  loading={loading}
                  onRun={run}
                  onSelectAddons={selectGrowthAddons}
                  onAddApproved={addBuyerToCart}
                  onRequestDiscount={requestGrowthDiscount}
                  maxDiscountPct={policies?.limits?.max_discount_pct ?? 10}
                />

                <AgentActivityFeed events={auditEvents} />

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
              <AIBuyer cartId={CART_ID} cart={cart} onRefresh={refresh} />
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

          {activePage === 'orders' && (
            <div className="page-view">
              <OrderHistory cartId={CART_ID} />
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

          {/* NEW BUYER PAGES */}
          {activePage === 'saved-carts' && (
            <div className="page-view">
              <SavedCarts cartId={CART_ID} />
            </div>
          )}

          {activePage === 'wishlist' && (
            <div className="page-view">
              <Wishlist cartId={CART_ID} catalog={catalog} />
            </div>
          )}

          {activePage === 'reviews' && (
            <div className="page-view">
              <Reviews cartId={CART_ID} orders={orders} />
            </div>
          )}

          {activePage === 'support' && (
            <div className="page-view">
              <Support cartId={CART_ID} />
            </div>
          )}

          {/* SALES ANALYTICS */}
{activePage === 'analytics' && (
  <div className="page-view">
    <section className="cart-panel analytics-page">

      {/* HEADER */}
      <header className="orders-header analytics-header">
        <div>
          <span className="section-kicker">MERCHANT INSIGHTS</span>
          <h2 className="orders-title">Sales Analytics</h2>
          <p className="analytics-subtitle">
            Monitor revenue, orders, and AI-assisted sales performance.
          </p>
        </div>

        <button
          className="analytics-refresh-btn"
          onClick={() => window.location.reload()}
        >
          ↻ Refresh
        </button>
      </header>

      {/* KPI CARDS */}
      <div className="analytics-dashboard">

        <div className="analytics-card revenue-card">
          <div className="analytics-card-top">
            <span className="analytics-label">TOTAL REVENUE</span>
            <span className="analytics-icon">₹</span>
          </div>

          <p className="analytics-value">
            {money(revenue?.total_test_revenue || 0)}
          </p>

          <div className="analytics-card-footer">
            <span className="analytics-positive">↑ Revenue generated</span>
          </div>
        </div>

        <div className="analytics-card">
          <div className="analytics-card-top">
            <span className="analytics-label">TOTAL ORDERS</span>
            <span className="analytics-icon">↗</span>
          </div>

          <p className="analytics-value">
            {orders.length}
          </p>

          <div className="analytics-card-footer">
            <span className="analytics-muted">
              Completed orders
            </span>
          </div>
        </div>

        <div className="analytics-card">
          <div className="analytics-card-top">
            <span className="analytics-label">AVERAGE ORDER VALUE</span>
            <span className="analytics-icon">⌁</span>
          </div>

          <p className="analytics-value">
            {money(revenue?.average_order_value || 0)}
          </p>

          <div className="analytics-card-footer">
            <span className="analytics-muted">
              Average per order
            </span>
          </div>
        </div>

        <div className="analytics-card ai-revenue-card">
          <div className="analytics-card-top">
            <span className="analytics-label">AI-ASSISTED REVENUE</span>
            <span className="analytics-icon ai-icon">✦</span>
          </div>

          <p className="analytics-value">
            {money(revenue?.ai_assisted_revenue || 0)}
          </p>

          <div className="analytics-card-footer">
            <span className="analytics-ai-badge">
              ✦ Growth AI
            </span>
          </div>
        </div>

      </div>

      {/* ANALYTICS GRID */}
      <div className="analytics-content-grid">

        {/* REVENUE OVERVIEW */}
        <div className="analytics-panel">
          <div className="analytics-panel-header">
            <div>
              <span className="analytics-panel-kicker">
                PERFORMANCE
              </span>
              <h3>Revenue Overview</h3>
            </div>

            <span className="analytics-period">
              All Time
            </span>
          </div>

          <div className="revenue-overview">
            <div className="revenue-main-value">
              {money(revenue?.total_test_revenue || 0)}
            </div>

            <p>
              Total revenue generated from successful orders
            </p>

            <div className="revenue-bar">
              <div
                className="revenue-bar-fill"
                style={{
                  width:
                    revenue?.total_test_revenue > 0
                      ? '78%'
                      : '0%'
                }}
              />
            </div>

            <div className="revenue-bar-labels">
              <span>Revenue</span>
              <span>
                {orders.length} orders
              </span>
            </div>
          </div>
        </div>

        {/* AI PERFORMANCE */}
        <div className="analytics-panel ai-performance-panel">
          <div className="analytics-panel-header">
            <div>
              <span className="analytics-panel-kicker">
                GROWTH AI
              </span>
              <h3>AI Performance</h3>
            </div>

            <span className="ai-status">
              ● Active
            </span>
          </div>

          <div className="ai-performance-content">

            <div className="ai-stat">
              <span>AI-Assisted Revenue</span>
              <strong>
                {money(revenue?.ai_assisted_revenue || 0)}
              </strong>
            </div>

            <div className="ai-stat">
              <span>AI Revenue Share</span>
              <strong>
                {revenue?.total_test_revenue > 0
                  ? `${Math.round(
                      ((revenue?.ai_assisted_revenue || 0) /
                        revenue.total_test_revenue) *
                        100
                    )}%`
                  : '0%'}
              </strong>
            </div>

            <div className="ai-progress">
              <div
                className="ai-progress-fill"
                style={{
                  width:
                    revenue?.total_test_revenue > 0
                      ? `${Math.min(
                          100,
                          ((revenue?.ai_assisted_revenue || 0) /
                            revenue.total_test_revenue) *
                            100
                        )}%`
                      : '0%'
                }}
              />
            </div>

            <p className="ai-performance-description">
              Revenue influenced by Growth AI recommendations
              and intelligent upselling.
            </p>

          </div>
        </div>

      </div>

      {/* ORDER PERFORMANCE */}
      <div className="analytics-panel order-performance-panel">

        <div className="analytics-panel-header">
          <div>
            <span className="analytics-panel-kicker">
              ORDER INSIGHTS
            </span>
            <h3>Order Performance</h3>
          </div>
        </div>

        <div className="order-stats-grid">

          <div className="order-stat-box">
            <span>Total Orders</span>
            <strong>{orders.length}</strong>
          </div>

          <div className="order-stat-box">
            <span>Average Order Value</span>
            <strong>
              {money(revenue?.average_order_value || 0)}
            </strong>
          </div>

          <div className="order-stat-box">
            <span>AI Assisted Orders</span>
            <strong>
              {orders.filter(
                order => order.ai_assisted
              ).length}
            </strong>
          </div>

          <div className="order-stat-box">
            <span>AI Conversion Share</span>
            <strong>
              {orders.length > 0
                ? `${Math.round(
                    (orders.filter(
                      order => order.ai_assisted
                    ).length /
                      orders.length) *
                      100
                  )}%`
                : '0%'}
            </strong>
          </div>

        </div>

      </div>

    </section>
  </div>
)}
          {activePage === 'segments' && (
  <div className="page-view">
    <section className="cart-panel segments-page">

      {/* Header */}
      <header className="orders-header segments-header">
        <div>
          <span className="section-kicker">CUSTOMER INSIGHTS</span>
          <h2 className="orders-title">Customer Segments</h2>
          <p className="page-description">
            Understand customer behavior and target the right users with AI-powered growth actions.
          </p>
        </div>

        <button className="secondary-button">
          ↻ Refresh Insights
        </button>
      </header>

      {/* Overview */}
      <div className="segments-overview">

        <div className="segment-overview-card">
          <div className="overview-icon">◉</div>
          <div>
            <span>Total Customers</span>
            <strong>1,248</strong>
            <small>+12.4% this month</small>
          </div>
        </div>

        <div className="segment-overview-card">
          <div className="overview-icon">₹</div>
          <div>
            <span>Avg. Customer Value</span>
            <strong>₹4,820</strong>
            <small>+8.7% this month</small>
          </div>
        </div>

        <div className="segment-overview-card">
          <div className="overview-icon">↗</div>
          <div>
            <span>AI Response Rate</span>
            <strong>68%</strong>
            <small>+5.2% this month</small>
          </div>
        </div>

        <div className="segment-overview-card">
          <div className="overview-icon">★</div>
          <div>
            <span>Repeat Customers</span>
            <strong>436</strong>
            <small>34.9% of customers</small>
          </div>
        </div>

      </div>

      {/* Segment Section */}
      <div className="segments-section">

        <div className="segments-section-header">
          <div>
            <h3>Customer Segments</h3>
            <p>Customers are automatically grouped based on their purchasing behavior.</p>
          </div>

          <span className="segment-count">
            4 segments
          </span>
        </div>

        <div className="segments-grid">

          {/* High Value */}
          <div className="customer-segment-card">

            <div className="segment-card-header">
              <div className="segment-icon high-value">
                ₹
              </div>

              <span className="segment-badge">
                High Value
              </span>
            </div>

            <h3>High Value Customers</h3>

            <p>
              Customers with total spending above ₹10,000.
            </p>

            <div className="segment-metrics">
              <div>
                <span>Customers</span>
                <strong>184</strong>
              </div>

              <div>
                <span>Share</span>
                <strong>14.7%</strong>
              </div>

              <div>
                <span>Avg. Spend</span>
                <strong>₹18.4K</strong>
              </div>
            </div>

            <div className="segment-progress">
              <div className="segment-progress-bar">
                <span style={{ width: '72%' }}></span>
              </div>
            </div>

            <div className="segment-card-footer">
              <span>Best target for premium offers</span>
              <button>View Customers →</button>
            </div>

          </div>


          {/* Frequent Buyers */}
          <div className="customer-segment-card">

            <div className="segment-card-header">
              <div className="segment-icon frequent">
                ↻
              </div>

              <span className="segment-badge">
                Frequent
              </span>
            </div>

            <h3>Frequent Buyers</h3>

            <p>
              Customers who have completed 5 or more orders.
            </p>

            <div className="segment-metrics">
              <div>
                <span>Customers</span>
                <strong>312</strong>
              </div>

              <div>
                <span>Share</span>
                <strong>25.0%</strong>
              </div>

              <div>
                <span>Avg. Orders</span>
                <strong>7.2</strong>
              </div>
            </div>

            <div className="segment-progress">
              <div className="segment-progress-bar">
                <span style={{ width: '58%' }}></span>
              </div>
            </div>

            <div className="segment-card-footer">
              <span>Strong retention opportunity</span>
              <button>View Customers →</button>
            </div>

          </div>


          {/* New Customers */}
          <div className="customer-segment-card">

            <div className="segment-card-header">
              <div className="segment-icon new-customer">
                +
              </div>

              <span className="segment-badge">
                New
              </span>
            </div>

            <h3>New Customers</h3>

            <p>
              Customers who have made their first purchase recently.
            </p>

            <div className="segment-metrics">
              <div>
                <span>Customers</span>
                <strong>428</strong>
              </div>

              <div>
                <span>Share</span>
                <strong>34.3%</strong>
              </div>

              <div>
                <span>Avg. Spend</span>
                <strong>₹2.1K</strong>
              </div>
            </div>

            <div className="segment-progress">
              <div className="segment-progress-bar">
                <span style={{ width: '82%' }}></span>
              </div>
            </div>

            <div className="segment-card-footer">
              <span>Best target for second-purchase offers</span>
              <button>View Customers →</button>
            </div>

          </div>


          {/* Growth Responsive */}
          <div className="customer-segment-card">

            <div className="segment-card-header">
              <div className="segment-icon growth">
                ✦
              </div>

              <span className="segment-badge">
                AI Responsive
              </span>
            </div>

            <h3>Growth Responsive</h3>

            <p>
              Customers who accepted AI-powered product recommendations.
            </p>

            <div className="segment-metrics">
              <div>
                <span>Customers</span>
                <strong>276</strong>
              </div>

              <div>
                <span>Share</span>
                <strong>22.1%</strong>
              </div>

              <div>
                <span>AI Conv.</span>
                <strong>68%</strong>
              </div>
            </div>

            <div className="segment-progress">
              <div className="segment-progress-bar">
                <span style={{ width: '68%' }}></span>
              </div>
            </div>

            <div className="segment-card-footer">
              <span>Best audience for AI upselling</span>
              <button>View Customers →</button>
            </div>

          </div>

        </div>
      </div>


      {/* AI Recommendation */}
      <div className="segments-ai-panel">

        <div className="ai-panel-icon">
          ✦
        </div>

        <div className="ai-panel-content">
          <span className="section-kicker">GROWTH AI</span>

          <h3>
            Recommended Growth Opportunity
          </h3>

          <p>
            Your <strong>428 new customers</strong> represent the largest
            segment. Targeting them with personalized second-purchase
            recommendations could increase repeat purchases.
          </p>
        </div>

        <button className="primary-button">
          Create AI Campaign →
        </button>

      </div>

    </section>
  </div>
)}

        {activePage === 'discount-rules' && (
  <div className="page-view">
    <section className="cart-panel discount-rules-page">

      {/* Header */}
      <header className="orders-header discount-rules-header">
        <div>
          <span className="section-kicker">AUTOMATION</span>
          <h2 className="orders-title">Discount Rules</h2>
          <p className="page-description">
            Configure automatic discount approval and AI upsell policies.
          </p>
        </div>

        <button className="primary-button add-rule-button">
          <span>＋</span>
          Add New Rule
        </button>
      </header>

      {/* Rule Summary */}
      <div className="rules-summary">
        <div className="rule-stat">
          <div className="rule-stat-icon">⚡</div>
          <div>
            <span className="rule-stat-label">Active Rules</span>
            <strong>3</strong>
          </div>
        </div>

        <div className="rule-stat">
          <div className="rule-stat-icon">✓</div>
          <div>
            <span className="rule-stat-label">Auto Approved</span>
            <strong>24</strong>
          </div>
        </div>

        <div className="rule-stat">
          <div className="rule-stat-icon">↗</div>
          <div>
            <span className="rule-stat-label">Approval Rate</span>
            <strong>87%</strong>
          </div>
        </div>
      </div>

      {/* Rules */}
      <div className="rules-section">

        <div className="rules-section-header">
          <div>
            <h3>Active Rules</h3>
            <p>Rules are evaluated automatically during checkout.</p>
          </div>

          <span className="rules-count">3 rules</span>
        </div>

        {/* Rule 1 */}
        <div className="discount-rule-card">

          <div className="rule-card-top">
            <div className="rule-title-area">
              <div className="rule-icon">%</div>

              <div>
                <h4>Standard Discount Approval</h4>
                <p>Automatically approve low-risk discounts</p>
              </div>
            </div>

            <div className="rule-actions">
              <span className="rule-status active">
                <span className="status-dot"></span>
                Active
              </span>

              <button className="icon-button" title="Edit rule">
                ✎
              </button>

              <button className="icon-button danger" title="Delete rule">
                ×
              </button>
            </div>
          </div>

          <div className="rule-condition">
            <span className="condition-label">IF</span>

            <div className="condition-chip">
              Discount <strong>≤ 5%</strong>
            </div>

            <span className="condition-operator">AND</span>

            <div className="condition-chip">
              Add-on Value <strong>≤ ₹2,000</strong>
            </div>

            <span className="condition-arrow">→</span>

            <div className="action-chip approve">
              ✓ Auto Approve
            </div>
          </div>

        </div>

        {/* Rule 2 */}
        <div className="discount-rule-card">

          <div className="rule-card-top">
            <div className="rule-title-area">
              <div className="rule-icon">₹</div>

              <div>
                <h4>High Value Cart</h4>
                <p>Require approval for high-value discounts</p>
              </div>
            </div>

            <div className="rule-actions">
              <span className="rule-status active">
                <span className="status-dot"></span>
                Active
              </span>

              <button className="icon-button" title="Edit rule">
                ✎
              </button>

              <button className="icon-button danger" title="Delete rule">
                ×
              </button>
            </div>
          </div>

          <div className="rule-condition">
            <span className="condition-label">IF</span>

            <div className="condition-chip">
              Cart Value <strong>≥ ₹5,000</strong>
            </div>

            <span className="condition-operator">AND</span>

            <div className="condition-chip">
              Discount <strong>&gt; 5%</strong>
            </div>

            <span className="condition-arrow">→</span>

            <div className="action-chip review">
              ⏳ Merchant Approval
            </div>
          </div>

        </div>

        {/* Rule 3 */}
        <div className="discount-rule-card">

          <div className="rule-card-top">
            <div className="rule-title-area">
              <div className="rule-icon">★</div>

              <div>
                <h4>AI Upsell Protection</h4>
                <p>Limit discounts generated by the Growth Agent</p>
              </div>
            </div>

            <div className="rule-actions">
              <span className="rule-status active">
                <span className="status-dot"></span>
                Active
              </span>

              <button className="icon-button" title="Edit rule">
                ✎
              </button>

              <button className="icon-button danger" title="Delete rule">
                ×
              </button>
            </div>
          </div>

          <div className="rule-condition">
            <span className="condition-label">IF</span>

            <div className="condition-chip">
              AI Discount <strong>≤ 10%</strong>
            </div>

            <span className="condition-operator">AND</span>

            <div className="condition-chip">
              AI Add-ons <strong>≤ 3</strong>
            </div>

            <span className="condition-arrow">→</span>

            <div className="action-chip approve">
              ✓ Allow AI Action
            </div>
          </div>

        </div>

      </div>

      {/* Empty / Add Rule CTA */}
      <div className="rule-footer">
        <div>
          <strong>Need another automation?</strong>
          <p>Create a custom rule for your Growth Agent.</p>
        </div>

        <button className="secondary-button">
          + Create Custom Rule
        </button>
      </div>

    </section>
  </div>
)}

         {activePage === 'settings' && (
  <div className="page-view">
    <section className="cart-panel settings-page">

      {/* HEADER */}
      <header className="orders-header settings-header">
        <div>
          <span className="section-kicker">CONFIGURATION</span>
          <h2 className="orders-title">Growth Agent Settings</h2>
          <p className="settings-subtitle">
            Configure how Growth AI recommends products, discounts,
            and cart expansions.
          </p>
        </div>

        <div className="settings-status">
          <span className="status-dot"></span>
          Agent Active
        </div>
      </header>

      {/* SETTINGS CONTENT */}
      <div className="settings-content">

        {/* GROWTH POLICY */}
        <div className="settings-section">

          <div className="settings-section-header">
            <div>
              <span className="settings-kicker">GROWTH POLICY</span>
              <h3>Recommendation Limits</h3>
              <p>
                Define the boundaries Growth AI must follow when
                generating recommendations.
              </p>
            </div>
          </div>

          <div className="settings-grid">

            <div className="setting-item">
              <label>
                Maximum Add-ons
                <span>?</span>
              </label>

              <p className="setting-description">
                Maximum number of products the agent can recommend.
              </p>

              <div className="input-with-unit">
                <input
                  type="number"
                  defaultValue={3}
                  min="1"
                  max="10"
                />
                <span>items</span>
              </div>
            </div>

            <div className="setting-item">
              <label>
                Maximum Discount
                <span>?</span>
              </label>

              <p className="setting-description">
                Maximum discount the Growth Agent can apply.
              </p>

              <div className="input-with-unit">
                <input
                  type="number"
                  defaultValue={15}
                  min="0"
                  max="50"
                />
                <span>%</span>
              </div>
            </div>

            <div className="setting-item">
              <label>
                Maximum Cart Increase
                <span>?</span>
              </label>

              <p className="setting-description">
                Maximum percentage increase allowed from AI
                recommendations.
              </p>

              <div className="input-with-unit">
                <input
                  type="number"
                  defaultValue={30}
                  min="0"
                  max="100"
                />
                <span>%</span>
              </div>
            </div>

          </div>
        </div>


        {/* CATEGORY PREFERENCES */}
        <div className="settings-section">

          <div className="settings-section-header">
            <div>
              <span className="settings-kicker">PRODUCT PREFERENCES</span>
              <h3>Preferred Categories</h3>
              <p>
                Select the product categories Growth AI should
                prioritize when generating recommendations.
              </p>
            </div>
          </div>

          <div className="category-options">

            <label className="category-option">
              <input type="checkbox" defaultChecked />
              <div>
                <strong>Cookware</strong>
                <span>Pans, pots and cooking equipment</span>
              </div>
            </label>

            <label className="category-option">
              <input type="checkbox" defaultChecked />
              <div>
                <strong>Knives</strong>
                <span>Kitchen knives and accessories</span>
              </div>
            </label>

            <label className="category-option">
              <input type="checkbox" defaultChecked />
              <div>
                <strong>Utensils</strong>
                <span>Kitchen tools and serving items</span>
              </div>
            </label>

          </div>
        </div>


        {/* AGENT BEHAVIOR */}
        <div className="settings-section">

          <div className="settings-section-header">
            <div>
              <span className="settings-kicker">AGENT BEHAVIOR</span>
              <h3>Automation Controls</h3>
              <p>
                Control how aggressively the Growth Agent operates.
              </p>
            </div>
          </div>

          <div className="automation-settings">

            <div className="automation-row">
              <div>
                <strong>Enable Growth Agent</strong>
                <span>
                  Allow AI to generate product recommendations.
                </span>
              </div>

              <label className="toggle">
                <input type="checkbox" defaultChecked />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div className="automation-row">
              <div>
                <strong>AI Upsell Recommendations</strong>
                <span>
                  Automatically suggest relevant add-ons during checkout.
                </span>
              </div>

              <label className="toggle">
                <input type="checkbox" defaultChecked />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div className="automation-row">
              <div>
                <strong>Require Merchant Approval</strong>
                <span>
                  Send recommendations above policy limits to approval.
                </span>
              </div>

              <label className="toggle">
                <input type="checkbox" defaultChecked />
                <span className="toggle-slider"></span>
              </label>
            </div>

          </div>
        </div>


        {/* SAVE AREA */}
        <div className="settings-footer">

          <div className="settings-save-info">
            <strong>Growth Agent Configuration</strong>
            <span>
              Changes will apply to future AI recommendations.
            </span>
          </div>

          <div className="settings-actions">
            <button
              className="secondary-button"
              onClick={() => window.location.reload()}
            >
              Reset
            </button>

            <button
              className="primary-button settings-save-button"
              onClick={() => {
                alert("Growth Agent settings saved successfully.");
              }}
            >
              Save Settings
            </button>
          </div>

        </div>

      </div>

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