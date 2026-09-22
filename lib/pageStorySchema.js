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
