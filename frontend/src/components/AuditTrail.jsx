import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const icons = {
  ok: '✓',
  warn: '!',
  blocked: '×',
  pending: '◷',
  executed: '✓',
};

const labels = {
  ok: 'Completed',
  warn: 'Warning',
  blocked: 'Blocked',
  pending: 'Pending',
  executed: 'Executed',
};

export default function AuditTrail({ cartId }) {
  const [logs, setLogs] = useState([]);
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const data = await api(`/api/audit/${cartId}`);

        if (mounted) {
          setLogs(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      } catch {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    load();

    const interval = setInterval(load, 2500);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [cartId]);

  const filteredLogs = useMemo(() => {
    if (filter === 'all') return logs;

    return logs.filter((log) => log.kind === filter);
  }, [logs, filter]);

  const stats = useMemo(() => {
    return {
      total: logs.length,
      success: logs.filter(
        (log) => log.kind === 'ok' || log.kind === 'executed'
      ).length,
      warnings: logs.filter((log) => log.kind === 'warn').length,
      blocked: logs.filter((log) => log.kind === 'blocked').length,
      pending: logs.filter((log) => log.kind === 'pending').length,
    };
  }, [logs]);

  return (
    <section className="audit-page-panel">

      {/* HEADER */}
      <header className="audit-header">
        <div className="audit-title-group">
          <div className="audit-live-indicator">
            <span></span>
            LIVE
          </div>

          <p className="section-kicker">
            GOVERNANCE & OBSERVABILITY
          </p>

          <h2>Audit trail</h2>

          <p className="audit-subtitle">
            Every AI recommendation, policy decision, approval and payment
            action is recorded here.
          </p>
        </div>

        <div className="audit-header-actions">
          <div className="audit-event-count">
            <strong>{logs.length}</strong>
            <span>events</span>
          </div>

          <button
            className="audit-toggle"
            onClick={() => setOpen(!open)}
          >
            {open ? 'Collapse' : 'Expand'}
            <span>{open ? '↑' : '↓'}</span>
          </button>
        </div>
      </header>

      {/* STATISTICS */}
      <div className="audit-stats">

        <div className="audit-stat">
          <span className="audit-stat-icon neutral">◌</span>
          <div>
            <small>Total events</small>
            <strong>{stats.total}</strong>
          </div>
        </div>

        <div className="audit-stat">
          <span className="audit-stat-icon success">✓</span>
          <div>
            <small>Successful</small>
            <strong>{stats.success}</strong>
          </div>
        </div>

        <div className="audit-stat">
          <span className="audit-stat-icon warning">!</span>
          <div>
            <small>Warnings</small>
            <strong>{stats.warnings}</strong>
          </div>
        </div>

        <div className="audit-stat">
          <span className="audit-stat-icon blocked">×</span>
          <div>
            <small>Blocked</small>
            <strong>{stats.blocked}</strong>
          </div>
        </div>

        <div className="audit-stat">
          <span className="audit-stat-icon pending">◷</span>
          <div>
            <small>Pending</small>
            <strong>{stats.pending}</strong>
          </div>
        </div>

      </div>

      {/* CONTENT */}
      {open && (
        <div className="audit-content">

          {/* FILTER BAR */}
          <div className="audit-toolbar">

            <div>
              <h3>System activity</h3>
              <p>
                Real-time record of the growth agent workflow
              </p>
            </div>

            <div className="audit-filters">
              {[
                ['all', 'All'],
                ['ok', 'Success'],
                ['executed', 'Executed'],
                ['warn', 'Warnings'],
                ['blocked', 'Blocked'],
                ['pending', 'Pending'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? 'active' : ''}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>

          </div>

          {/* TIMELINE */}
          <div className="audit-timeline">

            {loading ? (
              <div className="audit-empty">
                <div className="audit-loading-spinner"></div>
                <h3>Loading audit events...</h3>
                <p>Connecting to the live system record.</p>
              </div>
            ) : !filteredLogs.length ? (
              <div className="audit-empty">
                <div className="audit-empty-icon">◌</div>
                <h3>No events found</h3>
                <p>
                  Agent decisions, approvals and payment activity
                  will appear here automatically.
                </p>
              </div>
            ) : (
              filteredLogs.map((log, index) => {

                const kind = log.kind || 'ok';

                return (
                  <article
                    className={`audit-event audit-${kind}`}
                    key={log.id || index}
                  >

                    {/* TIMELINE LINE */}
                    <div className="audit-marker-column">
                      <div className="audit-marker">
                        {icons[kind] || '•'}
                      </div>

                      {index !== filteredLogs.length - 1 && (
                        <div className="audit-line"></div>
                      )}
                    </div>

                    {/* EVENT */}
                    <div className="audit-event-body">

                      <div className="audit-event-top">

                        <div className="audit-event-stage">
                          <h4>{log.stage}</h4>

                          <span className={`audit-kind ${kind}`}>
                            {labels[kind] || kind}
                          </span>
                        </div>

                        <time>
                          {log.created_at
                            ? new Date(log.created_at).toLocaleTimeString(
                                'en-IN',
                                {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                }
                              )
                            : '--:--:--'}
                        </time>

                      </div>

                      <p className="audit-event-detail">
                        {log.detail}
                      </p>

                      <div className="audit-event-meta">
                        <span>
                          EVENT #{log.id ?? index + 1}
                        </span>

                        <span>
                          CART · {cartId}
                        </span>
                      </div>

                    </div>

                  </article>
                );
              })
            )}

          </div>

        </div>
      )}

    </section>
  );
}