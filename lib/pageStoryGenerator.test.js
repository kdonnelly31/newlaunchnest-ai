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
    { id: 'Image 1', url: 'https://img.etsystatic.com/full1.jpg' },
    { id: 'Image 2', url: 'https://img.etsystatic.com/full2.jpg' },
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
    { id: 'Image 1', url: 'https://img.etsystatic.com/a.jpg' },
    { id: 'Image 3', url: 'https://img.etsystatic.com/c.jpg' },
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

// --- validatePagePlan ---

const heroSection = { type: 'hero', eyebrow: null, headline: 'H', subheadline: 'S', imageId: 'Image 1', ctaText: 'Buy', trustIndicators: [] };
const finalCtaSection = { type: 'final_cta', headline: 'H2', supportingText: 'S2', ctaText: 'Buy', imageId: null };
const images = [{ id: 'Image 1', classification: 'hero' }];

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
  assert.equal(validatePagePlan(plan), plan);
});

test('validatePagePlan: rejects a plan that does not start with hero', () => {
  const plan = basePlan([finalCtaSection, heroSection]);
  assert.throws(() => validatePagePlan(plan), /must start with a hero section/);
});

test('validatePagePlan: rejects a plan that does not end with final_cta', () => {
  const plan = basePlan([heroSection]);
  assert.throws(() => validatePagePlan(plan), /must end with a final_cta section/);
});

test('validatePagePlan: rejects a plan with a repeated section type', () => {
  const plan = basePlan([heroSection, { ...heroSection }, finalCtaSection]);
  assert.throws(() => validatePagePlan(plan), /repeats section type "hero"/);
});

test('validatePagePlan: rejects a section referencing an unknown imageId', () => {
  const plan = basePlan([{ ...heroSection, imageId: 'Image 99' }, finalCtaSection]);
  assert.throws(() => validatePagePlan(plan), /unknown image id "Image 99"/);
});

test('validatePagePlan: rejects an empty-string imageId on hero (not a falsy skip)', () => {
  const plan = basePlan([{ ...heroSection, imageId: '' }, finalCtaSection]);
  assert.throws(() => validatePagePlan(plan), /unknown image id ""/);
});

test('validatePagePlan: checks imageId references inside lifestyle items', () => {
  const plan = basePlan([
    heroSection,
    { type: 'lifestyle', headline: 'H', items: [{ caption: 'c', imageId: 'Image 99' }] },
    finalCtaSection,
  ]);
  assert.throws(() => validatePagePlan(plan), /unknown image id "Image 99"/);
});

test('validatePagePlan: allows a null imageId on final_cta and emotional_story', () => {
  const plan = basePlan([
    heroSection,
    { type: 'emotional_story', headline: 'H', body: ['b'], imageId: null },
    finalCtaSection,
  ]);
  assert.equal(validatePagePlan(plan), plan);
});
