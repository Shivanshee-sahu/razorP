const labels = {
  REQUEST: 'Buyer request received',
  MODIFY_CART: 'Cart modified',
  Analyze: 'Growth Agent analyzed cart',
  Suggest: 'Growth opportunity proposed',
  Validate: 'Policy validation completed',
  Gate: 'Approval gate evaluated',
  Execute: 'Agent action executed',
  CHECKOUT: 'Checkout event recorded',
};

export default function AgentActivityFeed({ events = [], limit = 6 }) {
  const visibleEvents = events.slice(0, limit);
  return (
    <section className="activity-feed">
      <div className="section-kicker">AGENT ACTIVITY</div>
      {!visibleEvents.length ? (
        <p className="activity-empty">No agent events recorded for this cart yet.</p>
      ) : (
        <div className="activity-list">
          {visibleEvents.map((event) => (
            <article className="activity-event" key={event.id || `${event.stage}-${event.created_at}`}>
              <span className={`activity-dot ${event.kind || ''}`} />
              <div>
                <strong>{labels[event.stage] || labels[event.kind] || event.stage || 'System event'}</strong>
                <p>{event.detail}</p>
              </div>
              <time>{event.created_at ? new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</time>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
