import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PagePlanSchema, SOCIAL_PLATFORMS } from './pageStorySchema.js';

const validHero = {
  type: 'hero',
  eyebrow: 'HANDCRAFTED',
  headline: 'A Mug Worth Waking Up For',
  subheadline: 'Thrown by hand, one at a time.',
  imageId: 'Image 1',
  ctaText: 'Get Yours on Etsy',
  trustIndicators: ['Made to order'],
};

const validFinalCta = {
  type: 'final_cta',
  headline: 'Ready to make it yours?',
  supportingText: 'Every piece ships within 3 days.',
  ctaText: 'Get Yours on Etsy',
  imageId: null,
};

const validSocialPosts = [
  { platform: 'instagram', title: null, caption: 'A little cozy magic for your morning.', hashtags: ['handmade'] },
];

function buildPlan(overrides = {}) {
  return {
    productStory: {
      primaryAudience: 'Coffee lovers who appreciate handmade goods',
      emotionalAngle: 'A cozy, unhurried morning ritual',
      functionalAngle: 'Dishwasher-safe stoneware that holds heat well',
      primaryBuyerIntent: 'Self-purchase or a thoughtful gift',
    },
    images: [{ id: 'Image 1', classification: 'hero' }],
    sections: [validHero, validFinalCta],
    socialPosts: validSocialPosts,
    ...overrides,
  };
}

test('SOCIAL_PLATFORMS is the expected 3-platform list', () => {
  assert.deepEqual(SOCIAL_PLATFORMS, ['instagram', 'facebook', 'pinterest']);
});

test('PagePlanSchema accepts a minimal valid plan (hero + final_cta only)', () => {
  const result = PagePlanSchema.safeParse(buildPlan());
  assert.equal(result.success, true);
});

test('PagePlanSchema accepts every section type', () => {
  const plan = buildPlan({
    images: [
      { id: 'Image 1', classification: 'hero' },
      { id: 'Image 2', classification: 'lifestyle' },
    ],
    sections: [
      validHero,
      { type: 'emotional_story', headline: 'A quiet morning ritual', body: ['Every piece starts as a lump of clay.'], imageId: 'Image 2' },
      { type: 'benefits', headline: 'Why you will love it', items: [
        { heading: 'Keeps drinks warm', body: 'Thick stoneware walls hold heat far longer than thin ceramic.' },
        { heading: 'Dishwasher safe', body: 'No hand-washing required, ever.' },
        { heading: 'Made to order', body: 'Thrown fresh for your order, not pulled from a shelf.' },
      ] },
      { type: 'lifestyle', headline: 'Right at home', items: [{ caption: 'Morning coffee', imageId: 'Image 2' }] },
      { type: 'product_details', items: [{ label: 'Material', value: 'Stoneware' }] },
      { type: 'trust', headline: 'Handmade with care', body: 'Every mug is thrown and glazed by hand in a small studio.', supportingFacts: ['Handmade', 'Small batch'] },
      { type: 'buyer_intent', headline: 'A gift they will use daily', occasions: ['Housewarming', 'Birthday'] },
      validFinalCta,
    ],
  });
  const result = PagePlanSchema.safeParse(plan);
  assert.equal(result.success, true);
});

test('PagePlanSchema rejects a plan with fewer than 2 sections', () => {
  const result = PagePlanSchema.safeParse(buildPlan({ sections: [validHero] }));
  assert.equal(result.success, false);
});

test('PagePlanSchema rejects a benefits section with fewer than 3 items', () => {
  const plan = buildPlan({
    sections: [
      validHero,
      { type: 'benefits', headline: 'Why', items: [{ heading: 'A', body: 'B' }] },
      validFinalCta,
    ],
  });
  const result = PagePlanSchema.safeParse(plan);
  assert.equal(result.success, false);
});

test('PagePlanSchema rejects an unknown section type', () => {
  const plan = buildPlan({ sections: [validHero, { type: 'testimonials', headline: 'x' }, validFinalCta] });
  const result = PagePlanSchema.safeParse(plan);
  assert.equal(result.success, false);
});

test('PagePlanSchema requires at least one social post', () => {
  const result = PagePlanSchema.safeParse(buildPlan({ socialPosts: [] }));
  assert.equal(result.success, false);
});

test('PagePlanSchema allows a null eyebrow and null imageId where the field permits it', () => {
  const plan = buildPlan({
    sections: [
      { ...validHero, eyebrow: null },
      validFinalCta, // imageId: null already
    ],
  });
  const result = PagePlanSchema.safeParse(plan);
  assert.equal(result.success, true);
});
