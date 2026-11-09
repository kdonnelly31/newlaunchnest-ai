// lib/pinCopyGenerator.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePinBatch } from './pinCopyGenerator.js';
import { PIN_ANGLES } from './pinCopySchema.js';

function buildVariation(angle) {
  return {
    angle,
    headline: 'Handmade Stoneware Mugs',
    supportingText: 'Thrown by hand, one at a time.',
    pinTitle: 'Handmade Stoneware Coffee Mug | Cozy Morning Gift Idea',
    pinDescription: 'A hand-thrown stoneware mug that keeps your coffee warm longer.',
    keywords: ['handmade mug'],
    boardCategory: 'Handmade Gifts',
  };
}

function buildBatch(variationAngles = PIN_ANGLES) {
  return {
    photoClassification: 'product',
    classificationConfidence: 'high',
    variations: variationAngles.map(buildVariation),
  };
}

test('validatePinBatch accepts a batch with all 3 angles in the correct order', () => {
  const batch = buildBatch();
  assert.deepEqual(validatePinBatch(batch), batch);
});

test('validatePinBatch rejects a batch with the wrong number of variations', () => {
  assert.throws(() => validatePinBatch(buildBatch(['spotlight', 'buyer_focused'])), /exactly 3 variations/);
});

test('validatePinBatch rejects a batch with angles out of order', () => {
  assert.throws(() => validatePinBatch(buildBatch(['buyer_focused', 'spotlight', 'gift_lifestyle'])), /variation 0 must have angle "spotlight"/);
});
