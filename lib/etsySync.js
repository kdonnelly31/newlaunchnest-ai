import { deriveOrderFromTransaction, extractPersonalizationAnswers, deriveAttentionReason, parseEtsyProductUrl, isReceiptBeforeCutover, derivePaymentState } from './mtoOrders.js';
import { mapAnswer, MAPPING_VERSION } from './mtoFieldMapping.js';

const OVERLAP_MS = 60 * 60 * 1000; // 1 hour -- survives receipts arriving slightly out of creation order
const RECONCILE_WINDOW_MS = 72 * 60 * 60 * 1000; // 3 days -- catches a cancellation/refund on an older order
const MAX_PAGES_PER_RUN = 10; // bounds each invocation to stay inside the serverless function time limit
const PAGE_LIMIT = 100;
const LOCK_STALE_MS = 5 * 60 * 1000; // a lock older than this is treated as an abandoned/crashed run

export async function syncMadeToOrderReceipts({
  listReceipts,
  resolveListing,
  importAndStoreAsset,
  store,
  listingId,
  shopId,
  cutoverAt,
  trigger,
  now = () => new Date(),
}) {
  const runStartedAt = now();
  // The lock decision has to happen in ONE conditional database operation:
  // a read-then-write would let two concurrent runs both see an unlocked row
  // and both proceed, double-inserting answers and re-downloading assets
  // (mto_personalization_answers/mto_assets have no unique constraint to
  // catch that, unlike mto_orders).
  const staleBeforeIso = new Date(runStartedAt.getTime() - LOCK_STALE_MS).toISOString();
  const { acquired } = await store.acquireLock({ nowIso: runStartedAt.toISOString(), staleBeforeIso });
  if (!acquired) {
    return { skipped: true, reason: 'already_running' };
  }
  const state = await store.getSyncState();

  const summary = { receiptsSeen: 0, ordersCreated: 0, ordersUpdated: 0 };
  let errorMessage = null;

  try {
    const cursor = state.cursorMinCreated ? new Date(state.cursorMinCreated) : new Date(cutoverAt);
    const windowStart = new Date(cursor.getTime() - OVERLAP_MS);
    let latestSeenCreated = cursor;

    let offset = 0;
    for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      const { receipts } = await listReceipts({ minCreated: windowStart, limit: PAGE_LIMIT, offset });
      summary.receiptsSeen += receipts.length;
      for (const receipt of receipts) {
        const receiptCreated = new Date(receipt.create_timestamp * 1000);
        if (receiptCreated > latestSeenCreated) latestSeenCreated = receiptCreated;
        if (isReceiptBeforeCutover(receipt, cutoverAt)) continue;
        await processReceipt({ receipt, listingId, shopId, store, resolveListing, importAndStoreAsset, summary });
      }
      if (receipts.length < PAGE_LIMIT) break;
      offset += PAGE_LIMIT;
    }

    await reconcile({ listReceipts, listingId, store, runStartedAt, summary });

    await store.saveCursor(latestSeenCreated.toISOString());
  } catch (err) {
    // A non-Error throw (string, plain object, undefined) has no .message;
    // without the fallback errorMessage stays falsy and the run would be
    // recorded and returned as a success despite having failed.
    errorMessage = err?.message || String(err);
  }

  await store.recordSyncRun({
    startedAt: runStartedAt.toISOString(),
    finishedAt: now().toISOString(),
    trigger,
    receiptsSeen: summary.receiptsSeen,
    ordersCreated: summary.ordersCreated,
    ordersUpdated: summary.ordersUpdated,
    error: errorMessage,
  });
  await store.releaseLock();

  if (errorMessage) throw new Error(errorMessage);
  return { skipped: false, ...summary };
}

async function processReceipt({ receipt, listingId, shopId, store, resolveListing, importAndStoreAsset, summary }) {
  for (const transaction of receipt.transactions || []) {
    const orderFields = deriveOrderFromTransaction({ receipt, transaction, listingId, shopId });
    if (!orderFields) continue;

    const existing = await store.getOrderByTransactionId(orderFields.transactionId);
    if (existing) continue; // already imported; the reconciliation pass handles state changes

    const rawAnswers = extractPersonalizationAnswers(transaction);
    const mappedAnswers = rawAnswers.map(answer => ({
      ...answer,
      mappedField: mapAnswer(answer),
      mappingVersion: MAPPING_VERSION,
    }));

    const productUrlAnswer = mappedAnswers.find(a => a.mappedField === 'product_url');
    let resolvedListingId = null;
    let resolvedListingSnapshot = null;
    let productUnclear = false;
    if (productUrlAnswer) {
      const parsed = parseEtsyProductUrl(productUrlAnswer.formattedValue);
      const snapshot = parsed ? await resolveListing(parsed.listingId) : null;
      if (snapshot) {
        resolvedListingId = parsed.listingId;
        resolvedListingSnapshot = snapshot;
      } else {
        productUnclear = true;
      }
    }

    const assetAnswers = mappedAnswers.filter(a => a.mappedField === 'assets');
    const assetResults = [];
    for (const answer of assetAnswers) {
      const result = await importAndStoreAsset(orderFields.transactionId, answer.formattedValue);
      assetResults.push({ sourceUrl: answer.formattedValue, ...result });
    }
    const anyAssetFailed = assetResults.some(a => a.status === 'failed');

    const attentionReason = deriveAttentionReason({
      quantity: orderFields.quantity,
      mappedAnswers,
      productUnclear,
      anyAssetFailed,
    });

    const { id: orderId } = await store.upsertOrder({
      ...orderFields,
      needsAttention: attentionReason !== null,
      attentionReason,
      resolvedListingId,
      resolvedListingSnapshot,
    });
    summary.ordersCreated += 1;

    if (mappedAnswers.length > 0) {
      await store.insertAnswers(orderId, mappedAnswers);
    }
    for (const asset of assetResults) {
      await store.insertAsset(orderId, asset);
    }
  }
}

async function reconcile({ listReceipts, listingId, store, runStartedAt, summary }) {
  let offset = 0;
  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    const { receipts } = await listReceipts({
      minLastModified: new Date(runStartedAt.getTime() - RECONCILE_WINDOW_MS),
      maxLastModified: runStartedAt,
      limit: PAGE_LIMIT,
      offset,
    });
    for (const receipt of receipts) {
      for (const transaction of receipt.transactions || []) {
        if (String(transaction.listing_id) !== String(listingId)) continue;
        const existing = await store.getOrderByTransactionId(transaction.transaction_id);
        if (!existing) continue;

        const paymentState = derivePaymentState(receipt);
        if (paymentState !== existing.paymentState) {
          await store.updatePaymentState(existing.id, paymentState);
          summary.ordersUpdated += 1;
        }
      }
    }
    if (receipts.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }
}
