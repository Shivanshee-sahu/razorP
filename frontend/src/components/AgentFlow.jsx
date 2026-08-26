const buyerSteps = ['AI Buyer', 'Catalog', 'Recommend', 'Cart', 'Checkout'];
const merchantSteps = ['Growth Agent', 'Policy', 'Approval', 'Payment', 'Order'];

export default function AgentFlow({ mode = 'buyer', current = 0 }) {
  const steps = mode === 'merchant' ? merchantSteps : buyerSteps;
  return (
    <section className={`agent-flow agent-flow-${mode}`} aria-label={`${mode} journey`}>
      <div className="agent-flow-label">{mode === 'merchant' ? 'MERCHANT CONTROL LOOP' : 'AGENT-TO-AGENT JOURNEY'}</div>
      <div className="agent-flow-steps">
        {steps.map((step, index) => (
          <div className={`agent-flow-step ${index <= current ? 'complete' : ''}`} key={step}>
            <span>{index <= current ? '✓' : String(index + 1).padStart(2, '0')}</span>
            <b>{step}</b>
            {index < steps.length - 1 && <i aria-hidden="true">→</i>}
          </div>
        ))}
      </div>
    </section>
  );
}
