import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Support({ cartId }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
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
      const data = await api(`/api/support/tickets/${cartId}`);
      setTickets(data);
    } catch (err) {
      console.error('Failed to load tickets:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTicket = async () => {
    if (!message.trim()) return;

    try {
      await api('/api/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          cart_id: cartId,
          category,
          message
        })
      });
      setMessage('');
      setShowNewTicketModal(false);
      loadTickets();
    } catch (err) {
      console.error('Failed to create ticket:', err);
      alert('Failed to create support ticket');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'OPEN': return 'status-open';
      case 'IN_PROGRESS': return 'status-in-progress';
      case 'RESOLVED': return 'status-resolved';
      default: return '';
    }
  };

  if (loading) {
    return <div className="support">Loading...</div>;
  }

  return (
    <div className="support">
      <div className="section-header">
        <h2>Customer Support</h2>
        <button
          onClick={() => setShowNewTicketModal(true)}
          className="primary-button"
        >
          New Ticket
        </button>
      </div>

      {showNewTicketModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>Create Support Ticket</h3>
            
            <div className="form-group">
              <label>Category:</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="select-field"
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            
            <div className="form-group">
              <label>Message:</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe your issue..."
                className="textarea-field"
                maxLength="1000"
              />
            </div>
            
            <div className="modal-actions">
              <button onClick={() => setShowNewTicketModal(false)}>Cancel</button>
              <button onClick={handleCreateTicket} className="primary-button">Submit Ticket</button>
            </div>
          </div>
        </div>
      )}

      {tickets.length === 0 ? (
        <div className="empty-state">
          <p>No support tickets. Create a ticket if you need help.</p>
        </div>
      ) : (
        <div className="tickets-list">
          {tickets.map((ticket) => (
            <div key={ticket.id} className="ticket-card">
              <div className="ticket-header">
                <div>
                  <h3>#{ticket.id} - {ticket.category}</h3>
                  <p className="ticket-date">{new Date(ticket.created_at).toLocaleString()}</p>
                </div>
                <span className={`ticket-status ${getStatusColor(ticket.status)}`}>
                  {ticket.status}
                </span>
              </div>
              <p className="ticket-message">{ticket.message}</p>
              {ticket.updated_at !== ticket.created_at && (
                <p className="ticket-updated">Updated: {new Date(ticket.updated_at).toLocaleString()}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}