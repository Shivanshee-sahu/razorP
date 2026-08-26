import React from 'react';

export default function DecisionTrace({ itemsCount = 0, budget = 0, subtotal = 0, requiresApproval = false, threshold = 2000 }) {
  return (
    <div className="card decision-trace">
      <h4>DECISION TRACE</h4>
      <div className="trace-list">
        <div className="trace-item"><span className="check success">✓</span> Cart analyzed ({itemsCount} items selected)</div>
        {budget > 0 && <div className="trace-item"><span className="check success">✓</span> Buyer constraints (Budget: ₹{budget.toLocaleString('en-IN')})</div>}
        <div className="trace-item"><span className="check success">✓</span> Catalog searched & stock verified</div>
        <div className="trace-item"><span className="check success">✓</span> Budget validation (₹{subtotal.toLocaleString('en-IN')} ≤ ₹{budget || 'N/A'})</div>
        
        {requiresApproval ? (
          <div className="trace-item warning-box">
            <span className="check warning">⚠</span>
            <div>
              <strong>Action value: ₹{subtotal.toLocaleString('en-IN')}</strong>
              <p>Exceeds automatic threshold of ₹{threshold.toLocaleString('en-IN')}</p>
              <span className="highlight-text">→ Human approval required</span>
            </div>
          </div>
        ) : (
          <div className="trace-item"><span className="check success">✓</span> Policy validation approved</div>
        )}
      </div>
    </div>
  );
}