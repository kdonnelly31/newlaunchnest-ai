// Pure functions that turn a raw Etsy receipt + one of its transactions
// into the fields made-to-order intake stores, with no network or database
// access -- keeps every decision here fully unit-testable, the same way
// verifyPurchase.js's evaluateReceipt() stays separate from the fetch that
// gets a receipt in the first place.

export function derivePaymentState(receipt) {
  if (receipt.status === 'canceled') return 'canceled';
  if (receipt.status === 'fully refunded') return 'refunded';
  if (receipt.is_paid) return 'paid';
  return 'pending';
}

export function isReceiptBeforeCutover(receipt, cutoverAt) {
  return receipt.create_timestamp * 1000 < new Date(cutoverAt).getTime();
}

// Personalization answers are TransactionVariations entries with
// property_id 54 (confirmed against Etsy's published OpenAPI schema) --
// other entries in the same array are ordinary product variations (size,
// color) that were never typed by the buyer as a personalization answer.
export function extractPersonalizationAnswers(transaction) {
  return (transaction.variations || [])
    .filter(v => String(v.property_id) === '54')
    .map(v => ({
      questionId: v.question_id ?? null,
      formattedName: v.formatted_name ?? null,
      formattedValue: v.formatted_value,
    }));
}

// Returns null when the transaction isn't for the watched listing, or the
// receipt has never been paid (nothing to import yet). Deliberately omits
// needsAttention/attentionReason/resolvedListing* -- those depend on the
// personalization answers and product-link resolution, computed by the
// caller (lib/etsySync.js) once both are known.
export function deriveOrderFromTransaction({ receipt, transaction, listingId, shopId }) {
  if (String(transaction.listing_id) !== String(listingId)) return null;
  if (!receipt.is_paid) return null;

  return {
    shopId,
    receiptId: receipt.receipt_id,
    transactionId: transaction.transaction_id,
    listingId: transaction.listing_id,
    quantity: transaction.quantity ?? 1,
    buyerEtsyUserId: receipt.buyer_user_id ?? null,
    // Etsy's shipping-recipient name, not an account username -- the
    // closest thing to a buyer display name this scope of API access
    // exposes.
    buyerDisplayName: receipt.name ?? null,
    receiptCreatedAt: new Date(receipt.create_timestamp * 1000).toISOString(),
    paymentState: derivePaymentState(receipt),
  };
}

// Priority order matters: a multi-unit purchase is flagged regardless of
// what else is true about it, since the spec explicitly requires never
// silently ignoring quantity > 1.
export function deriveAttentionReason({ quantity, mappedAnswers, productUnclear, anyAssetFailed }) {
  if (quantity > 1) return 'multiple_units';
  const hasProductUrl = mappedAnswers.some(a => a.mappedField === 'product_url');
  if (!hasProductUrl) return 'missing_information';
  if (productUnclear) return 'product_unclear';
  if (anyAssetFailed) return 'asset_unavailable';
  if (mappedAnswers.some(a => a.mappedField === 'unmapped')) return 'unmapped_personalization';
  return null;
}

export function parseEtsyProductUrl(rawValue) {
  if (!rawValue) return null;
  let url;
  try {
    url = new URL(rawValue.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!/^(www\.)?etsy\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/\/listing\/(\d+)/);
  if (!match) return null;
  return { listingId: match[1] };
}
