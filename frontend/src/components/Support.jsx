import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Support({ cartId }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [category, setCategory] = useState('Order Issue');
  const [message, setMessage] = useState('');

  const categories = [
    'Order Issue',
    'Payment Issue',
    'Product Question',
    'Refund',
    'Other'
  ];

  useEffect(() => {
    loadTickets();
  }, [cartId]);

  const loadTickets = async () => {
    try {
      setLoading(true);

      const data = await api(
        `/api/support/tickets/${cartId}`
      );

      setTickets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load tickets:', err);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTicket = async () => {
    if (!message.trim() || submitting) return;

    try {
      setSubmitting(true);

      await api('/api/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          cart_id: cartId,
          category,
          message: message.trim()
        })
      });

      setMessage('');
      setCategory('Order Issue');
      setShowNewTicketModal(false);

      await loadTickets();

    } catch (err) {
      console.error('Failed to create ticket:', err);
      alert('Failed to create support ticket');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusClass = (status) => {
    switch (String(status || '').toUpperCase()) {
      case 'OPEN':
        return 'support-status-open';

      case 'IN_PROGRESS':
        return 'support-status-progress';

      case 'RESOLVED':
        return 'support-status-resolved';

      default:
        return 'support-status-default';
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'Order Issue':
        return '◉';

      case 'Payment Issue':
        return '₹';

      case 'Product Question':
        return '?';

      case 'Refund':
        return '↩';

      default:
        return '•••';
    }
  };

  const openTickets = tickets.filter(
    t => String(t.status).toUpperCase() === 'OPEN'
  ).length;

  const inProgressTickets = tickets.filter(
    t => String(t.status).toUpperCase() === 'IN_PROGRESS'
  ).length;

  const resolvedTickets = tickets.filter(
    t => String(t.status).toUpperCase() === 'RESOLVED'
  ).length;


  /* ================= LOADING ================= */

  if (loading) {
    return (
      <div className="support-page">

        <div className="support-loading">
          <div className="support-spinner"></div>

          <p>
            Loading support center...
          </p>
        </div>

      </div>
    );
  }


  return (
    <div className="support-page">

      {/* ==================================================
          HEADER
      ================================================== */}

      <div className="support-header">

        <div>
          <span className="section-kicker">
            CUSTOMER SERVICE
          </span>

          <h2 className="support-title">
            Support Center
          </h2>

          <p className="support-subtitle">
            Get help with orders, payments, products and refunds.
          </p>
        </div>

        <button
          className="support-new-ticket"
          onClick={() => setShowNewTicketModal(true)}
        >
          <span>＋</span>
          New Ticket
        </button>

      </div>


      {/* ==================================================
          SUMMARY
      ================================================== */}

      <div className="support-summary">

        <div className="support-summary-card">

          <div className="support-summary-icon">
            ◎
          </div>

          <div>
            <span>ALL TICKETS</span>
            <strong>{tickets.length}</strong>
          </div>

        </div>


        <div className="support-summary-card">

          <div className="support-summary-icon open">
            ●
          </div>

          <div>
            <span>OPEN</span>
            <strong>{openTickets}</strong>
          </div>

        </div>


        <div className="support-summary-card">

          <div className="support-summary-icon progress">
            ◷
          </div>

          <div>
            <span>IN PROGRESS</span>
            <strong>{inProgressTickets}</strong>
          </div>

        </div>


        <div className="support-summary-card">

          <div className="support-summary-icon resolved">
            ✓
          </div>

          <div>
            <span>RESOLVED</span>
            <strong>{resolvedTickets}</strong>
          </div>

        </div>

      </div>


      {/* ==================================================
          TICKETS
      ================================================== */}

      <section className="support-section">

        <div className="support-section-header">

          <div>
            <span className="section-kicker">
              YOUR REQUESTS
            </span>

            <h3>
              Support Tickets
            </h3>
          </div>

          <button
            className="support-refresh"
            onClick={loadTickets}
          >
            ↻ Refresh
          </button>

        </div>


        {tickets.length === 0 ? (

          /* ================= EMPTY STATE ================= */

          <div className="support-empty">

            <div className="support-empty-icon">
              ?
            </div>

            <h3>
              No support tickets
            </h3>

            <p>
              You haven't created any support requests yet.
              If you need help, create a new ticket and our
              team will assist you.
            </p>

            <button
              className="support-empty-button"
              onClick={() => setShowNewTicketModal(true)}
            >
              Create Your First Ticket →
            </button>

          </div>

        ) : (

          /* ================= TICKET LIST ================= */

          <div className="support-ticket-list">

            {tickets.map((ticket) => (

              <article
                key={ticket.id}
                className="support-ticket-card"
              >

                <div className="support-ticket-main">

                  {/* ICON */}

                  <div className="ticket-category-icon">
                    {getCategoryIcon(ticket.category)}
                  </div>


                  {/* CONTENT */}

                  <div className="support-ticket-content">

                    <div className="support-ticket-title-row">

                      <div>

                        <span className="ticket-number">
                          TICKET #{ticket.id}
                        </span>

                        <h4>
                          {ticket.category}
                        </h4>

                      </div>

                      <span
                        className={`support-ticket-status ${getStatusClass(
                          ticket.status
                        )}`}
                      >
                        <span className="status-dot"></span>

                        {String(ticket.status || 'OPEN').replace(
                          '_',
                          ' '
                        )}

                      </span>

                    </div>


                    <p className="support-ticket-message">
                      {ticket.message}
                    </p>


                    <div className="support-ticket-meta">

                      <span>
                        Created{' '}
                        {new Date(
                          ticket.created_at
                        ).toLocaleString()}
                      </span>

                      {ticket.updated_at &&
                        ticket.updated_at !== ticket.created_at && (
                          <span>
                            Updated{' '}
                            {new Date(
                              ticket.updated_at
                            ).toLocaleString()}
                          </span>
                        )}

                    </div>

                  </div>

                </div>

              </article>

            ))}

          </div>

        )}

      </section>


      {/* ==================================================
          HELP CARD
      ================================================== */}

      <section className="support-help-card">

        <div className="support-help-icon">
          ✦
        </div>

        <div className="support-help-content">

          <span className="section-kicker">
            NEED ASSISTANCE?
          </span>

          <h3>
            We're here to help.
          </h3>

          <p>
            For payment failures, order issues or refund
            requests, create a support ticket and include
            as much detail as possible.
          </p>

        </div>

        <button
          onClick={() => setShowNewTicketModal(true)}
        >
          Contact Support →
        </button>

      </section>


      {/* ==================================================
          NEW TICKET MODAL
      ================================================== */}

      {showNewTicketModal && (

        <div
          className="support-modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShowNewTicketModal(false);
            }
          }}
        >

          <div className="support-modal">

            {/* HEADER */}

            <div className="support-modal-header">

              <div>

                <span className="section-kicker">
                  CUSTOMER SERVICE
                </span>

                <h3>
                  Create Support Ticket
                </h3>

              </div>

              <button
                className="support-modal-close"
                onClick={() => setShowNewTicketModal(false)}
              >
                ×
              </button>

            </div>


            {/* FORM */}

            <div className="support-form">

              <div className="support-form-group">

                <label>
                  Issue Category
                </label>

                <select
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value)
                  }
                  className="support-select"
                >

                  {categories.map((cat) => (
                    <option
                      key={cat}
                      value={cat}
                    >
                      {cat}
                    </option>
                  ))}

                </select>

              </div>


              <div className="support-form-group">

                <div className="support-label-row">

                  <label>
                    Describe your issue
                  </label>

                  <span>
                    {message.length}/1000
                  </span>

                </div>

                <textarea
                  value={message}
                  onChange={(e) =>
                    setMessage(e.target.value)
                  }
                  placeholder="Tell us what happened and how we can help..."
                  className="support-textarea"
                  maxLength={1000}
                  rows={6}
                />

              </div>


              <div className="support-modal-actions">

                <button
                  className="support-cancel-button"
                  onClick={() =>
                    setShowNewTicketModal(false)
                  }
                  disabled={submitting}
                >
                  Cancel
                </button>

                <button
                  className="support-submit-button"
                  onClick={handleCreateTicket}
                  disabled={
                    submitting ||
                    !message.trim()
                  }
                >
                  {submitting
                    ? 'Submitting...'
                    : 'Submit Ticket →'}
                </button>

              </div>

            </div>

          </div>

        </div>

      )}

    </div>
  );
}