export function evaluateReceipt({ receipt, listingId, claimedByOtherUser }) {
  if (claimedByOtherUser) {
    return {
      ok: false,
      status: 409,
      message: 'This order number has already been used to activate another account.',
    };
  }

  if (!receipt) {
    return {
      ok: false,
      status: 404,
      message: "We couldn't find that order number — double-check it and try again.",
    };
  }

  if (!receipt.is_paid) {
    return {
      ok: false,
      status: 422,
      message: "That order hasn't completed payment yet.",
    };
  }

  if (receipt.status === 'canceled' || receipt.status === 'fully refunded') {
    return {
      ok: false,
      status: 422,
      message: 'That order is no longer valid (refunded or canceled).',
    };
  }

  const hasListing = (receipt.transactions || []).some(
    t => String(t.listing_id) === String(listingId)
  );
  if (!hasListing) {
    return {
      ok: false,
      status: 422,
      message: "That order doesn't include the LaunchNestAI product.",
    };
  }

  return { ok: true };
}
