const copy = {
  pending: ['PENDING MERCHANT APPROVAL', 'No cart changes have been made.'],
  approved: ['APPROVED AND APPLIED', 'The approved action was applied to the cart.'],
  rejected: ['PROPOSAL REJECTED', 'The cart was not changed.'],
  stale: ['PROPOSAL STALE', 'The cart changed, so this proposal was not applied.'],
  failed: ['PROPOSAL FAILED', 'The action was not applied.'],
};

export default function ApprovalStatus({ status = 'pending' }) {
  const [title, detail] = copy[status] || copy.pending;
  return <div className={`approval-status-banner ${status}`}><strong>{title}</strong><span>{detail}</span></div>;
}
