import React, { useState } from 'react';

export default function AgentTestLabPage() {
  const [activeSimulation, setActiveSimulation] = useState(null);

  const runSimulation = async (scenario) => {
    const res = await fetch(`/api/test/failure/${scenario}`, { method: 'POST' });
    const data = await res.json();
    setActiveSimulation(data);
  };

  return (
    <div className="page-container">
      <h1>AGENT TEST LAB</h1>
      <p>Demonstrate graceful failure handling and system recovery.</p>

      <div className="button-grid">
        <button className="btn-secondary" onClick={() => runSimulation('payment_failure')}>Payment Failure</button>
        <button className="btn-secondary" onClick={() => runSimulation('ai_timeout')}>AI Timeout</button>
        <button className="btn-secondary" onClick={() => runSimulation('inventory_unavailable')}>Inventory Unavailable</button>
        <button className="btn-secondary" onClick={() => runSimulation('discount_rejected')}>Discount Rejected</button>
        <button className="btn-secondary" onClick={() => runSimulation('human_approval_rejected')}>Approval Rejected</button>
      </div>

      {activeSimulation && (
        <div className="card simulation-result">
          <h3>SIMULATION RESULTS</h3>
          <p><strong>Step:</strong> {activeSimulation.step}</p>
          <p><strong>Status:</strong> <span className="badge warning">{activeSimulation.status}</span></p>
          <p><strong>Recovery Detail:</strong> {activeSimulation.detail}</p>
        </div>
      )}
    </div>
  );
}