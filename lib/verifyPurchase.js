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

// Two products (landing pages, Pinterest pins) now share one order-number
// verification flow -- this figures out which one a receipt actually paid
// for, by checking its transactions against each configured listing ID in
// turn. Returns null if the receipt (or a not-yet-configured listing, e.g.
// ETSY_PIN_PRODUCT_LISTING_ID unset) matches neither, so the caller falls
// through to the existing "doesn't match a LaunchNestAI purchase" error.
export function matchProductListing(receipt, productListings) {
  if (!receipt) return null;
  const transactionListingIds = (receipt.transactions || []).map(t => String(t.listing_id));
  for (const entry of productListings) {
    if (entry.listingId == null) continue;
    if (transactionListingIds.includes(String(entry.listingId))) {
      return entry;
    }
  }
  return null;
}

export function evaluateReceipt({ receipt, listingId, claimedByOtherUser, shopNameQuestionId, madeToOrderEnabled = false, cutoverAt = null }) {
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

  if (madeToOrderEnabled && cutoverAt && receipt.create_timestamp != null && receipt.create_timestamp * 1000 >= new Date(cutoverAt).getTime()) {
    return {
      ok: false,
      status: 422,
      message: 'This order is being custom-made for you — check your Etsy messages for updates, or contact support if you have questions.',
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
