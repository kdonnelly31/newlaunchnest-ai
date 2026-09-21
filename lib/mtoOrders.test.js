import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  derivePaymentState,
  isReceiptBeforeCutover,
  extractPersonalizationAnswers,
  deriveOrderFromTransaction,
  deriveAttentionReason,
  parseEtsyProductUrl,
} from './mtoOrders.js';

// --- derivePaymentState ---

test('derivePaymentState: canceled status wins even if is_paid is true', () => {
  assert.equal(derivePaymentState({ status: 'canceled', is_paid: true }), 'canceled');
});

test('derivePaymentState: fully refunded status wins even if is_paid is true', () => {
  assert.equal(derivePaymentState({ status: 'fully refunded', is_paid: true }), 'refunded');
});

test('derivePaymentState: partially refunded with is_paid true counts as paid', () => {
  assert.equal(derivePaymentState({ status: 'partially refunded', is_paid: true }), 'paid');
});

test('derivePaymentState: paid status, is_paid true, counts as paid', () => {
  assert.equal(derivePaymentState({ status: 'paid', is_paid: true }), 'paid');
});

test('derivePaymentState: not yet paid counts as pending', () => {
  assert.equal(derivePaymentState({ status: 'open', is_paid: false }), 'pending');
});

// --- isReceiptBeforeCutover ---

test('isReceiptBeforeCutover: true when the receipt predates the cutover', () => {
  const receipt = { create_timestamp: Date.parse('2026-09-01T00:00:00Z') / 1000 };
  assert.equal(isReceiptBeforeCutover(receipt, '2026-09-15T00:00:00Z'), true);
});

test('isReceiptBeforeCutover: false when the receipt is at or after the cutover', () => {
  const receipt = { create_timestamp: Date.parse('2026-09-15T00:00:00Z') / 1000 };
  assert.equal(isReceiptBeforeCutover(receipt, '2026-09-15T00:00:00Z'), false);
});

// --- extractPersonalizationAnswers ---

test('extractPersonalizationAnswers: filters to property_id 54 only', () => {
  const transaction = {
    variations: [
      { property_id: 200, value_id: 1, formatted_name: 'Color', formatted_value: 'Blue' },
      { property_id: 54, value_id: null, question_id: 111, formatted_name: 'Who buys this?', formatted_value: 'Gift shoppers' },
    ],
  };
  assert.deepEqual(extractPersonalizationAnswers(transaction), [
    { questionId: 111, formattedName: 'Who buys this?', formattedValue: 'Gift shoppers' },
  ]);
});

test('extractPersonalizationAnswers: matches property_id sent as the string "54"', () => {
  const transaction = {
    variations: [{ property_id: '54', question_id: 111, formatted_name: 'Who buys this?', formatted_value: 'Gift shoppers' }],
  };
  assert.deepEqual(extractPersonalizationAnswers(transaction), [
    { questionId: 111, formattedName: 'Who buys this?', formattedValue: 'Gift shoppers' },
  ]);
});

test('extractPersonalizationAnswers: returns an empty array when there are no variations', () => {
  assert.deepEqual(extractPersonalizationAnswers({}), []);
});

test('extractPersonalizationAnswers: handles a null question_id (regular variation shape)', () => {
  const transaction = { variations: [{ property_id: 54, question_id: null, formatted_name: 'Note', formatted_value: 'Hi' }] };
  assert.deepEqual(extractPersonalizationAnswers(transaction), [{ questionId: null, formattedName: 'Note', formattedValue: 'Hi' }]);
});

// --- deriveOrderFromTransaction ---

const paidReceipt = {
  receipt_id: 555,
  buyer_user_id: 777,
  name: 'Jamie Buyer',
  is_paid: true,
  status: 'paid',
  create_timestamp: Date.parse('2026-09-16T12:00:00Z') / 1000,
};

test('deriveOrderFromTransaction: returns null for a transaction on a different listing', () => {
  const transaction = { transaction_id: 1, listing_id: 999, quantity: 1 };
  assert.equal(deriveOrderFromTransaction({ receipt: paidReceipt, transaction, listingId: 222, shopId: 1 }), null);
});

test('deriveOrderFromTransaction: returns null when the receipt was never paid', () => {
  const transaction = { transaction_id: 1, listing_id: 222, quantity: 1 };
  const receipt = { ...paidReceipt, is_paid: false, status: 'open' };
  assert.equal(deriveOrderFromTransaction({ receipt, transaction, listingId: 222, shopId: 1 }), null);
});

test('deriveOrderFromTransaction: builds the full order-fields object for a matching, paid transaction', () => {
  const transaction = { transaction_id: 1, listing_id: 222, quantity: 1 };
  const order = deriveOrderFromTransaction({ receipt: paidReceipt, transaction, listingId: 222, shopId: 42 });
  assert.deepEqual(order, {
    shopId: 42,
    receiptId: 555,
    transactionId: 1,
    listingId: 222,
    quantity: 1,
    buyerEtsyUserId: 777,
    buyerDisplayName: 'Jamie Buyer',
    receiptCreatedAt: new Date(paidReceipt.create_timestamp * 1000).toISOString(),
    paymentState: 'paid',
  });
});

test('deriveOrderFromTransaction: defaults quantity to 1 when Etsy omits it', () => {
  const transaction = { transaction_id: 1, listing_id: 222 };
  const order = deriveOrderFromTransaction({ receipt: paidReceipt, transaction, listingId: 222, shopId: 1 });
  assert.equal(order.quantity, 1);
});

// --- deriveAttentionReason ---

test('deriveAttentionReason: multiple units takes priority over everything else', () => {
  const reason = deriveAttentionReason({
    quantity: 2,
    mappedAnswers: [{ mappedField: 'product_url' }],
    productUnclear: true,
    anyAssetFailed: true,
  });
  assert.equal(reason, 'multiple_units');
});

test('deriveAttentionReason: missing product_url answer entirely', () => {
  const reason = deriveAttentionReason({ quantity: 1, mappedAnswers: [{ mappedField: 'target_customer' }], productUnclear: false, anyAssetFailed: false });
  assert.equal(reason, 'missing_information');
});

test('deriveAttentionReason: product link present but unresolvable', () => {
  const reason = deriveAttentionReason({ quantity: 1, mappedAnswers: [{ mappedField: 'product_url' }], productUnclear: true, anyAssetFailed: false });
  assert.equal(reason, 'product_unclear');
});

test('deriveAttentionReason: asset download failure', () => {
  const reason = deriveAttentionReason({ quantity: 1, mappedAnswers: [{ mappedField: 'product_url' }], productUnclear: false, anyAssetFailed: true });
  assert.equal(reason, 'asset_unavailable');
});

test('deriveAttentionReason: an unmapped answer, nothing else wrong', () => {
  const reason = deriveAttentionReason({
    quantity: 1,
    mappedAnswers: [{ mappedField: 'product_url' }, { mappedField: 'unmapped' }],
    productUnclear: false,
    anyAssetFailed: false,
  });
  assert.equal(reason, 'unmapped_personalization');
});

test('deriveAttentionReason: nothing wrong returns null', () => {
  const reason = deriveAttentionReason({
    quantity: 1,
    mappedAnswers: [{ mappedField: 'product_url' }, { mappedField: 'target_customer' }],
    productUnclear: false,
    anyAssetFailed: false,
  });
  assert.equal(reason, null);
});

// --- parseEtsyProductUrl ---

test('parseEtsyProductUrl: accepts a real Etsy listing URL', () => {
  assert.deepEqual(parseEtsyProductUrl('https://www.etsy.com/listing/123456789/some-product-name'), { listingId: '123456789' });
});

test('parseEtsyProductUrl: accepts the bare etsy.com host without www', () => {
  assert.deepEqual(parseEtsyProductUrl('https://etsy.com/listing/42/x'), { listingId: '42' });
});

test('parseEtsyProductUrl: rejects a non-Etsy host', () => {
  assert.equal(parseEtsyProductUrl('https://not-etsy.com/listing/123456789/x'), null);
});

test('parseEtsyProductUrl: rejects http (non-https)', () => {
  assert.equal(parseEtsyProductUrl('http://www.etsy.com/listing/123456789/x'), null);
});

test('parseEtsyProductUrl: rejects a URL with no listing ID in the path', () => {
  assert.equal(parseEtsyProductUrl('https://www.etsy.com/shop/SomeShop'), null);
});

test('parseEtsyProductUrl: rejects garbage input without throwing', () => {
  assert.equal(parseEtsyProductUrl('not a url at all'), null);
  assert.equal(parseEtsyProductUrl(''), null);
  assert.equal(parseEtsyProductUrl(undefined), null);
});
