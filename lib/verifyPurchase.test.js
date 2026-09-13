import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateReceipt } from './verifyPurchase.js';

const paidReceiptWithListing = {
  is_paid: true,
  transactions: [{ listing_id: 111 }, { listing_id: 222 }],
};

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
  assert.deepEqual(result, { ok: true });
});

test('matches listing_id even when one side is a string', () => {
  const result = evaluateReceipt({ receipt: paidReceiptWithListing, listingId: '222', claimedByOtherUser: false });
  assert.deepEqual(result, { ok: true });
});
