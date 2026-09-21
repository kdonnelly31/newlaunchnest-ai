import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateReceipt, extractShopNameFromReceipt } from './verifyPurchase.js';

const paidReceiptWithListing = {
  is_paid: true,
  transactions: [{ listing_id: 111 }, { listing_id: 222 }],
};

const SHOP_NAME_QUESTION_ID = 1463135629034;

test('extractShopNameFromReceipt reads the personalization answer for the shop-name question', () => {
  const receipt = {
    transactions: [
      {
        listing_id: 222,
        variations: [
          { question_id: 1463126223673, formatted_value: 'Yes' },
          { question_id: SHOP_NAME_QUESTION_ID, formatted_value: 'YarnCraftCo' },
        ],
      },
    ],
  };
  const shopName = extractShopNameFromReceipt(receipt, 222, SHOP_NAME_QUESTION_ID);
  assert.equal(shopName, 'YarnCraftCo');
});

test('extractShopNameFromReceipt trims whitespace the buyer typed', () => {
  const receipt = {
    transactions: [
      { listing_id: 222, variations: [{ question_id: SHOP_NAME_QUESTION_ID, formatted_value: '  YarnCraftCo  ' }] },
    ],
  };
  assert.equal(extractShopNameFromReceipt(receipt, 222, SHOP_NAME_QUESTION_ID), 'YarnCraftCo');
});

test('extractShopNameFromReceipt returns null when the question was not answered', () => {
  const receipt = { transactions: [{ listing_id: 222, variations: [] }] };
  assert.equal(extractShopNameFromReceipt(receipt, 222, SHOP_NAME_QUESTION_ID), null);
});

test('extractShopNameFromReceipt returns null when no question ID is configured', () => {
  const receipt = {
    transactions: [{ listing_id: 222, variations: [{ question_id: SHOP_NAME_QUESTION_ID, formatted_value: 'YarnCraftCo' }] }],
  };
  assert.equal(extractShopNameFromReceipt(receipt, 222, undefined), null);
});

test('evaluateReceipt includes the extracted shop name on approval', () => {
  const receipt = {
    is_paid: true,
    transactions: [
      { listing_id: 222, variations: [{ question_id: SHOP_NAME_QUESTION_ID, formatted_value: 'YarnCraftCo' }] },
    ],
  };
  const result = evaluateReceipt({
    receipt,
    listingId: 222,
    claimedByOtherUser: false,
    shopNameQuestionId: SHOP_NAME_QUESTION_ID,
  });
  assert.deepEqual(result, { ok: true, shopName: 'YarnCraftCo', buyerUserId: null });
});

test('evaluateReceipt includes the buyer_user_id from the receipt on approval', () => {
  const receipt = { ...paidReceiptWithListing, listing_id: 222, buyer_user_id: 555444333 };
  const result = evaluateReceipt({ receipt, listingId: 222, claimedByOtherUser: false });
  assert.equal(result.buyerUserId, 555444333);
});

test('evaluateReceipt approves with a null shop name when personalization is missing', () => {
  const result = evaluateReceipt({
    receipt: paidReceiptWithListing,
    listingId: 222,
    claimedByOtherUser: false,
    shopNameQuestionId: SHOP_NAME_QUESTION_ID,
  });
  assert.deepEqual(result, { ok: true, shopName: null, buyerUserId: null });
});

test('rejects when the receipt was already claimed by another account', () => {
  const result = evaluateReceipt({ receipt: paidReceiptWithListing, listingId: 111, claimedByOtherUser: true });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test('rejects when the receipt does not exist', () => {
  const result = evaluateReceipt({ receipt: null, listingId: 111, claimedByOtherUser: false });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test('rejects when the receipt is not paid', () => {
  const receipt = { ...paidReceiptWithListing, is_paid: false };
  const result = evaluateReceipt({ receipt, listingId: 111, claimedByOtherUser: false });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.match(result.message, /payment/i);
});

test('rejects when the receipt does not include the target listing', () => {
  const result = evaluateReceipt({ receipt: paidReceiptWithListing, listingId: 999, claimedByOtherUser: false });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.match(result.message, /LaunchNestAI product/);
});

test('approves a paid receipt containing the target listing, unclaimed', () => {
  const result = evaluateReceipt({ receipt: paidReceiptWithListing, listingId: 222, claimedByOtherUser: false });
  assert.deepEqual(result, { ok: true, shopName: null, buyerUserId: null });
});

test('matches listing_id even when one side is a string', () => {
  const result = evaluateReceipt({ receipt: paidReceiptWithListing, listingId: '222', claimedByOtherUser: false });
  assert.deepEqual(result, { ok: true, shopName: null, buyerUserId: null });
});

test('rejects a canceled order even if is_paid is still true', () => {
  const receipt = { ...paidReceiptWithListing, status: 'canceled' };
  const result = evaluateReceipt({ receipt, listingId: 111, claimedByOtherUser: false });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.match(result.message, /refunded or canceled/);
});

test('rejects a fully refunded order even if is_paid is still true', () => {
  const receipt = { ...paidReceiptWithListing, status: 'fully refunded' };
  const result = evaluateReceipt({ receipt, listingId: 111, claimedByOtherUser: false });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
});

test('allows a partially refunded order through', () => {
  const receipt = { ...paidReceiptWithListing, status: 'partially refunded' };
  const result = evaluateReceipt({ receipt, listingId: 222, claimedByOtherUser: false });
  assert.deepEqual(result, { ok: true, shopName: null, buyerUserId: null });
});

test('rejects a receipt created on/after the cutover when made-to-order is enabled', () => {
  const receipt = { ...paidReceiptWithListing, create_timestamp: Date.parse('2026-09-20T00:00:00Z') / 1000 };
  const result = evaluateReceipt({
    receipt,
    listingId: 222,
    claimedByOtherUser: false,
    madeToOrderEnabled: true,
    cutoverAt: '2026-09-15T00:00:00Z',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.match(result.message, /custom-made/i);
});

test('allows a receipt created before the cutover through even when made-to-order is enabled', () => {
  const receipt = { ...paidReceiptWithListing, create_timestamp: Date.parse('2026-09-01T00:00:00Z') / 1000 };
  const result = evaluateReceipt({
    receipt,
    listingId: 222,
    claimedByOtherUser: false,
    madeToOrderEnabled: true,
    cutoverAt: '2026-09-15T00:00:00Z',
  });
  assert.equal(result.ok, true);
});

test('does not apply the cutover guard when made-to-order is disabled', () => {
  const receipt = { ...paidReceiptWithListing, create_timestamp: Date.parse('2026-09-20T00:00:00Z') / 1000 };
  const result = evaluateReceipt({
    receipt,
    listingId: 222,
    claimedByOtherUser: false,
    madeToOrderEnabled: false,
    cutoverAt: '2026-09-15T00:00:00Z',
  });
  assert.equal(result.ok, true);
});

test('does not apply the cutover guard when no cutoverAt is configured', () => {
  const receipt = { ...paidReceiptWithListing, create_timestamp: Date.parse('2026-09-20T00:00:00Z') / 1000 };
  const result = evaluateReceipt({ receipt, listingId: 222, claimedByOtherUser: false, madeToOrderEnabled: true, cutoverAt: null });
  assert.equal(result.ok, true);
});
