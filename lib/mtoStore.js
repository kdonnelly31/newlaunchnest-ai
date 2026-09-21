// The real, Supabase-backed implementation of the `store` interface
// lib/etsySync.js's syncMadeToOrderReceipts() depends on. Not unit tested
// directly (same reasoning as getValidEtsyToken in lib/etsyOAuth.js) --
// exercised via the manual QA steps in docs/qa-made-to-order-intake.md.
export function createMtoStore(supabaseAdmin) {
  return {
    async getSyncState() {
      const { data, error } = await supabaseAdmin.from('mto_sync_state').select('cursor_min_created, running_since').eq('id', 1).single();
      if (error) throw new Error(error.message);
      return { cursorMinCreated: data.cursor_min_created, runningSince: data.running_since };
    },

    // Conditional, single-statement acquire: the .or() filter is evaluated by
    // Postgres as part of the same UPDATE, so the row only changes (and only
    // comes back via .select()) when no lock is held or the held lock is
    // stale. Two concurrent callers therefore cannot both succeed -- which a
    // read-then-write acquire would allow.
    async acquireLock({ nowIso, staleBeforeIso }) {
      const { data, error } = await supabaseAdmin
        .from('mto_sync_state')
        .update({ running_since: nowIso, updated_at: nowIso })
        .eq('id', 1)
        .or(`running_since.is.null,running_since.lt.${staleBeforeIso}`)
        .select('id');
      if (error) throw new Error(error.message);
      return { acquired: (data?.length ?? 0) > 0 };
    },

    async releaseLock() {
      const { error } = await supabaseAdmin.from('mto_sync_state').update({ running_since: null, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) throw new Error(error.message);
    },

    async getOrderByTransactionId(transactionId) {
      const { data, error } = await supabaseAdmin
        .from('mto_orders')
        .select('id, payment_state')
        .eq('transaction_id', transactionId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { id: data.id, paymentState: data.payment_state } : null;
    },

    async upsertOrder(orderFields) {
      const { data, error } = await supabaseAdmin
        .from('mto_orders')
        .upsert(
          {
            shop_id: orderFields.shopId,
            receipt_id: orderFields.receiptId,
            transaction_id: orderFields.transactionId,
            listing_id: orderFields.listingId,
            quantity: orderFields.quantity,
            buyer_etsy_user_id: orderFields.buyerEtsyUserId,
            buyer_display_name: orderFields.buyerDisplayName,
            receipt_created_at: orderFields.receiptCreatedAt,
            payment_state: orderFields.paymentState,
            needs_attention: orderFields.needsAttention,
            attention_reason: orderFields.attentionReason,
            resolved_listing_id: orderFields.resolvedListingId,
            resolved_listing_snapshot: orderFields.resolvedListingSnapshot,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: 'shop_id,transaction_id' },
        )
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return { id: data.id };
    },

    async insertAnswers(orderId, answers) {
      const { error } = await supabaseAdmin.from('mto_personalization_answers').insert(
        answers.map(a => ({
          order_id: orderId,
          question_id: a.questionId != null ? String(a.questionId) : null,
          formatted_name: a.formattedName,
          formatted_value: a.formattedValue,
          mapped_field: a.mappedField,
          mapping_version: a.mappingVersion,
        })),
      );
      if (error) throw new Error(error.message);
    },

    async insertAsset(orderId, asset) {
      const { error } = await supabaseAdmin.from('mto_assets').insert({
        order_id: orderId,
        source_url: asset.sourceUrl,
        storage_key: asset.storageKey ?? null,
        content_type: asset.contentType ?? null,
        byte_size: asset.byteSize ?? null,
        status: asset.status,
        failure_reason: asset.failureReason ?? null,
      });
      if (error) throw new Error(error.message);
    },

    async updatePaymentState(orderId, paymentState) {
      const { error } = await supabaseAdmin
        .from('mto_orders')
        .update({ payment_state: paymentState, last_synced_at: new Date().toISOString() })
        .eq('id', orderId);
      if (error) throw new Error(error.message);
    },

    async saveCursor(isoString) {
      const { error } = await supabaseAdmin.from('mto_sync_state').update({ cursor_min_created: isoString, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) throw new Error(error.message);
    },

    async recordSyncRun(summary) {
      const { error } = await supabaseAdmin.from('mto_sync_runs').insert({
        started_at: summary.startedAt,
        finished_at: summary.finishedAt,
        trigger: summary.trigger,
        receipts_seen: summary.receiptsSeen,
        orders_created: summary.ordersCreated,
        orders_updated: summary.ordersUpdated,
        error: summary.error,
      });
      if (error) throw new Error(error.message);
    },
  };
}
