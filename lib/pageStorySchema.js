import { z } from 'zod';

// Matches the 3 platforms lib/pageStoryGenerator.js drafts a social post
// for, and the `platform` enum every socialPosts entry must use.
export const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'pinterest'];

const SocialPostSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  title: z.string().nullable().describe('Only for Pinterest: a keyword-rich pin title under 100 characters. Null for every other platform.'),
  caption: z.string().describe('The main post text, written in the voice, length, and norms of the target platform'),
  hashtags: z.array(z.string()).describe('Hashtags without the # symbol. Aim for roughly 3-12 depending on platform norms.'),
});

const ImageClassification = z.enum([
  'hero', 'lifestyle', 'product', 'detail', 'material_texture',
  'use_case', 'variation', 'packaging', 'gift', 'instructional', 'other',
]);

const ClassifiedImageSchema = z.object({
  id: z.string().describe('Matches the "Image N" label this image was sent under, e.g. "Image 1"'),
  classification: ImageClassification,
});

// One item shape shared by every section type that needs a repeated list
// (benefits, lifestyle, product_details) -- each field is only meaningful
// for certain section types and left null otherwise. This flat shape (and
// SectionSchema below) exists specifically because Claude's structured
// -output grammar compiler does not support z.discriminatedUnion (only
// anyOf/allOf are documented as supported) and rejects it here as "too
// large" -- a per-type discriminated union nested inside an array of up to
// 8 variants was too complex to compile. Type-specific requirements (which
// fields must actually be non-null for a given section `type`) are
// enforced at runtime in lib/pageStoryGenerator.js's validatePagePlan,
// not by the schema.
const SectionItemSchema = z.object({
  heading: z.string().nullable().describe('benefits items only: 3-6 words'),
  body: z.string().nullable().describe('benefits items only: 5-15 words, a buyer-centered benefit, not just a feature restated'),
  caption: z.string().nullable().describe('lifestyle items only: very short'),
  imageId: z.string().nullable().describe('lifestyle items only'),
  label: z.string().nullable().describe('product_details items only'),
  value: z.string().nullable().describe('product_details items only'),
});

// A single flat shape for every section type (see the comment on
// SectionItemSchema for why). Claude is told via the system prompt which
// fields matter for which `type` and to leave the rest null; the
// discriminated-union-style per-type strictness Zod would normally give us
// is enforced instead by lib/pageStoryGenerator.js's validatePagePlan
// after the response comes back.
//
// Array constraints: Claude's structured-output grammar only supports
// `minItems` of exactly 0 or 1 and does not support `maxItems` at all, so
// none of these arrays carry a `.min()`/`.max()` -- length requirements
// (e.g. "benefits needs 3-6 items") are enforced at runtime instead.
export const SectionSchema = z.object({
  type: z.enum([
    'hero', 'emotional_story', 'benefits', 'lifestyle', 'product_details',
    'trust', 'buyer_intent', 'final_cta',
  ]),
  eyebrow: z.string().nullable().describe('hero only: short tag line, 2-5 words. Null if none fits.'),
  headline: z.string().nullable().describe('hero/emotional_story/benefits/lifestyle/trust/buyer_intent/final_cta: 3-10 words, punchy and distinctive. Null for product_details, which has no headline.'),
  subheadline: z.string().nullable().describe('hero only: 1-2 short sentences'),
  body: z.array(z.string()).describe('emotional_story: 1-3 short paragraphs. trust: put its 1-2 sentence claim here as a single-element array. Empty array for every other type.'),
  imageId: z.string().nullable().describe('hero/emotional_story/final_cta: the id of the image this section uses. Null if none.'),
  ctaText: z.string().nullable().describe('hero/final_cta only: e.g. "Get Yours on Etsy"'),
  trustIndicators: z.array(z.string()).describe('hero only: up to 3 very short, factual trust phrases, only if genuinely supported by the listing. Empty array otherwise.'),
  items: z.array(SectionItemSchema).describe('benefits (3-6 items)/lifestyle (1-4 items)/product_details (1+ items) only. Empty array for every other type.'),
  supportingFacts: z.array(z.string()).describe('trust only: 1-4 short factual claims. Empty array otherwise.'),
  occasions: z.array(z.string()).describe('buyer_intent only: 1-6 occasions/situations this product genuinely fits. Empty array otherwise.'),
  supportingText: z.string().nullable().describe('final_cta only: one short reinforcement sentence.'),
});

export const PagePlanSchema = z.object({
  productStory: z.object({
    primaryAudience: z.string(),
    emotionalAngle: z.string(),
    functionalAngle: z.string(),
    primaryBuyerIntent: z.string(),
  }),
  images: z.array(ClassifiedImageSchema),
  sections: z.array(SectionSchema).describe('2-8 sections. Must start with a hero-type section and end with a final_cta-type section, with no section type repeated.'),
  socialPosts: z.array(SocialPostSchema).describe(`One entry per platform: ${SOCIAL_PLATFORMS.join(', ')}.`),
});
