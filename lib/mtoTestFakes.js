// lib/mtoTestFakes.js
// A tiny in-memory stand-in for the real Supabase-backed store, used by
// lib/etsySync.test.js -- avoids needing a mocking library, matching the
// rest of this codebase's dependency-injection style (see getValidEtsyToken
// in lib/etsyOAuth.js, which takes supabaseAdmin as a plain parameter).
export function createFakeStore({ cursorMinCreated = null } = {}) {
  const ordersByTransactionId = new Map();
  const answersByOrderId = new Map();
  const assetsByOrderId = new Map();
  const syncRuns = [];
  let syncState = { cursorMinCreated, runningSince: null };
  let nextId = 1;

  return {
    _ordersByTransactionId: ordersByTransactionId,
    _answersByOrderId: answersByOrderId,
    _assetsByOrderId: assetsByOrderId,
    _syncRuns: syncRuns,

    async getSyncState() {
      return { ...syncState };
    },
    // Mirrors the real store's conditional acquire: the free/stale check and
    // the write happen together, so a caller that finds the lock held gets
    // { acquired: false } rather than silently stealing it.
    async acquireLock({ nowIso, staleBeforeIso }) {
      const isFree = !syncState.runningSince || syncState.runningSince < staleBeforeIso;
      if (!isFree) return { acquired: false };
      syncState = { ...syncState, runningSince: nowIso };
      return { acquired: true };
    },
    async releaseLock() {
      syncState = { ...syncState, runningSince: null };
    },
    async getOrderByTransactionId(transactionId) {
      const order = ordersByTransactionId.get(String(transactionId));
      return order ? { id: order.id, paymentState: order.paymentState } : null;
    },
    async upsertOrder(orderFields) {
      const existing = ordersByTransactionId.get(String(orderFields.transactionId));
      const id = existing?.id ?? String(nextId++);
      ordersByTransactionId.set(String(orderFields.transactionId), { id, ...orderFields });
      return { id };
    },
    async insertAnswers(orderId, answers) {
      answersByOrderId.set(orderId, [...(answersByOrderId.get(orderId) ?? []), ...answers]);
    },
    async insertAsset(orderId, asset) {
      assetsByOrderId.set(orderId, [...(assetsByOrderId.get(orderId) ?? []), asset]);
    },
    async updatePaymentState(orderId, paymentState) {
      for (const order of ordersByTransactionId.values()) {
        if (order.id === orderId) order.paymentState = paymentState;
      }
    },
    async saveCursor(isoString) {
      syncState = { ...syncState, cursorMinCreated: isoString };
    },
    async recordSyncRun(summary) {
      syncRuns.push(summary);
    },
  };
}

export function sampleReceipt({ receiptId, createdAt, transactions, isPaid = true, status = 'paid', buyerUserId = 1, name = 'Jamie Buyer' }) {
  return {
    receipt_id: receiptId,
    buyer_user_id: buyerUserId,
    name,
    is_paid: isPaid,
    status,
    create_timestamp: Date.parse(createdAt) / 1000,
    transactions,
  };
}

export function sampleTransaction({ transactionId, listingId, quantity = 1, variations = [] }) {
  return { transaction_id: transactionId, listing_id: listingId, quantity, variations };
}

export function personalizationVariation({ questionId, formattedName, formattedValue }) {
  return { property_id: 54, question_id: questionId, formatted_name: formattedName, formatted_value: formattedValue };
}
