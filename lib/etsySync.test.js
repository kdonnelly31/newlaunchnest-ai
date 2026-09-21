import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncMadeToOrderReceipts } from './etsySync.js';
import { createFakeStore, sampleReceipt, sampleTransaction, personalizationVariation } from './mtoTestFakes.js';

const LISTING_ID = 222;
const SHOP_ID = 42;
const CUTOVER_AT = '2026-09-15T00:00:00Z';

function noAssets() {
  return async () => { throw new Error('importAndStoreAsset should not be called in this test'); };
}
function noProductAnswer() {
  return async () => null;
}

test('imports a new order with mapped personalization answers', async () => {
  const store = createFakeStore();
  const receipt = sampleReceipt({
    receiptId: 1,
    createdAt: '2026-09-16T00:00:00Z',
    transactions: [
      sampleTransaction({
        transactionId: 101,
        listingId: LISTING_ID,
        variations: [
          personalizationVariation({ questionId: null, formattedName: 'Which Etsy product should this page promote?', formattedValue: 'https://www.etsy.com/listing/999/x' }),
          personalizationVariation({ questionId: null, formattedName: 'Who usually buys this product?', formattedValue: 'New parents' }),
        ],
      }),
    ],
  });

  const result = await syncMadeToOrderReceipts({
    listReceipts: async ({ minCreated }) => (minCreated ? { receipts: [receipt] } : { receipts: [] }),
    resolveListing: async () => ({ title: 'A Nice Mug', price: { amount: 1999, divisor: 100 }, currency: 'USD', state: 'active' }),
    importAndStoreAsset: noAssets(),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  });

  assert.equal(result.skipped, false);
  assert.equal(result.ordersCreated, 1);
  const order = store._ordersByTransactionId.get('101');
  assert.equal(order.paymentState, 'paid');
  assert.equal(order.needsAttention, false);
  assert.equal(order.resolvedListingId, '999');
  const answers = store._answersByOrderId.get(order.id);
  assert.equal(answers.length, 2);
});

test('skips a receipt created before the cutover entirely', async () => {
  const store = createFakeStore();
  const receipt = sampleReceipt({
    receiptId: 2,
    createdAt: '2026-09-01T00:00:00Z',
    transactions: [sampleTransaction({ transactionId: 201, listingId: LISTING_ID })],
  });

  const result = await syncMadeToOrderReceipts({
    listReceipts: async () => ({ receipts: [receipt] }),
    resolveListing: noProductAnswer(),
    importAndStoreAsset: noAssets(),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  });

  assert.equal(result.ordersCreated, 0);
  assert.equal(store._ordersByTransactionId.size, 0);
});

test('running the same receipt through twice does not create a duplicate order', async () => {
  const store = createFakeStore();
  const receipt = sampleReceipt({
    receiptId: 3,
    createdAt: '2026-09-16T00:00:00Z',
    transactions: [sampleTransaction({ transactionId: 301, listingId: LISTING_ID })],
  });
  const deps = {
    listReceipts: async ({ minCreated }) => (minCreated ? { receipts: [receipt] } : { receipts: [] }),
    resolveListing: noProductAnswer(),
    importAndStoreAsset: noAssets(),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  };

  await syncMadeToOrderReceipts(deps);
  const secondRun = await syncMadeToOrderReceipts(deps);

  assert.equal(store._ordersByTransactionId.size, 1);
  assert.equal(secondRun.ordersCreated, 0);
});

test('flags an order with quantity > 1 as needing attention, reason multiple_units', async () => {
  const store = createFakeStore();
  const receipt = sampleReceipt({
    receiptId: 4,
    createdAt: '2026-09-16T00:00:00Z',
    transactions: [sampleTransaction({ transactionId: 401, listingId: LISTING_ID, quantity: 3 })],
  });

  await syncMadeToOrderReceipts({
    listReceipts: async () => ({ receipts: [receipt] }),
    resolveListing: noProductAnswer(),
    importAndStoreAsset: noAssets(),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  });

  const order = store._ordersByTransactionId.get('401');
  assert.equal(order.needsAttention, true);
  assert.equal(order.attentionReason, 'multiple_units');
});

test('flags an order missing the required product_url answer', async () => {
  const store = createFakeStore();
  const receipt = sampleReceipt({
    receiptId: 5,
    createdAt: '2026-09-16T00:00:00Z',
    transactions: [
      sampleTransaction({
        transactionId: 501,
        listingId: LISTING_ID,
        variations: [personalizationVariation({ questionId: null, formattedName: 'Who usually buys this product?', formattedValue: 'Gift shoppers' })],
      }),
    ],
  });

  await syncMadeToOrderReceipts({
    listReceipts: async () => ({ receipts: [receipt] }),
    resolveListing: noProductAnswer(),
    importAndStoreAsset: noAssets(),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  });

  const order = store._ordersByTransactionId.get('501');
  assert.equal(order.attentionReason, 'missing_information');
});

test('flags an order whose product link does not resolve to a real listing', async () => {
  const store = createFakeStore();
  const receipt = sampleReceipt({
    receiptId: 6,
    createdAt: '2026-09-16T00:00:00Z',
    transactions: [
      sampleTransaction({
        transactionId: 601,
        listingId: LISTING_ID,
        variations: [personalizationVariation({ questionId: null, formattedName: 'Which Etsy product should this page promote?', formattedValue: 'https://www.etsy.com/listing/999/x' })],
      }),
    ],
  });

  await syncMadeToOrderReceipts({
    listReceipts: async () => ({ receipts: [receipt] }),
    resolveListing: async () => null, // deleted/inactive/not found
    importAndStoreAsset: noAssets(),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  });

  const order = store._ordersByTransactionId.get('601');
  assert.equal(order.attentionReason, 'product_unclear');
});

test('downloads an uploaded asset and flags asset_unavailable when it fails', async () => {
  const store = createFakeStore();
  const receipt = sampleReceipt({
    receiptId: 7,
    createdAt: '2026-09-16T00:00:00Z',
    transactions: [
      sampleTransaction({
        transactionId: 701,
        listingId: LISTING_ID,
        variations: [
          personalizationVariation({ questionId: null, formattedName: 'Which Etsy product should this page promote?', formattedValue: 'https://www.etsy.com/listing/999/x' }),
          personalizationVariation({ questionId: null, formattedName: 'Upload your product photos and brand assets', formattedValue: 'https://images.etsy.com/photo.jpg' }),
        ],
      }),
    ],
  });

  await syncMadeToOrderReceipts({
    listReceipts: async () => ({ receipts: [receipt] }),
    resolveListing: async () => ({ title: 'X', price: {}, currency: 'USD', state: 'active' }),
    importAndStoreAsset: async () => ({ status: 'failed', failureReason: 'too_large' }),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  });

  const order = store._ordersByTransactionId.get('701');
  assert.equal(order.attentionReason, 'asset_unavailable');
  const assets = store._assetsByOrderId.get(order.id);
  assert.equal(assets[0].status, 'failed');
});

test('paginates across multiple pages of receipts', async () => {
  const store = createFakeStore();
  const pageOne = [sampleReceipt({ receiptId: 8, createdAt: '2026-09-16T00:00:00Z', transactions: [sampleTransaction({ transactionId: 801, listingId: LISTING_ID })] })];
  const pageTwo = [sampleReceipt({ receiptId: 9, createdAt: '2026-09-16T01:00:00Z', transactions: [sampleTransaction({ transactionId: 901, listingId: LISTING_ID })] })];
  let calls = 0;

  await syncMadeToOrderReceipts({
    listReceipts: async ({ minCreated, offset }) => {
      if (!minCreated) return { receipts: [] }; // reconciliation pass, not under test here
      calls += 1;
      if (offset === 0) return { receipts: pageOne.concat(Array(99).fill(pageOne[0])) }; // force a full page (limit 100)
      return { receipts: pageTwo };
    },
    resolveListing: noProductAnswer(),
    importAndStoreAsset: noAssets(),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  });

  assert.ok(calls >= 2, 'expected pagination to request a second page');
  assert.ok(store._ordersByTransactionId.has('901'), 'the second page\'s order should have been imported');
});
