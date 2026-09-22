# Conversion Story Landing Page Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat, one-template landing-page generator with an AI system that analyzes each product's real story (audience, emotional/functional angle, trust signals, giftability), looks at the actual product photos, and assembles only the page sections that genuinely fit — while every already-published page keeps rendering exactly as it does today.

**Architecture:** One multimodal Claude call (`generatePageStory`, in a new `lib/pageStoryGenerator.js`) replaces `generateLandingCopy`, receiving both listing text and real product images (sent by URL, Claude's API supports this directly), returning a structured "page plan" validated by a new Zod schema (`lib/pageStorySchema.js`). `lib/landingPageTemplate.js` gains a second rendering path — one small pure function per section type — dispatched by a `schemaVersion` marker stored alongside the plan; rows with no marker (every page that exists today) keep using the original, completely unmodified renderer.

**Tech Stack:** Node.js (ESM), `@anthropic-ai/sdk` (`messages.parse` + `zodOutputFormat`, already in use), `zod` (already in use), plain `node:test` / `node:assert/strict` (existing convention, no new test framework).

**Spec:** `docs/superpowers/specs/2026-09-21-conversion-story-landing-pages-design.md`

## Global Constraints

- No new npm dependencies — `@anthropic-ai/sdk` and `zod` already cover everything needed; images are sent to Claude by URL (`source: { type: 'url', url }`), no download/re-hosting.
- No database migration — `landing_pages.content` is already `jsonb`; the new shape is distinguished by `content.schemaVersion === 2`, absent on every existing row.
- Every existing published page (no `schemaVersion` on its stored content) must render **byte-for-byte identically** to today, verified by every pre-existing test in `lib/landingPageTemplate.test.js` continuing to pass completely unmodified.
- `generatePageStory()` is not unit-tested directly (no live AI calls in tests) — matches the existing convention (`generateLandingCopy()` today, `getValidEtsyToken()` in `lib/etsyOAuth.js`). Its pure helper pieces (`buildImageContentBlocks`, `validatePagePlan`) are fully unit-tested.
- Section renderers are tested indirectly through `renderLandingPageDocument()`, exactly like today's tests do — no new renderer function is exported from `lib/landingPageTemplate.js` beyond what's already exported (`escapeHtml`, `renderLandingPageDocument`, `renderNotFoundPage`).
- One polished, mobile-first layout per section type — no per-section layout variants (explicitly out of scope per the spec).
- Every AI-facing instruction preserves the existing anti-fabrication rule verbatim in spirit: never invent facts, materials, claims, reviews, scarcity, or trust signals not present in the source listing data.

---

### Task 1: Page Plan Schema (`lib/pageStorySchema.js`)

**Files:**
- Create: `lib/pageStorySchema.js`
- Test: `lib/pageStorySchema.test.js`

**Interfaces:**
- Produces: `SOCIAL_PLATFORMS` (array, `['instagram', 'facebook', 'pinterest']`), `PagePlanSchema` (Zod schema), `SectionSchema` (Zod discriminated union, exported for the validation helper in Task 2).

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/pageStorySchema.test.js`
Expected: FAIL — `pageStorySchema.js` doesn't exist yet.

- [ ] **Step 3: Implement**

```js
import { z } from 'zod';

// Matches the 3 platforms lib/pageStoryGenerator.js drafts a social post
// for, and the `platform` enum every socialPosts entry must use.
export const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'pinterest'];

const SocialPostSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  title: z.string().nullable().describe('Only for Pinterest: a keyword-rich pin title under 100 characters. Null for every other platform.'),
  caption: z.string().describe('The main post text, written in the voice, length, and norms of the target platform'),
  hashtags: z.array(z.string()).max(12).describe('Hashtags without the # symbol'),
});

const ImageClassification = z.enum([
  'hero', 'lifestyle', 'product', 'detail', 'material_texture',
  'use_case', 'variation', 'packaging', 'gift', 'instructional', 'other',
]);

const ClassifiedImageSchema = z.object({
  id: z.string().describe('Matches the "Image N" label this image was sent under, e.g. "Image 1"'),
  classification: ImageClassification,
});

// One discriminated-union member per section type keeps each section's
// fields exact and required for that type, instead of one loose object
// with every possible field optional.
const HeroSection = z.object({
  type: z.literal('hero'),
  eyebrow: z.string().nullable().describe('Short tag line, 2-5 words. Null if none fits.'),
  headline: z.string().describe('4-10 words, punchy and distinctive -- not just the raw listing title'),
  subheadline: z.string().describe('1-2 short sentences'),
  imageId: z.string(),
  ctaText: z.string().describe('e.g. "Get Yours on Etsy"'),
  trustIndicators: z.array(z.string()).max(3).describe('Very short, factual trust phrases -- only if genuinely supported by the listing'),
});

const EmotionalStorySection = z.object({
  type: z.literal('emotional_story'),
  headline: z.string().describe('3-8 words'),
  body: z.array(z.string()).min(1).max(3).describe('1-3 short paragraphs, 1-2 sentences each'),
  imageId: z.string().nullable(),
});

const BenefitsSection = z.object({
  type: z.literal('benefits'),
  headline: z.string(),
  items: z.array(z.object({
    heading: z.string().describe('3-6 words'),
    body: z.string().describe('5-15 words, a buyer-centered benefit, not just a feature restated'),
  })).min(3).max(6),
});

const LifestyleSection = z.object({
  type: z.literal('lifestyle'),
  headline: z.string(),
  items: z.array(z.object({
    caption: z.string().describe('Very short'),
    imageId: z.string(),
  })).min(1).max(4),
});

const ProductDetailsSection = z.object({
  type: z.literal('product_details'),
  items: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })).min(1),
});

const TrustSection = z.object({
  type: z.literal('trust'),
  headline: z.string(),
  body: z.string().describe('1-2 short sentences'),
  supportingFacts: z.array(z.string()).min(1).max(4),
});

const BuyerIntentSection = z.object({
  type: z.literal('buyer_intent'),
  headline: z.string(),
  occasions: z.array(z.string()).min(1).max(6),
});

const FinalCtaSection = z.object({
  type: z.literal('final_cta'),
  headline: z.string(),
  supportingText: z.string().describe('Short, 1 sentence'),
  ctaText: z.string(),
  imageId: z.string().nullable(),
});

export const SectionSchema = z.discriminatedUnion('type', [
  HeroSection, EmotionalStorySection, BenefitsSection, LifestyleSection,
  ProductDetailsSection, TrustSection, BuyerIntentSection, FinalCtaSection,
]);

export const PagePlanSchema = z.object({
  productStory: z.object({
    primaryAudience: z.string(),
    emotionalAngle: z.string(),
    functionalAngle: z.string(),
    primaryBuyerIntent: z.string(),
  }),
  images: z.array(ClassifiedImageSchema),
  sections: z.array(SectionSchema).min(2).max(8),
  socialPosts: z.array(SocialPostSchema).min(1).max(SOCIAL_PLATFORMS.length),
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/pageStorySchema.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/pageStorySchema.js lib/pageStorySchema.test.js
git commit -m "Add the conversion-story page plan schema"
```

---

### Task 2: Image Selection, Validation, and the AI Call (`lib/pageStoryGenerator.js`)

**Files:**
- Create: `lib/pageStoryGenerator.js`
- Test: `lib/pageStoryGenerator.test.js`

**Interfaces:**
- Consumes: `PagePlanSchema` from `lib/pageStorySchema.js` (Task 1).
- Produces:
  - `buildImageContentBlocks(images, maxImages = 10)` → `{ contentBlocks: Array, manifest: Array<{id, url}> }`
  - `validatePagePlan(pagePlan)` → returns `pagePlan` unchanged on success, throws `Error` with a descriptive message on failure
  - `generatePageStory(anthropic, listing, platforms)` → `Promise<PagePlan>` — takes the Anthropic client as an explicit parameter (dependency injection, matching `getValidEtsyToken(supabaseAdmin, clientId)`'s existing pattern in `lib/etsyOAuth.js`) rather than importing or instantiating its own client.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/pageStoryGenerator.test.js`
Expected: FAIL — `pageStoryGenerator.js` doesn't exist yet.

- [ ] **Step 3: Implement**

```js
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { PagePlanSchema } from './pageStorySchema.js';

const MAX_IMAGES = 10;

const PLATFORM_GUIDANCE = {
  facebook: 'Facebook: a warm, conversational caption (2-4 sentences), like a small-shop owner talking to regulars. 0-3 hashtags at most. No title.',
  instagram: 'Instagram: an inviting caption (roughly 60-120 words) with a bit of storytelling, ending on a soft call-to-action. 8-12 relevant hashtags. No title.',
  pinterest: 'Pinterest: a keyword-rich, benefit-led title (under 100 characters) plus a descriptive caption (2-3 sentences) written to surface in search. 3-6 hashtags.',
};

// Picks up to `maxImages` from the listing's own image order (Etsy sellers
// typically put their best/primary shot first) and builds the alternating
// "Image N:" label + image-block content Claude's API docs recommend for
// multi-image requests -- the label is also what lets the model's
// structured output refer back to a specific photo by a stable id instead
// of a URL.
export function buildImageContentBlocks(images, maxImages = MAX_IMAGES) {
  const selected = (images || []).slice(0, maxImages);
  const contentBlocks = [];
  const manifest = [];

  selected.forEach((image, index) => {
    const url = image.url_fullxfull || image.url_570xN;
    if (!url) return;
    const id = `Image ${index + 1}`;
    contentBlocks.push({ type: 'text', text: `${id}:` });
    contentBlocks.push({ type: 'image', source: { type: 'url', url } });
    manifest.push({ id, url });
  });

  return { contentBlocks, manifest };
}

// Enforces the structural rules the Zod schema can't express on its own:
// the conversion arc must start with hero and end with final_cta, no
// section type repeats, and every imageId a section references must be
// one the model was actually shown and classified.
export function validatePagePlan(pagePlan) {
  const { sections, images } = pagePlan;

  if (sections[0]?.type !== 'hero') {
    throw new Error('Page plan must start with a hero section.');
  }
  if (sections.at(-1)?.type !== 'final_cta') {
    throw new Error('Page plan must end with a final_cta section.');
  }

  const seenTypes = new Set();
  for (const section of sections) {
    if (seenTypes.has(section.type)) {
      throw new Error(`Page plan repeats section type "${section.type}".`);
    }
    seenTypes.add(section.type);
  }

  const knownImageIds = new Set(images.map(img => img.id));
  const referencedImageIds = sections.flatMap(section => {
    if (section.type === 'lifestyle') return section.items.map(item => item.imageId);
    if ('imageId' in section && section.imageId) return [section.imageId];
    return [];
  });
  for (const imageId of referencedImageIds) {
    if (!knownImageIds.has(imageId)) {
      throw new Error(`Page plan references unknown image id "${imageId}".`);
    }
  }

  return pagePlan;
}

// Replaces the old generateLandingCopy(): one multimodal call that sees the
// product's real photos alongside its text and returns a full page plan
// (product story + which sections fit + section copy + image placement) in
// one structured-output response, following the same
// messages.parse + zodOutputFormat + adaptive-thinking pattern the previous
// generator already used successfully.
export async function generatePageStory(anthropic, listing, platforms) {
  const { contentBlocks, manifest } = buildImageContentBlocks(listing.images);
  const platformInstructions = platforms.map(p => `- ${PLATFORM_GUIDANCE[p]}`).join('\n');
  const imageIdList = manifest.map(m => m.id).join(', ') || '(no images available)';

  const response = await anthropic.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: zodOutputFormat(PagePlanSchema) },
    system:
      'You are a marketing strategist, copywriter, and creative director for a boutique e-commerce landing page builder. ' +
      'Analyze the handmade/vintage Etsy product below -- who is most likely to buy it, what emotional and functional angles matter, ' +
      'what makes it different, and what (if anything) makes it giftable or trustworthy -- then design a landing page assembled only from sections that genuinely fit this product. ' +
      'A hero section and a final_cta section are always required; every other section type is optional -- include it only when the listing data genuinely supports it, and omit it entirely rather than filling it with generic or invented content. ' +
      'Never invent facts, materials, dimensions, claims, reviews, ratings, or scarcity not present in the listing data -- you may rephrase and elevate what is given, but do not fabricate details, and that includes what you say about the photos. ' +
      `You were shown these images, in this order, labeled by id: ${imageIdList}. Classify every image you were shown in the "images" output field, and reference a photo's id (never a URL) from any section that uses it. ` +
      'Sound like a confident independent brand, not a hype-filled ad. No emojis. No exclamation-point spam (at most one, if any). ' +
      `Also draft one social media post per platform below -- write distinct copy per platform, not the same text reused:\n${platformInstructions}\n` +
      `socialPosts must contain exactly ${platforms.length} entr${platforms.length === 1 ? 'y' : 'ies'}, one per platform listed above, each with its "platform" field set exactly to that platform's name.`,
    messages: [
      {
        role: 'user',
        content: [
          ...contentBlocks,
          {
            type: 'text',
            text: JSON.stringify({
              title: listing.title,
              description: listing.description,
              price: listing.price,
              currency: listing.currency,
              tags: listing.tags,
              materials: listing.materials,
              shopName: listing.shopName,
            }),
          },
        ],
      },
    ],
  });

  if (!response.parsed_output) {
    throw new Error('Claude did not return a parseable page plan.');
  }
  return validatePagePlan(response.parsed_output);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/pageStoryGenerator.test.js`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/pageStoryGenerator.js lib/pageStoryGenerator.test.js
git commit -m "Add image selection, plan validation, and the page-story AI call"
```

---

### Task 3: Section Renderers and Dual-Path Rendering (`lib/landingPageTemplate.js`)

**Files:**
- Modify: `lib/landingPageTemplate.js`
- Modify: `lib/landingPageTemplate.test.js` (append; do not change existing tests)

**Interfaces:**
- Consumes: nothing imported from Tasks 1-2 — this file works with plain JS objects shaped like a validated `PagePlan`, matching the existing convention that this file has no dependency on the Zod schema itself.
- Produces: `renderLandingPageDocument({ listing, copy, pagePlan, price, colors, pageUrl, schemaVersion })` — same exported name, extended signature. When `schemaVersion !== 2`, behavior and output are **byte-for-byte identical** to today (every existing caller and test omits `pagePlan`/`schemaVersion` and gets the exact same result as before). `escapeHtml`, `renderNotFoundPage` unchanged. No new function is exported.

- [ ] **Step 1: Write the failing tests (append to the existing file)**

```js
// --- schemaVersion 2 (conversion-story) rendering ---

const sampleHeroSection = {
  type: 'hero',
  eyebrow: 'HANDCRAFTED',
  headline: 'A Mug Worth Waking Up For',
  subheadline: 'Thrown by hand, one at a time.',
  imageId: 'Image 1',
  ctaText: 'Get Yours on Etsy',
  trustIndicators: ['Made to order', 'Ships in 3 days'],
};

const sampleFinalCtaSection = {
  type: 'final_cta',
  headline: 'Ready to make it yours?',
  supportingText: 'Every piece ships within 3 days.',
  ctaText: 'Get Yours on Etsy',
  imageId: 'Image 1',
};

const samplePagePlan = {
  productStory: { primaryAudience: 'x', emotionalAngle: 'x', functionalAngle: 'x', primaryBuyerIntent: 'x' },
  images: [{ id: 'Image 1', classification: 'hero', url: 'https://img.etsystatic.com/full.jpg' }],
  sections: [sampleHeroSection, sampleFinalCtaSection],
  socialPosts: [],
};

test('v2: renders the hero section headline, subheadline, CTA, and trust indicators', () => {
  const html = renderLandingPageDocument({
    listing: sampleListing, pagePlan: samplePagePlan, price: '18.00', colors: null, schemaVersion: 2,
  });
  assert.match(html, /A Mug Worth Waking Up For/);
  assert.match(html, /Thrown by hand, one at a time\./);
  assert.match(html, /Made to order/);
  assert.match(html, /href="https:\/\/www\.etsy\.com\/listing\/123\/mug"/);
});

test('v2: renders the final_cta section', () => {
  const html = renderLandingPageDocument({
    listing: sampleListing, pagePlan: samplePagePlan, price: '18.00', colors: null, schemaVersion: 2,
  });
  assert.match(html, /Ready to make it yours\?/);
  assert.match(html, /Every piece ships within 3 days\./);
});

test('v2: renders sections in the order given', () => {
  const plan = {
    ...samplePagePlan,
    sections: [
      sampleHeroSection,
      { type: 'trust', headline: 'Handmade with care', body: 'Every mug is made by hand.', supportingFacts: ['Small batch'] },
      sampleFinalCtaSection,
    ],
  };
  const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: plan, price: '18.00', colors: null, schemaVersion: 2 });
  const heroIndex = html.indexOf('A Mug Worth Waking Up For');
  const trustIndex = html.indexOf('Handmade with care');
  const ctaIndex = html.indexOf('Ready to make it yours?');
  assert.ok(heroIndex < trustIndex, 'hero should render before trust');
  assert.ok(trustIndex < ctaIndex, 'trust should render before final_cta');
});

test('v2: renders an emotional_story section with a null imageId (no image) without throwing', () => {
  const plan = {
    ...samplePagePlan,
    sections: [
      sampleHeroSection,
      { type: 'emotional_story', headline: 'A quiet ritual', body: ['Every piece starts as a lump of clay.'], imageId: null },
      sampleFinalCtaSection,
    ],
  };
  assert.doesNotThrow(() => {
    const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: plan, price: '18.00', colors: null, schemaVersion: 2 });
    assert.match(html, /A quiet ritual/);
    assert.match(html, /Every piece starts as a lump of clay\./);
  });
});

test('v2: renders a benefits section with 3+ items', () => {
  const plan = {
    ...samplePagePlan,
    sections: [
      sampleHeroSection,
      { type: 'benefits', headline: 'Why you will love it', items: [
        { heading: 'Keeps drinks warm', body: 'Thick stoneware holds heat.' },
        { heading: 'Dishwasher safe', body: 'No hand-washing required.' },
        { heading: 'Made to order', body: 'Thrown fresh for your order.' },
      ] },
      sampleFinalCtaSection,
    ],
  };
  const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: plan, price: '18.00', colors: null, schemaVersion: 2 });
  assert.match(html, /Keeps drinks warm/);
  assert.match(html, /Dishwasher safe/);
  assert.match(html, /Made to order/);
});

test('v2: renders a lifestyle section, matching each item to its classified image', () => {
  const plan = {
    ...samplePagePlan,
    images: [
      { id: 'Image 1', classification: 'hero', url: 'https://img.etsystatic.com/full.jpg' },
      { id: 'Image 2', classification: 'lifestyle', url: 'https://img.etsystatic.com/lifestyle.jpg' },
    ],
    sections: [
      sampleHeroSection,
      { type: 'lifestyle', headline: 'Right at home', items: [{ caption: 'Morning coffee', imageId: 'Image 2' }] },
      sampleFinalCtaSection,
    ],
  };
  const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: plan, price: '18.00', colors: null, schemaVersion: 2 });
  assert.match(html, /Morning coffee/);
  assert.match(html, /https:\/\/img\.etsystatic\.com\/lifestyle\.jpg/);
});

test('v2: renders product_details as a label/value list, with no AI-supplied headline (fixed heading)', () => {
  const plan = {
    ...samplePagePlan,
    sections: [
      sampleHeroSection,
      { type: 'product_details', items: [{ label: 'Material', value: 'Stoneware' }, { label: 'Capacity', value: '12 oz' }] },
      sampleFinalCtaSection,
    ],
  };
  const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: plan, price: '18.00', colors: null, schemaVersion: 2 });
  assert.match(html, /Material/);
  assert.match(html, /Stoneware/);
  assert.match(html, /Capacity/);
  assert.match(html, /12 oz/);
});

test('v2: renders trust and buyer_intent sections', () => {
  const plan = {
    ...samplePagePlan,
    sections: [
      sampleHeroSection,
      { type: 'trust', headline: 'Handmade with care', body: 'Every mug is thrown by hand.', supportingFacts: ['Small batch', 'Handmade'] },
      { type: 'buyer_intent', headline: 'A gift they will use daily', occasions: ['Housewarming', 'Birthday'] },
      sampleFinalCtaSection,
    ],
  };
  const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: plan, price: '18.00', colors: null, schemaVersion: 2 });
  assert.match(html, /Handmade with care/);
  assert.match(html, /Small batch/);
  assert.match(html, /A gift they will use daily/);
  assert.match(html, /Housewarming/);
});

test('v2: escapes HTML-significant characters in section copy', () => {
  const plan = {
    ...samplePagePlan,
    sections: [
      { ...sampleHeroSection, headline: '<img src=x onerror=alert(1)>' },
      sampleFinalCtaSection,
    ],
  };
  const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: plan, price: '18.00', colors: null, schemaVersion: 2 });
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
});

test('v2: <title> and og:title/og:description use the hero section, not `copy`', () => {
  const html = renderLandingPageDocument({
    listing: sampleListing, pagePlan: samplePagePlan, price: '18.00', colors: null, schemaVersion: 2,
    pageUrl: 'https://example.com/p/abc-123',
  });
  assert.match(html, /<title>A Mug Worth Waking Up For<\/title>/);
  assert.match(html, /<meta property="og:title" content="A Mug Worth Waking Up For" \/>/);
  assert.match(html, /<meta property="og:description" content="Thrown by hand, one at a time\." \/>/);
});

test('v2: og:image uses the hero section\'s classified image URL', () => {
  const html = renderLandingPageDocument({
    listing: sampleListing, pagePlan: samplePagePlan, price: '18.00', colors: null, schemaVersion: 2,
    pageUrl: 'https://example.com/p/abc-123',
  });
  assert.match(html, /<meta property="og:image" content="https:\/\/img\.etsystatic\.com\/full\.jpg" \/>/);
});

test('v2: includes the same share-link button as v1', () => {
  const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: samplePagePlan, price: '18.00', colors: null, schemaVersion: 2 });
  assert.match(html, /id="lp-share-btn"/);
  assert.match(html, /navigator\.clipboard\.writeText\(window\.location\.href\)/);
});

test('a call with no schemaVersion still renders the original v1 template (backward compatibility)', () => {
  const html = renderLandingPageDocument({ listing: sampleListing, copy: sampleCopy, price: '18.00', colors: null });
  assert.match(html, /A Mug Worth Waking Up For/);
  assert.doesNotMatch(html, /lp-benefits-grid/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/landingPageTemplate.test.js`
Expected: FAIL — the new tests fail (`renderLandingPageDocument` doesn't yet handle `schemaVersion`/`pagePlan`); every pre-existing test still passes.

- [ ] **Step 3: Implement**

Add the following to `lib/landingPageTemplate.js`. First, extend `LP_STYLES` (append inside the existing template literal, right before its closing backtick) with these new rules:

```css
  .lp-section-headline {
    font-size: clamp(1.5rem, 2.6vw, 2rem);
    font-weight: 500;
    text-align: center;
    margin: 0 0 2rem;
  }

  .lp-emotional-centered {
    max-width: 720px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem;
    text-align: center;
  }
  .lp-emotional-centered .lp-story-body p {
    font-size: 1.05rem;
    line-height: 1.75;
    color: var(--lp-ink-soft);
    margin: 0 0 1.1rem;
  }
  .lp-emotional-split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3rem;
    align-items: center;
    max-width: 1160px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem;
  }
  .lp-emotional-media img {
    width: 100%;
    aspect-ratio: 4 / 5;
    object-fit: cover;
    border-radius: 3px;
    background: #eee7d9;
  }
  .lp-emotional-split .lp-story-body p {
    font-size: 1.02rem;
    line-height: 1.75;
    color: var(--lp-ink-soft);
    margin: 0 0 1.1rem;
  }

  .lp-benefits {
    max-width: 1160px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem;
  }
  .lp-benefits-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1.75rem;
  }
  .lp-benefit-card {
    padding: 1.5rem;
    border: 1px solid var(--lp-line);
    border-radius: 4px;
  }
  .lp-benefit-heading {
    font-size: 1.02rem;
    font-weight: 600;
    margin: 0 0 .5rem;
  }
  .lp-benefit-body {
    font-size: .92rem;
    line-height: 1.5;
    color: var(--lp-ink-soft);
    margin: 0;
  }

  .lp-lifestyle {
    max-width: 1160px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem;
  }
  .lp-lifestyle-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1.5rem;
  }
  .lp-lifestyle-item img {
    width: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
    border-radius: 3px;
    background: #eee7d9;
    margin: 0 0 .6rem;
  }
  .lp-lifestyle-item figcaption {
    font-size: .85rem;
    color: var(--lp-ink-soft);
    text-align: center;
  }

  .lp-details {
    max-width: 720px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem;
  }
  .lp-details-list { margin: 0; }
  .lp-details-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: .75rem 0;
    border-bottom: 1px solid var(--lp-line);
  }
  .lp-details-row dt { font-weight: 600; color: var(--lp-ink); }
  .lp-details-row dd { margin: 0; color: var(--lp-ink-soft); text-align: right; }

  .lp-trust {
    max-width: 720px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem;
    text-align: center;
  }
  .lp-trust-body {
    font-size: 1.02rem;
    line-height: 1.65;
    color: var(--lp-ink-soft);
    margin: 0 0 1.4rem;
  }
  .lp-trust-facts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: .6rem;
  }
  .lp-trust-facts li {
    font-family: "JetBrains Mono", monospace;
    font-size: .78rem;
    border: 1px solid var(--lp-accent);
    color: var(--lp-accent);
    border-radius: 999px;
    padding: .35rem .9rem;
  }

  .lp-buyer-intent {
    max-width: 860px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem;
    text-align: center;
  }
  .lp-occasion-chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: .6rem;
  }
  .lp-occasion-chips li {
    font-size: .88rem;
    background: var(--lp-line);
    color: var(--lp-ink);
    border-radius: 999px;
    padding: .45rem 1.1rem;
  }

  .lp-trust-indicators {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: .5rem 1.2rem;
    margin: 1.2rem 0 0;
    padding: 0;
  }
  .lp-trust-indicators li {
    font-size: .82rem;
    color: var(--lp-ink-soft);
    padding-left: 1.1rem;
    position: relative;
  }
  .lp-trust-indicators li::before {
    content: "✓";
    position: absolute;
    left: 0;
    color: var(--lp-accent);
    font-weight: 600;
  }

  .lp-final-cta-image {
    width: 160px;
    height: 160px;
    object-fit: cover;
    border-radius: 3px;
    margin: 0 auto 1.5rem;
    display: block;
    background: #eee7d9;
  }
  .lp-final-cta-support {
    color: var(--lp-ink-soft);
    max-width: 46ch;
    margin: 0 auto 1.8rem;
  }

  @media (max-width: 760px) {
    .lp-emotional-split { grid-template-columns: 1fr; gap: 1.75rem; }
    .lp-details-row { flex-direction: column; gap: .2rem; }
    .lp-details-row dd { text-align: left; }
  }
```

Then add the section renderers, the dispatch table, `renderLandingPageBodyV2`, and update `renderLandingPageDocument` — insert this new code after the existing `renderLandingPageBody` function and before `export function renderLandingPageDocument`:

```js
function renderHeroSection(section, imagesById, listing, price) {
  const image = imagesById.get(section.imageId);
  return `
    <section class="lp-hero">
      <div class="lp-hero-media">
        ${image ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(listing.title)}" />` : ''}
        ${price ? `<div class="lp-price-tag lp-mono">$${price}<span class="lp-currency">${escapeHtml(listing.price?.currency_code ?? '')}</span></div>` : ''}
      </div>
      <div class="lp-hero-content">
        ${section.eyebrow ? `<span class="lp-eyebrow">${escapeHtml(section.eyebrow)}</span>` : ''}
        <h1 class="lp-headline lp-display">${escapeHtml(section.headline)}</h1>
        <p class="lp-subheadline">${escapeHtml(section.subheadline)}</p>
        <a class="lp-cta" href="${escapeHtml(listing.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(section.ctaText)} →</a>
        ${section.trustIndicators.length ? `
          <ul class="lp-trust-indicators">
            ${section.trustIndicators.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
          </ul>
        ` : ''}
      </div>
    </section>
  `;
}

function renderEmotionalStorySection(section, imagesById) {
  const image = section.imageId ? imagesById.get(section.imageId) : null;
  const bodyHtml = section.body.map(p => `<p>${escapeHtml(p)}</p>`).join('');
  if (image) {
    return `
      <section class="lp-emotional-split">
        <div class="lp-emotional-media"><img src="${escapeHtml(image.url)}" alt="" loading="lazy" /></div>
        <div>
          <h2 class="lp-section-headline lp-display">${escapeHtml(section.headline)}</h2>
          <div class="lp-story-body">${bodyHtml}</div>
        </div>
      </section>
    `;
  }
  return `
    <section class="lp-emotional-centered">
      <h2 class="lp-section-headline lp-display">${escapeHtml(section.headline)}</h2>
      <div class="lp-story-body">${bodyHtml}</div>
    </section>
  `;
}

function renderBenefitsSection(section) {
  return `
    <section class="lp-benefits">
      <h2 class="lp-section-headline lp-display">${escapeHtml(section.headline)}</h2>
      <div class="lp-benefits-grid">
        ${section.items.map(item => `
          <div class="lp-benefit-card">
            <h3 class="lp-benefit-heading">${escapeHtml(item.heading)}</h3>
            <p class="lp-benefit-body">${escapeHtml(item.body)}</p>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderLifestyleSection(section, imagesById) {
  const items = section.items
    .map(item => ({ ...item, image: imagesById.get(item.imageId) }))
    .filter(item => item.image);
  if (!items.length) return '';
  return `
    <section class="lp-lifestyle">
      <h2 class="lp-section-headline lp-display">${escapeHtml(section.headline)}</h2>
      <div class="lp-lifestyle-grid">
        ${items.map(item => `
          <figure class="lp-lifestyle-item">
            <img src="${escapeHtml(item.image.url)}" alt="" loading="lazy" />
            <figcaption>${escapeHtml(item.caption)}</figcaption>
          </figure>
        `).join('')}
      </div>
    </section>
  `;
}

function renderProductDetailsSection(section) {
  return `
    <section class="lp-details">
      <h2 class="lp-section-headline lp-display">Product Details</h2>
      <dl class="lp-details-list">
        ${section.items.map(item => `
          <div class="lp-details-row">
            <dt>${escapeHtml(item.label)}</dt>
            <dd>${escapeHtml(item.value)}</dd>
          </div>
        `).join('')}
      </dl>
    </section>
  `;
}

function renderTrustSection(section) {
  return `
    <section class="lp-trust">
      <h2 class="lp-section-headline lp-display">${escapeHtml(section.headline)}</h2>
      <p class="lp-trust-body">${escapeHtml(section.body)}</p>
      <ul class="lp-trust-facts">
        ${section.supportingFacts.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
      </ul>
    </section>
  `;
}

function renderBuyerIntentSection(section) {
  return `
    <section class="lp-buyer-intent">
      <h2 class="lp-section-headline lp-display">${escapeHtml(section.headline)}</h2>
      <ul class="lp-occasion-chips">
        ${section.occasions.map(o => `<li>${escapeHtml(o)}</li>`).join('')}
      </ul>
    </section>
  `;
}

function renderFinalCtaSection(section, imagesById, listing) {
  const image = section.imageId ? imagesById.get(section.imageId) : null;
  return `
    <section class="lp-final-cta">
      ${image ? `<img class="lp-final-cta-image" src="${escapeHtml(image.url)}" alt="" loading="lazy" />` : ''}
      <h2 class="lp-display">${escapeHtml(section.headline)}</h2>
      <p class="lp-final-cta-support">${escapeHtml(section.supportingText)}</p>
      <a class="lp-cta" href="${escapeHtml(listing.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(section.ctaText)} →</a>
    </section>
  `;
}

const SECTION_RENDERERS = {
  hero: renderHeroSection,
  emotional_story: renderEmotionalStorySection,
  benefits: renderBenefitsSection,
  lifestyle: renderLifestyleSection,
  product_details: renderProductDetailsSection,
  trust: renderTrustSection,
  buyer_intent: renderBuyerIntentSection,
  final_cta: renderFinalCtaSection,
};

function renderLandingPageBodyV2({ listing, pagePlan, price }) {
  const imagesById = new Map(pagePlan.images.map(img => [img.id, img]));
  const shop = listing.shop;
  const sectionsHtml = pagePlan.sections
    .map(section => SECTION_RENDERERS[section.type](section, imagesById, listing, price))
    .join('');

  return `
    <div class="lp-root">
      <div class="lp-share-bar">
        <button type="button" id="lp-share-btn" class="lp-share-btn">Copy link</button>
      </div>
      ${sectionsHtml}
      <footer class="lp-footer">
        Designed by <a href="${escapeHtml(shop?.url || listing.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shop?.shop_name || 'the seller')}</a> on Etsy
      </footer>
    </div>
  `;
}
```

Finally, replace the body of `export function renderLandingPageDocument` with this dispatching version (the `<head>` boilerplate — charset, viewport, fonts, `<style>` — stays exactly as it is today; only the parts shown below change):

```js
export function renderLandingPageDocument({ listing, copy, pagePlan, price, colors, pageUrl, schemaVersion }) {
  let styles = LP_STYLES;
  if (colors?.accent && colors?.accentWarm) {
    styles = styles
      .replace(/--lp-accent:\s*#[0-9a-fA-F]{6};/, `--lp-accent: ${colors.accent};`)
      .replace(/--lp-accent-warm:\s*#[0-9a-fA-F]{6};/, `--lp-accent-warm: ${colors.accentWarm};`);
  }

  const isV2 = schemaVersion === 2;
  const bodyHtml = isV2
    ? renderLandingPageBodyV2({ listing, pagePlan, price })
    : renderLandingPageBody({ listing, copy, price });

  const heroSection = isV2 ? pagePlan.sections[0] : null;
  const ogTitle = isV2 ? heroSection.headline : copy.headline;
  const ogDescription = isV2 ? heroSection.subheadline : copy.subheadline;
  const heroImage = isV2
    ? (pagePlan.images.find(img => img.id === heroSection.imageId)?.url || getHeroImage(listing))
    : getHeroImage(listing);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(ogTitle)}</title>
<meta property="og:type" content="website" />
<meta property="og:title" content="${escapeHtml(ogTitle)}" />
<meta property="og:description" content="${escapeHtml(ogDescription)}" />
${heroImage ? `<meta property="og:image" content="${escapeHtml(heroImage)}" />` : ''}
${pageUrl ? `<meta property="og:url" content="${escapeHtml(pageUrl)}" />` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet" />
<style>${styles}</style>
</head>
<body>
${bodyHtml}
<script>
document.getElementById('lp-share-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('lp-share-btn');
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(window.location.href);
    btn.textContent = 'Copied!';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => { btn.textContent = original; }, 1500);
});
<\/script>
</body>
</html>`;
}
```

Note precisely what did **not** change: `escapeHtml`, `LP_STYLES`'s existing rules (only appended to), `getHeroImage`, `renderLandingPageBody`, and `renderNotFoundPage` are all untouched. For `schemaVersion !== 2` (every existing row), `isV2` is `false`, so `ogTitle`/`ogDescription`/`heroImage`/`bodyHtml` are computed exactly as before — this is what makes every pre-existing test keep passing unmodified.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/landingPageTemplate.test.js`
Expected: PASS (all pre-existing tests + 13 new v2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/landingPageTemplate.js lib/landingPageTemplate.test.js
git commit -m "Add section-based v2 rendering alongside the unchanged v1 template"
```

---

### Task 4: Wire the New Generator into `server.js`

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `generatePageStory` from `lib/pageStoryGenerator.js` (Task 2); `SOCIAL_PLATFORMS` from `lib/pageStorySchema.js` (Task 1); `renderLandingPageDocument`'s extended signature from `lib/landingPageTemplate.js` (Task 3).
- Produces: `POST /api/landing-pages` now stores `content = { schemaVersion: 2, listing, price, colors, pagePlan }`; `GET /p/:id` passes `schemaVersion` through to the renderer.

Not unit-tested (route handlers in this codebase aren't directly unit tested — verified manually in Step 5 below and via the QA doc in Task 6).

- [ ] **Step 1: Confirm nothing else in `server.js` depends on the symbols being removed**

Run: `grep -n "SOCIAL_PLATFORMS\|PLATFORM_GUIDANCE\|LandingCopySchema\|SocialPostSchema\|generateLandingCopy" server.js`

Expected: every match is inside the block being replaced in Step 2 below (the schema/constant definitions themselves, and their one call site in `/api/landing-pages`). If any match appears in an unrelated route (e.g. a different social-posting endpoint reusing `SOCIAL_PLATFORMS` for its own validation), stop and report it — do not delete a symbol something else still needs; keep it in `server.js` alongside the new import instead of moving it.

- [ ] **Step 2: Remove the old generator and schemas, add the new imports**

Remove from `server.js`: the `SocialPostSchema` definition, the `LandingCopySchema` definition, and the `generateLandingCopy` function (originally lines 459-512 as read during planning — re-locate by searching for `async function generateLandingCopy` since line numbers will have shifted). Also remove the standalone `const SOCIAL_PLATFORMS = [...]` and `const PLATFORM_GUIDANCE = {...}` declarations that Step 1 confirmed are unused elsewhere.

Add near the other `lib/` imports at the top of `server.js`:

```js
import { generatePageStory } from './lib/pageStoryGenerator.js';
import { SOCIAL_PLATFORMS } from './lib/pageStorySchema.js';
```

- [ ] **Step 3: Update the `POST /api/landing-pages` handler**

Find the block (inside the handler, after `if (!assertShopAllowed(req, res, listing.shop?.shop_name || '')) return;`):

```js
  try {
    const copy = await generateLandingCopy(
      {
        title: listing.title,
        description: listing.description,
        price: listing.price,
        currency: listing.price?.currency_code,
        tags: listing.tags,
        materials: listing.materials,
        shopName: listing.shop?.shop_name,
      },
      SOCIAL_PLATFORMS,
    );
```

Replace with:

```js
  try {
    const pagePlan = await generatePageStory(
      anthropic,
      {
        title: listing.title,
        description: listing.description,
        price: listing.price,
        currency: listing.price?.currency_code,
        tags: listing.tags,
        materials: listing.materials,
        shopName: listing.shop?.shop_name,
        images: listing.images,
      },
      SOCIAL_PLATFORMS,
    );
```

A few lines further down, find:

```js
    const content = { listing, copy, price, colors };
```

Replace with:

```js
    const content = { schemaVersion: 2, listing, price, colors, pagePlan };
```

And find the success response:

```js
    res.json({ id: row.id, url: `/p/${row.id}`, copy });
```

Replace with (the client at `public/index.html:664` only ever reads `data.url`, confirmed during planning — `copy`/`pagePlan` was never consumed by the frontend, so it's dropped rather than replaced):

```js
    res.json({ id: row.id, url: `/p/${row.id}` });
```

- [ ] **Step 4: Update the `GET /p/:id` handler**

Find:

```js
    res.set('Content-Type', 'text/html').send(renderLandingPageDocument({
      ...row.content,
      pageUrl: `${req.protocol}://${req.get('host')}/p/${req.params.id}`,
    }));
```

This already spreads `row.content` (which now includes `schemaVersion` and `pagePlan` for new rows, or neither for old rows) into `renderLandingPageDocument`'s arguments — **no change needed here**. Confirm this by reading the surrounding code; if the actual current code does not simply spread `row.content`, adapt so that `schemaVersion` and `pagePlan` (when present on the row) reach `renderLandingPageDocument` the same way `listing`/`copy`/`price`/`colors` already do.

- [ ] **Step 5: Verify locally**

Run: `node --check server.js` — confirm no syntax errors.
Run: `npm test` — confirm the full suite still passes (this task adds no new tests, so the count should match Task 3's ending count exactly).
Start the app (`npm start`) and confirm it boots without throwing on startup (no missing-import errors).

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "Wire the conversion-story generator into landing page creation"
```

---

### Task 5: Keep `public/my-pages.html` Working for Both Content Shapes

**Files:**
- Modify: `public/my-pages.html`

**Interfaces:**
- Not unit-tested (no test file exists for this page today; `public/shareLinks.js`, which this task does *not* modify, keeps its own existing tests passing unchanged).

This page reads `row.content` directly in two places that assume today's flat `copy` shape and would silently degrade for every new (`schemaVersion: 2`) page without this change: the page title shown on each card (`copy?.headline`), and — more importantly — the **entire "Share" button and social-caption panel**, which is only rendered `if (!copy) return '';` today and would vanish for every new page.

- [ ] **Step 1: Add a normalizing helper**

In `public/my-pages.html`'s `<script type="module">` block, add this function above `renderSharePanel` (which is defined above `renderCard`, per the existing file layout read during planning):

```js
// Normalizes either stored content shape -- today's flat `copy`, or the
// sectioned `pagePlan` from the conversion-story engine -- down to what
// this page needs, so renderCard/renderSharePanel stay free of
// schemaVersion branching. Returns null if the row has neither (e.g. a
// pre-copy-feature legacy row, matching the existing `if (!copy)` guard's
// original intent).
function normalizePageContent(content) {
  if (content.copy) {
    const heroImage = content.listing?.images?.[0];
    return {
      title: content.copy.headline,
      cardImageUrl: heroImage?.url_570xN || heroImage?.url_fullxfull || '',
      shareImageUrl: heroImage?.url_fullxfull || heroImage?.url_570xN || '',
      socialPostsSource: content.copy,
    };
  }
  if (content.pagePlan) {
    const hero = content.pagePlan.sections.find(s => s.type === 'hero');
    const heroImage = content.pagePlan.images.find(img => img.id === hero?.imageId);
    return {
      title: hero?.headline,
      cardImageUrl: heroImage?.url || '',
      shareImageUrl: heroImage?.url || '',
      socialPostsSource: { socialPosts: content.pagePlan.socialPosts, headline: hero?.headline, subheadline: hero?.subheadline },
    };
  }
  return null;
}
```

- [ ] **Step 2: Update `renderSharePanel` to use it**

Find:

```js
    function renderSharePanel(row) {
      const { listing, copy } = row.content;
      // No sharable copy (e.g. a row saved before captions existed) -- render
      // nothing rather than let getSocialPost's `copy.socialPosts` access throw
      // on a null/undefined `copy` and break rendering of every card.
      if (!copy) return '';
      const pageUrl = new URL(`/p/${row.id}`, window.location.origin).href;
      // Prefer the full-resolution image for sharing (vs. renderCard's 570xN
      // thumbnail below) since social platforms display it much larger.
      const imageUrl = listing?.images?.[0]?.url_fullxfull || listing?.images?.[0]?.url_570xN || '';
```

Replace with:

```js
    function renderSharePanel(row) {
      const normalized = normalizePageContent(row.content);
      // No sharable content (e.g. a row saved before captions existed) --
      // render nothing rather than let getSocialPost throw on a
      // null/undefined source and break rendering of every card.
      if (!normalized) return '';
      const pageUrl = new URL(`/p/${row.id}`, window.location.origin).href;
      const imageUrl = normalized.shareImageUrl;
```

A few lines further down inside the same function, find:

```js
            const post = getSocialPost(copy, key);
```

Replace with:

```js
            const post = getSocialPost(normalized.socialPostsSource, key);
```

- [ ] **Step 3: Update `renderCard` to use it**

Find:

```js
      const { listing, copy } = row.content;
      const title = copy?.headline || listing?.title || 'Untitled page';
      const image = listing?.images?.[0]?.url_570xN || listing?.images?.[0]?.url_fullxfull || '';
      const url = `/p/${row.id}`;
```

Replace with:

```js
      const normalized = normalizePageContent(row.content);
      const title = normalized?.title || row.content.listing?.title || 'Untitled page';
      const image = normalized?.cardImageUrl || '';
      const url = `/p/${row.id}`;
```

A few lines further down, find:

```js
            ${copy ? '<button type="button" class="share-toggle-btn">Share</button>' : ''}
```

Replace with:

```js
            ${normalized ? '<button type="button" class="share-toggle-btn">Share</button>' : ''}
```

- [ ] **Step 4: Verify locally**

Since there's no automated test for this file, verify by reading the full updated `renderCard` and `renderSharePanel` functions together and confirming: (a) every reference to the old bare `copy`/`listing` destructure inside these two functions has been replaced — search the file for `row.content` and `.copy` to confirm no stale reference remains inside these two functions; (b) `normalizePageContent` is called before any use of `normalized` in both functions (no use-before-definition); (c) a v1 row (`content.copy` present, `content.pagePlan` absent) and a v2 row (`content.pagePlan` present, `content.copy` absent) both produce a non-null `normalizePageContent` result. Manual browser verification happens in Task 6's QA pass, once a real v2 page exists to test against.

- [ ] **Step 5: Commit**

```bash
git add public/my-pages.html
git commit -m "Keep My Landing Pages' title and share panel working for v2 content"
```

---

### Task 6: Manual QA Script

**Files:**
- Create: `docs/qa-conversion-story-landing-pages.md`

Following the existing `docs/qa-full-account-flow.md` / `docs/qa-made-to-order-intake.md` pattern — a checklist a human runs by hand against a real environment, since `generatePageStory()` makes a real, non-mocked AI call and this plan deliberately has no automated coverage for it.

- [ ] **Step 1: Write the QA script**

```markdown
# Manual QA: Conversion Story Landing Page Engine

Run this after any change touching `lib/pageStorySchema.js`,
`lib/pageStoryGenerator.js`, `lib/landingPageTemplate.js`'s v2 path, or the
`/api/landing-pages` handler. Requires: an approved (or admin) account with
at least one linked Etsy shop that has products with real photos.

## 1. Backward compatibility (do this first, before generating anything new)

- [ ] Open an existing landing page you generated *before* this change
      (`/p/:id` for a page created earlier) directly by URL.
- [ ] Confirm it looks pixel-identical to how it looked before -- same hero
      layout, same horizontal image gallery, same fonts/colors.
- [ ] Open `/my-pages.html` -- confirm that page's card still shows its
      original title and, if it has share captions, that the "Share" button
      still opens the same Pinterest/Facebook/Instagram panel as before.

## 2. Generating a new page

- [ ] From "Find My Shop," pick a real product with **several photos** of
      different kinds (at least one clear product shot, and ideally one
      lifestyle/in-use photo if the shop has one).
- [ ] Click "Create Landing Page." Note how long it takes (expect noticeably
      longer than before -- the AI is now analyzing real photos, not just
      text).
- [ ] Confirm the new page loads without error.

## 3. Checking the result is genuinely product-aware, not templated

- [ ] Confirm the hero section's headline/subheadline are specific to this
      product, not generic.
- [ ] Confirm the hero image is a sensible "lead" shot, not an arbitrary
      pick.
- [ ] Scroll the whole page -- confirm the sections present make sense for
      *this* product (e.g. a "Buyer Intent / gift occasions" section should
      only appear if the product is plausibly giftable; a "Trust" section
      should only appear if the listing actually supports a real trust
      claim -- not a generic "handmade with love" filler).
- [ ] Confirm every photo used somewhere on the page is a real photo from
      this listing (open the listing on Etsy in another tab to compare) --
      no broken images, no photo used in a section it obviously doesn't fit
      (e.g. a packaging shot used as the emotional hero image).
- [ ] Confirm no fabricated claim appears anywhere (materials, guarantees,
      shipping promises, review counts, "limited stock," etc.) that isn't
      actually in the Etsy listing's own title/description/tags.

## 4. Mobile check

- [ ] Open the new page on a real phone, or your browser's device-width
      preview at ~375px wide.
- [ ] Confirm the hero message is visible without scrolling, buttons are
      easy to tap, no section overflows horizontally, and image
      grids/cards stack into a single column.

## 5. Sharing still works for the new page

- [ ] On `/my-pages.html`, find the newly created page's card and click
      "Share."
- [ ] Confirm captions appear for Pinterest, Facebook, and Instagram, and
      that "Copy caption" actually copies real, product-specific text (not
      a blank or "undefined -- undefined" fallback).

## 6. Failure path

- [ ] Temporarily use a product with only 1-2 very low-information photos
      (or a listing with a very short description) and generate a page.
      Confirm the app doesn't error, and that the result reasonably omits
      sections that data doesn't support rather than inventing filler.
```

- [ ] **Step 2: Commit**

```bash
git add docs/qa-conversion-story-landing-pages.md
git commit -m "Add manual QA script for the conversion-story landing page engine"
```

---

## Self-Review Notes

- **Spec coverage:** every part of the spec (schema, image selection + vision call, section renderers, `server.js` wiring, backward compatibility, testing plan) maps to a task above. One integration point the spec didn't call out explicitly was discovered during planning and is covered anyway: `public/my-pages.html` reads `content.copy` directly for both its card title and its entire social-share panel — without Task 5, every newly generated page would silently lose its "Share" button. Confirmed by reading the file during planning; Task 5 exists specifically to close this gap.
- **Placeholder scan:** no `TODO`/`TBD` markers. Illustrative `/* ... */` bodies appear only in Task 4's "not unit tested" framing note, not in any code the plan asks to be written verbatim.
- **Type/shape consistency:** `PagePlanSchema`'s section shapes (Task 1) match exactly what `validatePagePlan` (Task 2) and every section renderer (Task 3) read — field names (`imageId`, `items[].imageId` for lifestyle, `supportingFacts`, `occasions`, etc.) were cross-checked across all three tasks while writing this plan. `generatePageStory`'s parameter order (`anthropic, listing, platforms`) matches exactly how Task 4 calls it. `content.schemaVersion === 2` is the single dispatch condition used consistently in Task 3's renderer and Task 4's storage — no second version-detection mechanism was introduced.
- **Backward compatibility is the load-bearing constraint of this whole plan:** Task 3 is designed so that every existing test in `lib/landingPageTemplate.test.js` needs zero modification, and the plan's own new tests explicitly assert the v1 path still works when `schemaVersion`/`pagePlan` are absent. Task 4 confirms this at the wiring level (old rows have no `schemaVersion` field at all; the renderer already treats "not exactly 2" as v1). Task 5 is what keeps the *other* consumer of the old shape (`my-pages.html`) from breaking silently.
