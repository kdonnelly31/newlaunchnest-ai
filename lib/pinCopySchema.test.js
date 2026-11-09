// lib/pinCopySchema.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PinBatchSchema, PIN_ANGLES, PHOTO_CLASSIFICATIONS, CONFIDENCE_LEVELS } from './pinCopySchema.js';

function buildVariation(angle, overrides = {}) {
  return {
    angle,
    headline: 'Handmade Stoneware Mugs',
    supportingText: 'Thrown by hand, one at a time.',
    pinTitle: 'Handmade Stoneware Coffee Mug | Cozy Morning Gift Idea',
    pinDescription: 'A hand-thrown stoneware mug that keeps your coffee warm longer. A simple, professional gift for the coffee lover in your life.',
    keywords: ['handmade mug', 'stoneware coffee mug', 'gift for coffee lover'],
    boardCategory: 'Handmade Gifts',
    ...overrides,
  };
}

function buildBatch(overrides = {}) {
  return {
    photoClassification: 'product',
    classificationConfidence: 'high',
    variations: PIN_ANGLES.map(angle => buildVariation(angle)),
    ...overrides,
  };
}

test('PIN_ANGLES, PHOTO_CLASSIFICATIONS, and CONFIDENCE_LEVELS are the expected lists', () => {
  assert.deepEqual(PIN_ANGLES, ['spotlight', 'buyer_focused', 'gift_lifestyle']);
  assert.deepEqual(PHOTO_CLASSIFICATIONS, ['product', 'lifestyle', 'instructional', 'other']);
  assert.deepEqual(CONFIDENCE_LEVELS, ['high', 'medium', 'low']);
});

test('PinBatchSchema accepts a well-formed 3-variation batch', () => {
  const result = PinBatchSchema.safeParse(buildBatch());
  assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error?.issues));
});

test('PinBatchSchema rejects an unknown angle', () => {
  const batch = buildBatch({ variations: [buildVariation('spotlight'), buildVariation('made_up_angle'), buildVariation('gift_lifestyle')] });
  const result = PinBatchSchema.safeParse(batch);
  assert.equal(result.success, false);
});

test('PinBatchSchema rejects an unknown photoClassification', () => {
  const result = PinBatchSchema.safeParse(buildBatch({ photoClassification: 'infographic' }));
  assert.equal(result.success, false);
});

test('PinBatchSchema rejects an unknown classificationConfidence', () => {
  const result = PinBatchSchema.safeParse(buildBatch({ classificationConfidence: 'certain' }));
  assert.equal(result.success, false);
});

test('PinBatchSchema requires every variation field to be present', () => {
  const incomplete = { angle: 'spotlight', headline: 'x' };
  const result = PinBatchSchema.safeParse(buildBatch({ variations: [incomplete, buildVariation('buyer_focused'), buildVariation('gift_lifestyle')] }));
  assert.equal(result.success, false);
});
