// The buyer's shop name is collected as a required Etsy personalization
// question on the listing (question_text "Your Etsy Shop Name") -- this
// reads their answer back off the transaction so it can be saved without an
// admin re-entering it by hand.
export function extractShopNameFromReceipt(receipt, listingId, shopNameQuestionId) {
  if (!receipt || !shopNameQuestionId) return null;
  const transaction = (receipt.transactions || []).find(
    t => String(t.listing_id) === String(listingId)
  );
  const variation = (transaction?.variations || []).find(
    v => String(v.question_id) === String(shopNameQuestionId)
  );
  const value = variation?.formatted_value?.trim();
  return value || null;
}

export function evaluateReceipt({ receipt, listingId, claimedByOtherUser, shopNameQuestionId }) {
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

  return {
    ok: true,
    shopName: extractShopNameFromReceipt(receipt, listingId, shopNameQuestionId),
    // Etsy's own buyer account ID -- unlike the shop-name personalization
    // answer, this can't be mistyped, so it's what a repurchase gets matched
    // against later instead of asking the buyer to retype an order number.
    buyerUserId: receipt.buyer_user_id ?? null,
  };
}
