import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PagePlanSchema, SOCIAL_PLATFORMS } from './pageStorySchema.js';

// SectionSchema is one flat shape for every section type (see the comment
// in pageStorySchema.js for why: Claude's structured-output grammar
// doesn't support z.discriminatedUnion). Every field must be present --
// null or an empty array for whatever a given `type` doesn't use.
const validHero = {
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
};

const validFinalCta = {
  type: 'final_cta',
  eyebrow: null,
  headline: 'Ready to make it yours?',
  subheadline: null,
  body: [],
  imageId: null,
  ctaText: 'Get Yours on Etsy',
  trustIndicators: [],
  items: [],
  supportingFacts: [],
  occasions: [],
  supportingText: 'Every piece ships within 3 days.',
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
  const blank = { eyebrow: null, headline: null, subheadline: null, body: [], imageId: null, ctaText: null, trustIndicators: [], items: [], supportingFacts: [], occasions: [], supportingText: null };
  const plan = buildPlan({
    images: [
      { id: 'Image 1', classification: 'hero' },
      { id: 'Image 2', classification: 'lifestyle' },
    ],
    sections: [
      validHero,
      { ...blank, type: 'emotional_story', headline: 'A quiet morning ritual', body: ['Every piece starts as a lump of clay.'], imageId: 'Image 2' },
      { ...blank, type: 'benefits', headline: 'Why you will love it', items: [
        { heading: 'Keeps drinks warm', body: 'Thick stoneware walls hold heat far longer than thin ceramic.', caption: null, imageId: null, label: null, value: null },
        { heading: 'Dishwasher safe', body: 'No hand-washing required, ever.', caption: null, imageId: null, label: null, value: null },
      ] },
      { ...blank, type: 'lifestyle', headline: 'Right at home', items: [{ heading: null, body: null, caption: 'Morning coffee', imageId: 'Image 2', label: null, value: null }] },
      { ...blank, type: 'product_details', items: [{ heading: null, body: null, caption: null, imageId: null, label: 'Material', value: 'Stoneware' }] },
      { ...blank, type: 'trust', headline: 'Handmade with care', body: ['Every mug is thrown and glazed by hand in a small studio.'], supportingFacts: ['Handmade', 'Small batch'] },
      { ...blank, type: 'buyer_intent', headline: 'A gift they will use daily', occasions: ['Housewarming', 'Birthday'] },
      validFinalCta,
    ],
  });
  const result = PagePlanSchema.safeParse(plan);
  assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error?.issues));
});

// Claude's structured-output grammar only supports array minItems of
// exactly 0 or 1, and doesn't support maxItems at all -- so, unlike an
// earlier version of this schema, PagePlanSchema itself no longer bounds
// how many sections/items a plan has. That "2-8 sections" / "3-6 benefit
// items" style requirement is enforced by validatePagePlan at runtime
// instead (see lib/pageStoryGenerator.test.js). These two tests document
// that the schema layer deliberately allows what it used to reject.
test('PagePlanSchema does not itself restrict section count (enforced at runtime instead)', () => {
  const result = PagePlanSchema.safeParse(buildPlan({ sections: [validHero] }));
  assert.equal(result.success, true);
});

test('PagePlanSchema does not itself restrict a benefits section\'s item count (enforced at runtime instead)', () => {
  const blank = { eyebrow: null, headline: null, subheadline: null, body: [], imageId: null, ctaText: null, trustIndicators: [], items: [], supportingFacts: [], occasions: [], supportingText: null };
  const plan = buildPlan({
    sections: [
      validHero,
      { ...blank, type: 'benefits', headline: 'Why', items: [{ heading: 'A', body: 'B', caption: null, imageId: null, label: null, value: null }] },
      validFinalCta,
    ],
  });
  const result = PagePlanSchema.safeParse(plan);
  assert.equal(result.success, true);
});

test('PagePlanSchema rejects an unknown section type', () => {
  const blank = { eyebrow: null, headline: 'x', subheadline: null, body: [], imageId: null, ctaText: null, trustIndicators: [], items: [], supportingFacts: [], occasions: [], supportingText: null };
  const plan = buildPlan({ sections: [validHero, { ...blank, type: 'testimonials' }, validFinalCta] });
  const result = PagePlanSchema.safeParse(plan);
  assert.equal(result.success, false);
});

test('PagePlanSchema requires at least one social post to be a well-formed SocialPostSchema entry (empty array is schema-valid; validatePagePlan rejects it at runtime -- see pageStoryGenerator.test.js)', () => {
  const result = PagePlanSchema.safeParse(buildPlan({ socialPosts: [] }));
  assert.equal(result.success, true);
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
