import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTextEdits } from './pageTextEdits.js';

function heroSection(overrides = {}) {
  return {
    type: 'hero',
    eyebrow: 'HANDCRAFTED',
    headline: 'A Mug Worth Waking Up For',
    subheadline: 'Thrown by hand, one at a time.',
    body: [],
    imageId: 'Image 1',
    ctaText: 'Get Yours on Etsy',
    trustIndicators: ['Made to order'],
    items: [],
    supportingFacts: [],
    occasions: [],
    supportingText: null,
    ...overrides,
  };
}

function benefitsSection(overrides = {}) {
  return {
    type: 'benefits',
    eyebrow: null,
    headline: 'Why you will love it',
    subheadline: null,
    body: [],
    imageId: null,
    ctaText: null,
    trustIndicators: [],
    items: [
      { heading: 'Keeps drinks warm', body: 'Thick stoneware holds heat.', caption: null, imageId: null, label: null, value: null },
      { heading: 'Dishwasher safe', body: 'No hand-washing required.', caption: null, imageId: null, label: null, value: null },
    ],
    supportingFacts: [],
    occasions: [],
    supportingText: null,
    ...overrides,
  };
}

function pagePlan(sections) {
  return {
    productStory: { primaryAudience: 'x', emotionalAngle: 'x', functionalAngle: 'x', primaryBuyerIntent: 'x' },
    images: [{ id: 'Image 1', classification: 'hero', url: 'https://img.etsystatic.com/full.jpg' }],
    sections,
    socialPosts: [{ platform: 'instagram', title: null, caption: 'x', hashtags: [] }],
  };
}

test('applyTextEdits: fixes a typo in a plain string field', () => {
  const stored = pagePlan([heroSection()]);
  const edited = [heroSection({ headline: 'A Mug Worht Waking Up For — Fixed' })];
  const result = applyTextEdits(stored, edited);
  assert.equal(result.sections[0].headline, 'A Mug Worht Waking Up For — Fixed');
});

test('applyTextEdits: fixes a typo inside an item field', () => {
  const stored = pagePlan([benefitsSection()]);
  const edited = [benefitsSection({
    items: [
      { heading: 'Keeps drinks warm', body: 'Thick stoneware holds heat FIXED.', caption: null, imageId: null, label: null, value: null },
      { heading: 'Dishwasher safe', body: 'No hand-washing required.', caption: null, imageId: null, label: null, value: null },
    ],
  })];
  const result = applyTextEdits(stored, edited);
  assert.equal(result.sections[0].items[0].body, 'Thick stoneware holds heat FIXED.');
  assert.equal(result.sections[0].items[1].body, 'No hand-washing required.');
});

test('applyTextEdits: fixes a typo inside an array field, preserving array length', () => {
  const stored = pagePlan([heroSection({ trustIndicators: ['Made too order', 'Ships fast'] })]);
  const edited = [heroSection({ trustIndicators: ['Made to order', 'Ships fast'] })];
  const result = applyTextEdits(stored, edited);
  assert.deepEqual(result.sections[0].trustIndicators, ['Made to order', 'Ships fast']);
});

test('applyTextEdits: rejects a change to section type', () => {
  const stored = pagePlan([heroSection()]);
  const edited = [heroSection({ type: 'final_cta' })];
  assert.throws(() => applyTextEdits(stored, edited), /type cannot be changed/);
});

test('applyTextEdits: rejects a change to a section\'s imageId', () => {
  const stored = pagePlan([heroSection()]);
  const edited = [heroSection({ imageId: 'Image 99' })];
  assert.throws(() => applyTextEdits(stored, edited), /image cannot be changed/);
});

test('applyTextEdits: rejects a change to an item\'s imageId', () => {
  const stored = pagePlan([benefitsSection({
    items: [{ heading: 'H', body: 'B', caption: null, imageId: 'Image 1', label: null, value: null }],
  })]);
  const edited = [benefitsSection({
    items: [{ heading: 'H', body: 'B', caption: null, imageId: 'Image 2', label: null, value: null }],
  })];
  assert.throws(() => applyTextEdits(stored, edited), /item 0 image cannot be changed/);
});

test('applyTextEdits: rejects a different number of sections', () => {
  const stored = pagePlan([heroSection()]);
  assert.throws(() => applyTextEdits(stored, []), /same number of sections/);
});

test('applyTextEdits: rejects a different number of items within a section', () => {
  const stored = pagePlan([benefitsSection()]); // 2 items
  const edited = [benefitsSection({ items: [benefitsSection().items[0]] })]; // 1 item
  assert.throws(() => applyTextEdits(stored, edited), /item count cannot be changed/);
});

test('applyTextEdits: rejects a different array length for an array field', () => {
  const stored = pagePlan([heroSection({ trustIndicators: ['A', 'B'] })]);
  const edited = [heroSection({ trustIndicators: ['A'] })];
  // Not a hard error -- silently keeps the original rather than corrupting data,
  // since a length mismatch here is more likely a client bug than intent.
  const result = applyTextEdits(stored, edited);
  assert.deepEqual(result.sections[0].trustIndicators, ['A', 'B']);
});

test('applyTextEdits: leaves a null field null when the edit is not a string', () => {
  const stored = pagePlan([heroSection({ eyebrow: null })]);
  const edited = [heroSection({ eyebrow: null })];
  const result = applyTextEdits(stored, edited);
  assert.equal(result.sections[0].eyebrow, null);
});

test('applyTextEdits: allows filling in a previously-null field with new text', () => {
  const stored = pagePlan([heroSection({ eyebrow: null })]);
  const edited = [heroSection({ eyebrow: 'NEW TAG' })];
  const result = applyTextEdits(stored, edited);
  assert.equal(result.sections[0].eyebrow, 'NEW TAG');
});

test('applyTextEdits: trims whitespace and falls back to original on an empty edit', () => {
  const stored = pagePlan([heroSection({ headline: 'Original Headline' })]);
  const edited = [heroSection({ headline: '   ' })];
  const result = applyTextEdits(stored, edited);
  assert.equal(result.sections[0].headline, 'Original Headline');
});

test('applyTextEdits: caps an absurdly long field rather than storing it unbounded', () => {
  const stored = pagePlan([heroSection({ headline: 'Original' })]);
  const edited = [heroSection({ headline: 'x'.repeat(5000) })];
  const result = applyTextEdits(stored, edited);
  assert.ok(result.sections[0].headline.length <= 2000);
});

test('applyTextEdits: does not mutate the stored pagePlan object', () => {
  const stored = pagePlan([heroSection({ headline: 'Original' })]);
  const edited = [heroSection({ headline: 'Changed' })];
  applyTextEdits(stored, edited);
  assert.equal(stored.sections[0].headline, 'Original');
});

test('applyTextEdits: leaves productStory, images, and socialPosts untouched', () => {
  const stored = pagePlan([heroSection()]);
  const edited = [heroSection({ headline: 'Changed' })];
  const result = applyTextEdits(stored, edited);
  assert.deepEqual(result.productStory, stored.productStory);
  assert.deepEqual(result.images, stored.images);
  assert.deepEqual(result.socialPosts, stored.socialPosts);
});
