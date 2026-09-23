import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildImageContentBlocks, validatePagePlan } from './pageStoryGenerator.js';

// --- buildImageContentBlocks ---

test('buildImageContentBlocks: labels each image and builds text+image pairs', () => {
  const images = [
    { url_fullxfull: 'https://img.etsystatic.com/full1.jpg' },
    { url_fullxfull: 'https://img.etsystatic.com/full2.jpg' },
  ];
  const { contentBlocks, manifest } = buildImageContentBlocks(images);
  assert.deepEqual(contentBlocks, [
    { type: 'text', text: 'Image 1:' },
    { type: 'image', source: { type: 'url', url: 'https://img.etsystatic.com/full1.jpg' } },
    { type: 'text', text: 'Image 2:' },
    { type: 'image', source: { type: 'url', url: 'https://img.etsystatic.com/full2.jpg' } },
  ]);
  assert.deepEqual(manifest, [
    { id: 'Image 1', url: 'https://img.etsystatic.com/full1.jpg', thumbnailUrl: 'https://img.etsystatic.com/full1.jpg' },
    { id: 'Image 2', url: 'https://img.etsystatic.com/full2.jpg', thumbnailUrl: 'https://img.etsystatic.com/full2.jpg' },
  ]);
});

test('buildImageContentBlocks: falls back to url_570xN when url_fullxfull is missing', () => {
  const images = [{ url_570xN: 'https://img.etsystatic.com/570.jpg' }];
  const { manifest } = buildImageContentBlocks(images);
  assert.equal(manifest[0].url, 'https://img.etsystatic.com/570.jpg');
});

test('buildImageContentBlocks: caps at maxImages even when more are available', () => {
  const images = Array.from({ length: 15 }, (_, i) => ({ url_fullxfull: `https://img.etsystatic.com/${i}.jpg` }));
  const { manifest } = buildImageContentBlocks(images, 10);
  assert.equal(manifest.length, 10);
  assert.equal(manifest[0].url, 'https://img.etsystatic.com/0.jpg');
  assert.equal(manifest[9].url, 'https://img.etsystatic.com/9.jpg');
});

test('buildImageContentBlocks: skips an image with neither URL field, without breaking numbering for the rest', () => {
  const images = [
    { url_fullxfull: 'https://img.etsystatic.com/a.jpg' },
    {},
    { url_fullxfull: 'https://img.etsystatic.com/c.jpg' },
  ];
  const { manifest } = buildImageContentBlocks(images);
  assert.deepEqual(manifest, [
    { id: 'Image 1', url: 'https://img.etsystatic.com/a.jpg', thumbnailUrl: 'https://img.etsystatic.com/a.jpg' },
    { id: 'Image 3', url: 'https://img.etsystatic.com/c.jpg', thumbnailUrl: 'https://img.etsystatic.com/c.jpg' },
  ]);
});

test('buildImageContentBlocks: returns empty arrays for no images', () => {
  const { contentBlocks, manifest } = buildImageContentBlocks([]);
  assert.deepEqual(contentBlocks, []);
  assert.deepEqual(manifest, []);
});

test('buildImageContentBlocks: handles a null/undefined images array without throwing', () => {
  const { contentBlocks, manifest } = buildImageContentBlocks(undefined);
  assert.deepEqual(contentBlocks, []);
  assert.deepEqual(manifest, []);
});

test('buildImageContentBlocks: sends the smaller url_570xN to the model when both sizes are available, but keeps url_fullxfull in the manifest', () => {
  const images = [{ url_fullxfull: 'https://img.etsystatic.com/full.jpg', url_570xN: 'https://img.etsystatic.com/570.jpg' }];
  const { contentBlocks, manifest } = buildImageContentBlocks(images);
  assert.equal(contentBlocks[1].source.url, 'https://img.etsystatic.com/570.jpg');
  assert.equal(manifest[0].url, 'https://img.etsystatic.com/full.jpg');
  assert.equal(manifest[0].thumbnailUrl, 'https://img.etsystatic.com/570.jpg');
});

test('buildImageContentBlocks: thumbnailUrl falls back to the full-resolution url when no url_570xN exists', () => {
  const images = [{ url_fullxfull: 'https://img.etsystatic.com/full.jpg' }];
  const { manifest } = buildImageContentBlocks(images);
  assert.equal(manifest[0].thumbnailUrl, 'https://img.etsystatic.com/full.jpg');
});

// --- validatePagePlan ---

const heroSection = { type: 'hero', eyebrow: null, headline: 'H', subheadline: 'S', imageId: 'Image 1', ctaText: 'Buy', trustIndicators: [] };
const finalCtaSection = { type: 'final_cta', headline: 'H2', supportingText: 'S2', ctaText: 'Buy', imageId: null };
const images = [{ id: 'Image 1', classification: 'hero' }];
const manifest = [{ id: 'Image 1', url: 'https://img.etsystatic.com/full.jpg', thumbnailUrl: 'https://img.etsystatic.com/570.jpg' }];

function basePlan(sections) {
  return {
    productStory: { primaryAudience: 'x', emotionalAngle: 'x', functionalAngle: 'x', primaryBuyerIntent: 'x' },
    images,
    sections,
    socialPosts: [{ platform: 'instagram', title: null, caption: 'x', hashtags: [] }],
  };
}

test('validatePagePlan: accepts a plan starting with hero and ending with final_cta', () => {
  const plan = basePlan([heroSection, finalCtaSection]);
  assert.equal(validatePagePlan(plan, manifest), plan);
});

test('validatePagePlan: rejects a plan that does not start with hero', () => {
  const plan = basePlan([finalCtaSection, heroSection]);
  assert.throws(() => validatePagePlan(plan, manifest), /must start with a hero section/);
});

test('validatePagePlan: rejects a plan that does not end with final_cta', () => {
  const plan = basePlan([heroSection]);
  assert.throws(() => validatePagePlan(plan, manifest), /must end with a final_cta section/);
});

test('validatePagePlan: rejects a plan with a repeated section type', () => {
  const plan = basePlan([heroSection, { ...heroSection }, finalCtaSection]);
  assert.throws(() => validatePagePlan(plan, manifest), /repeats section type "hero"/);
});

test('validatePagePlan: rejects a section referencing an unknown imageId', () => {
  const plan = basePlan([{ ...heroSection, imageId: 'Image 99' }, finalCtaSection]);
  assert.throws(() => validatePagePlan(plan, manifest), /unknown image id "Image 99"/);
});

test('validatePagePlan: rejects an empty-string imageId on hero (required field, not just an unknown-id lookup)', () => {
  const plan = basePlan([{ ...heroSection, imageId: '' }, finalCtaSection]);
  assert.throws(() => validatePagePlan(plan, manifest), /"hero" section is missing required field "imageId"/);
});

test('validatePagePlan: rejects a hero section missing its required headline', () => {
  const plan = basePlan([{ ...heroSection, headline: '' }, finalCtaSection]);
  assert.throws(() => validatePagePlan(plan, manifest), /"hero" section is missing required field "headline"/);
});

test('validatePagePlan: rejects a benefits section with no items', () => {
  const plan = basePlan([
    heroSection,
    { type: 'benefits', headline: 'Why', items: [] },
    finalCtaSection,
  ]);
  assert.throws(() => validatePagePlan(plan, manifest), /"benefits" section is missing required list "items"/);
});

test('validatePagePlan: rejects a benefits item missing its required "body" field', () => {
  const plan = basePlan([
    heroSection,
    { type: 'benefits', headline: 'Why', items: [{ heading: 'Cozy', body: '' }, { heading: 'Warm', body: 'Keeps drinks warm.' }] },
    finalCtaSection,
  ]);
  assert.throws(() => validatePagePlan(plan, manifest), /"benefits" section has an item missing required field "body"/);
});

test('validatePagePlan: product_details has no required top-level fields (no headline), only requires non-empty items', () => {
  const plan = basePlan([
    heroSection,
    { type: 'product_details', items: [{ label: 'Material', value: 'Stoneware' }] },
    finalCtaSection,
  ]);
  assert.equal(validatePagePlan(plan, manifest), plan);
});

test('validatePagePlan: accepts a trust section with empty supportingFacts -- the AI declining to invent facts it has no evidence for is valid, not an error', () => {
  const plan = basePlan([
    heroSection,
    { type: 'trust', headline: 'Handmade with care', body: ['Every piece is made to order.'], supportingFacts: [] },
    finalCtaSection,
  ]);
  assert.equal(validatePagePlan(plan, manifest), plan);
});

test('validatePagePlan: rejects a trust section with an empty body (its one required field)', () => {
  const plan = basePlan([
    heroSection,
    { type: 'trust', headline: 'Handmade with care', body: [], supportingFacts: ['Small batch'] },
    finalCtaSection,
  ]);
  assert.throws(() => validatePagePlan(plan, manifest), /"trust" section is missing required list "body"/);
});

test('validatePagePlan: rejects a plan with no social posts', () => {
  const plan = basePlan([heroSection, finalCtaSection]);
  plan.socialPosts = [];
  assert.throws(() => validatePagePlan(plan, manifest), /has no social posts/);
});

test('validatePagePlan: checks imageId references inside lifestyle items', () => {
  const plan = basePlan([
    heroSection,
    { type: 'lifestyle', headline: 'H', items: [{ caption: 'c', imageId: 'Image 99' }] },
    finalCtaSection,
  ]);
  assert.throws(() => validatePagePlan(plan, manifest), /unknown image id "Image 99"/);
});

test('validatePagePlan: allows a null imageId on final_cta and emotional_story', () => {
  const plan = basePlan([
    heroSection,
    { type: 'emotional_story', headline: 'H', body: ['b'], imageId: null },
    finalCtaSection,
  ]);
  assert.equal(validatePagePlan(plan, manifest), plan);
});

test('validatePagePlan: rejects an image id the AI self-reported in images[] but that is not in the real manifest', () => {
  const plan = basePlan([heroSection, finalCtaSection]);
  const fakeManifest = [{ id: 'Image 99', url: 'https://img.etsystatic.com/real.jpg', thumbnailUrl: 'https://img.etsystatic.com/real-thumb.jpg' }];
  assert.throws(() => validatePagePlan(plan, fakeManifest), /unknown image id "Image 1"/);
});

test('validatePagePlan: merges the real manifest URL onto each classified image, dropping any AI-claimed image not in the manifest', () => {
  const plan = basePlan([heroSection, finalCtaSection]);
  plan.images = [
    { id: 'Image 1', classification: 'hero' },
    { id: 'Image 2', classification: 'lifestyle' },
  ];
  const result = validatePagePlan(plan, manifest);
  assert.deepEqual(result.images, [
    { id: 'Image 1', classification: 'hero', url: 'https://img.etsystatic.com/full.jpg', thumbnailUrl: 'https://img.etsystatic.com/570.jpg' },
  ]);
});
