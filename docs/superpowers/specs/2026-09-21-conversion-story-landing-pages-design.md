# Conversion Story Landing Page Engine — Design

Date: 2026-09-21
Status: Approved for planning

## Problem

Today's landing-page generator (`generateLandingCopy()` in `server.js`, rendered by
`lib/landingPageTemplate.js`) treats every product identically: it writes copy into a
fixed set of fields (`eyebrow`, `headline`, `subheadline`, `story[]`, `highlights[]`,
`cta`) and pours them into one hardcoded template — hero, story, highlights, a
horizontal-scroll image gallery in whatever order Etsy returned the photos, final CTA,
footer. The AI never sees the product photos; it only gets title/description/price/tags/
materials as text. A necklace, a wedding template, and a wool blanket all get the exact
same page shape.

Kim wants LaunchNestAI to behave like an AI marketing strategist and creative director:
analyze each product's actual story (audience, emotional angle, functional angle,
trust signals, giftability), decide which of several possible page sections genuinely
fit *this* product, write section-appropriate copy, and intelligently place the seller's
real photos based on what's actually in them — not just their upload order.

## Goal

- Replace the flat copy schema with a structured "page plan": a product-story summary
  plus a variable-length, ordered list of sections drawn from a fixed palette of section
  *types*, only the ones that genuinely fit.
- The AI sees the real product images (not just text) and classifies + assigns them to
  the sections that best use them.
- Every generated page still links straight to the real Etsy listing for checkout, and
  the AI still never invents facts, materials, claims, reviews, or scarcity not present
  in the source data — this discipline already exists in the current prompt and carries
  forward unchanged, extended to cover sections and images too.
- Existing, already-published pages (`landing_pages.content` rows created under today's
  schema) keep rendering byte-for-byte as they do now. No migration, no re-generation,
  no risk to a page a real seller already shared with real buyers.

## Non-goals

- No new database migration — `landing_pages.content` is already `jsonb`; the new shape
  lives in the same column, distinguished by a version marker.
- No change to how a customer *requests* a page (`POST /api/landing-pages`'s inputs,
  the allowance check, the Etsy listing fetch) — only what happens between "listing
  fetched" and "content saved."
- No image hosting/download — sections reference Etsy's own CDN URLs directly, exactly
  as today, just chosen more deliberately.
- No per-section *layout* variation (e.g. benefits-as-cards vs. benefits-as-a-strip).
  Each section type gets one polished, mobile-first layout. "Dynamic" means *which*
  sections appear, in *what order*, with *what content and images* — which already
  varies substantially product to product. Multiple visual treatments per section type
  is a reasonable future iteration, not this one.
- No two-phase AI pipeline. One multimodal call (text + real images) produces the full
  page plan, following the same structured-output + extended-thinking pattern the
  current `generateLandingCopy()` already uses successfully.

## Architecture Overview

`generateLandingCopy()` is replaced by `generatePageStory()`: one
`anthropic.messages.parse()` call using a new, larger Zod schema (`PagePlanSchema`),
with the product's images attached as real `image` content blocks (Claude's API accepts
an image by URL directly — `{ type: 'image', source: { type: 'url', url } }` — so
Etsy's existing CDN URLs are sent as-is, no download or re-encoding needed) alongside
the existing text fields (title, description, price, tags, materials, shop name).

`lib/landingPageTemplate.js` gains a second rendering path: one small, pure render
function per section type (`renderHero`, `renderEmotionalStory`, `renderBenefits`,
`renderLifestyle`, `renderProductDetails`, `renderTrust`, `renderBuyerIntent`,
`renderFinalCta`), looped over the page plan's `sections` array in the order the AI
chose. `renderLandingPageDocument()` dispatches on a `content.schemaVersion` field:
`2` (new) → the section-loop renderer; anything else (today's rows have no such field)
→ the existing, completely unmodified `renderLandingPageBody()`. Old pages never touch
new code.

## Data Model

No migration. `landing_pages.content` (already `jsonb`) holds, for newly generated
pages:

```js
{
  schemaVersion: 2,
  listing,        // unchanged: the raw Etsy listing fetch, as today
  price,          // unchanged: normalized display price, as today
  colors,         // unchanged: brand accent colors, as today
  pagePlan: {     // NEW — replaces today's flat `copy` object
    productStory: { primaryAudience, emotionalAngle, functionalAngle, primaryBuyerIntent },
    images: [ { id, url, classification } ],   // every image the AI was shown, and its call
    sections: [ /* variable length, see below */ ],
    socialPosts: [ /* unchanged shape from today's LandingCopySchema.socialPosts */ ],
  },
}
```

Existing rows (no `schemaVersion`, `content.copy` present instead of `content.pagePlan`)
are untouched and unaffected — `renderLandingPageDocument()` branches before touching
any new-shape field.

## Part 1 — The Page Plan Schema (`PagePlanSchema`)

Built with the same `zod` + `zodOutputFormat` pattern as today's `LandingCopySchema`.

```js
const ImageClassification = z.enum([
  'hero', 'lifestyle', 'product', 'detail', 'material_texture',
  'use_case', 'variation', 'packaging', 'gift', 'instructional', 'other',
]);

const ClassifiedImageSchema = z.object({
  id: z.string().describe('Matches the "Image N" label this image was sent under'),
  classification: ImageClassification,
});

const SectionType = z.enum([
  'hero', 'emotional_story', 'benefits', 'lifestyle', 'product_details',
  'trust', 'buyer_intent', 'final_cta',
]);

// One discriminated-union member per section type keeps each section's fields
// exact and required for that type, instead of one loose object with every
// possible field optional -- matches the section-by-section spec exactly and
// gives the model (and TypeScript-less JS callers) a hard shape to fill in.
const HeroSection = z.object({
  type: z.literal('hero'),
  eyebrow: z.string().nullable(),
  headline: z.string(),
  subheadline: z.string(),
  imageId: z.string(),
  ctaText: z.string(),
  trustIndicators: z.array(z.string()).max(3),
});
const EmotionalStorySection = z.object({
  type: z.literal('emotional_story'),
  headline: z.string(),
  body: z.array(z.string()).min(1).max(3),
  imageId: z.string().nullable(),
});
const BenefitsSection = z.object({
  type: z.literal('benefits'),
  headline: z.string(),
  items: z.array(z.object({ heading: z.string(), body: z.string() })).min(3).max(6),
});
const LifestyleSection = z.object({
  type: z.literal('lifestyle'),
  headline: z.string(),
  items: z.array(z.object({ caption: z.string(), imageId: z.string() })).min(1).max(4),
});
const ProductDetailsSection = z.object({
  type: z.literal('product_details'),
  items: z.array(z.object({ label: z.string(), value: z.string() })).min(1),
});
const TrustSection = z.object({
  type: z.literal('trust'),
  headline: z.string(),
  body: z.string(),
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
  supportingText: z.string(),
  ctaText: z.string(),
  imageId: z.string().nullable(),
});

const SectionSchema = z.discriminatedUnion('type', [
  HeroSection, EmotionalStorySection, BenefitsSection, LifestyleSection,
  ProductDetailsSection, TrustSection, BuyerIntentSection, FinalCtaSection,
]);

const PagePlanSchema = z.object({
  productStory: z.object({
    primaryAudience: z.string(),
    emotionalAngle: z.string(),
    functionalAngle: z.string(),
    primaryBuyerIntent: z.string(),
  }),
  images: z.array(ClassifiedImageSchema),
  // Non-empty; must start with a 'hero' section and end with a 'final_cta'
  // section (validated after parse, see below -- Zod's discriminated union
  // doesn't express "first/last element" constraints on its own).
  sections: z.array(SectionSchema).min(2).max(8),
  socialPosts: z.array(SocialPostSchema).min(1).max(SOCIAL_PLATFORMS.length),
});
```

After `response.parsed_output`, a small validation pass (plain JS, not Zod) enforces
what the schema can't: `sections[0].type === 'hero'`,
`sections.at(-1).type === 'final_cta'`, each section type appears at most once, and
every `imageId` referenced anywhere in `sections` exists in `images`. Any violation is
treated the same as today's `!response.parsed_output` case — throws, surfaces as the
existing `502` error path in `/api/landing-pages`. No repair/retry loop for this stage;
the existing "Rate limited" / "Invalid API key" / generic-502 handling already covers
the operator-facing failure story.

## Part 2 — Image Selection and the Vision Call (`generatePageStory()`)

Replaces `generateLandingCopy(listing, platforms)` with the same call signature (so its
one call site in `server.js` changes minimally) but a different body:

1. **Bound the image set.** Take up to 10 images from `listing.images` (Etsy's own
   order — first is usually the seller's chosen primary shot). Ten is comfortably under
   the 20-image threshold where Claude's API applies a stricter per-image dimension cap,
   and bounds both request size and per-page AI cost.
2. **Build the content blocks.** For each selected image, emit a short text label
   (`Image 1:`, `Image 2:`, …) immediately followed by an `image` block sourced by URL
   (`listing.images[i].url_fullxfull` or `url_570xN` fallback, matching today's
   `getHeroImage()` fallback order) — this labeling is Anthropic's own documented
   best practice for multi-image requests and is what lets the model's structured
   output refer back to `"Image 3"` reliably as an `imageId`.
3. **Send text content after the images** (per Claude's documented preference for
   image-then-text prompting): the same listing fields `generateLandingCopy()` already
   sends (title, description, price, currency, tags, materials, shopName), plus the
   image labels so the model knows which "Image N" corresponds to which `imageId` it
   should emit in `images[]`.
4. **System prompt** extends today's copywriter instructions with the Step 1/2 analysis
   framing (what's being sold, who buys it, emotional vs. functional angle, giftability,
   trust signals) and the Step 10 fallback rule stated explicitly: *"If the product
   doesn't genuinely support a section type (no real trust signal, not giftable, no
   lifestyle-appropriate photo), omit that section entirely rather than filling it with
   generic or invented content."* The existing anti-fabrication instruction
   ("Never invent facts, materials, dimensions, or claims...") is kept verbatim and
   extended to cover image descriptions and section claims too.
5. Same model/effort/thinking configuration as today (`claude-opus-5`,
   `output_config: { effort: 'high', format: zodOutputFormat(PagePlanSchema) }`,
   `thinking: { type: 'adaptive' }`) — this is exactly the kind of multi-step reasoning
   (understand → decide sections → write copy → place images) adaptive thinking is
   for, avoiding the need for a separate analysis call.

## Part 3 — Section Renderers

`lib/landingPageTemplate.js` gains one pure function per section type, each taking that
section's validated data plus an `imagesById` lookup (`Map<string, ClassifiedImage>`
built once per render from `pagePlan.images`) and returning an HTML string. Every
renderer reuses `escapeHtml()` exactly as today's single renderer does — no new
sanitization primitive needed.

```js
function renderHeroSection(section, imagesById, listing, price) { /* ... */ }
function renderEmotionalStorySection(section, imagesById) { /* ... */ }
function renderBenefitsSection(section) { /* ... */ }
function renderLifestyleSection(section, imagesById) { /* ... */ }
function renderProductDetailsSection(section) { /* ... */ }
function renderTrustSection(section) { /* ... */ }
function renderBuyerIntentSection(section) { /* ... */ }
function renderFinalCtaSection(section, imagesById, listing) { /* ... */ }

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
  const sectionsHtml = pagePlan.sections
    .map(section => SECTION_RENDERERS[section.type](section, imagesById, listing, price))
    .join('');
  return `<div class="lp-root">${SHARE_BAR_HTML}${sectionsHtml}${FOOTER_HTML(listing)}</div>`;
}
```

`renderLandingPageDocument()` becomes:

```js
export function renderLandingPageDocument({ listing, copy, pagePlan, price, colors, pageUrl, schemaVersion }) {
  // ...unchanged: styles/colors setup, <head> boilerplate...
  const bodyHtml = schemaVersion === 2
    ? renderLandingPageBodyV2({ listing, pagePlan, price })
    : renderLandingPageBody({ listing, copy, price }); // completely unchanged existing function
  const heroImage = schemaVersion === 2
    ? imagesById(pagePlan).get(pagePlan.sections[0].imageId)?.url ?? getHeroImage(listing)
    : getHeroImage(listing);
  // ...unchanged: og:title/og:description use copy.headline/subheadline for v1,
  // and sections[0].headline / sections[0].subheadline for v2...
}
```

CSS: the existing `LP_STYLES` block (colors, fonts, share bar, footer, responsive
breakpoints) is kept and extended with new per-section-type rules (`.lp-benefits-grid`,
`.lp-lifestyle-grid`, `.lp-trust`, `.lp-buyer-intent`, etc.), all under the same
`--lp-accent`/`--lp-accent-warm` custom-property theming today's brand-color extraction
already sets — no change needed to `lib/brandColor.js`. Every new section follows the
mobile-first rules from the spec's Step 8 (large tap targets, cards stack on narrow
screens, no horizontal overflow, hero message visible without scrolling on a phone).

## Part 4 — Wiring (`server.js`)

`POST /api/landing-pages`'s handler changes minimally:

```js
const pagePlan = await generatePageStory(
  { title: listing.title, description: listing.description, price: listing.price,
    currency: listing.price?.currency_code, tags: listing.tags, materials: listing.materials,
    shopName: listing.shop?.shop_name, images: listing.images },
  SOCIAL_PLATFORMS,
);
// ...unchanged: price normalization, brand color extraction...
const content = { schemaVersion: 2, listing, price, colors, pagePlan };
// ...unchanged: insert via supabaseAsUser, same RLS-enforcing pattern as today...
```

`GET /p/:id` is unchanged except that `renderLandingPageDocument()` now receives
`schemaVersion: row.content.schemaVersion` (`undefined` for every existing row, which
the dispatch above treats as "use the v1 renderer") alongside the rest of
`row.content` spread as today.

## Security Notes

- Every section renderer escapes user/AI-sourced text through the existing
  `escapeHtml()` — no new raw-HTML insertion point is introduced. AI output is still
  structured JSON validated by Zod before it ever reaches a template string, exactly
  as today.
- Image URLs sent to Claude are Etsy's own CDN URLs already trusted elsewhere in this
  codebase (the same `url_fullxfull`/`url_570xN` fields today's renderer already
  embeds directly into `<img src>`) — no new untrusted-URL-fetch surface.
- `imageId` references from AI output are validated against the actual `images[]` list
  (Part 1) before rendering, so a hallucinated or malformed `imageId` fails generation
  outright rather than rendering a broken image tag.

## Cost and Latency

Sending ~8-10 product images at Opus's high-resolution tier adds real, bounded cost per
generation on top of today's text-only call — illustratively, ten roughly-1000×1000px
images run several dollars per thousand *pages* generated (not per view), which is
immaterial at LaunchNestAI's current volume but worth Kim's awareness as a per-generation
cost line that didn't exist before. Latency per generation will also increase somewhat
(larger request, more output tokens for the larger schema) — acceptable for a
button-click-and-wait flow, not something requiring async/background generation for
this stage.

## Testing Plan

Following the existing `lib/landingPageTemplate.test.js` pattern (`node --test`, no
live AI calls, fixture data in, HTML string out):

- One test per section renderer, with fixture section objects covering: normal content,
  a section's optional fields absent (e.g. `emotional_story` with `imageId: null`),
  and HTML-significant characters in AI-supplied text (escaping proof, mirroring
  today's existing escaping tests).
- `renderLandingPageBodyV2` / `renderLandingPageDocument({schemaVersion: 2, ...})`:
  sections render in the order given, an unknown/missing section type is impossible
  by construction (Zod discriminated union) so no test needed for that; a `pagePlan`
  missing an image referenced by `imageId` is a generation-time validation failure
  (Part 1), not a renderer concern, so the renderer can assume `imagesById` lookups
  succeed for every `imageId` it's given.
- **Regression, not new coverage:** every existing `landingPageTemplate.test.js` test
  for `renderLandingPageDocument`/`renderLandingPageBody` (today's v1 path) must keep
  passing completely unmodified — proof that old pages are unaffected.
- New fixture test: `renderLandingPageDocument` called with `schemaVersion: 2` renders
  via the v2 path; called with no `schemaVersion` (or `schemaVersion: undefined`, matching
  every real row in the database today) renders via the unchanged v1 path.
- `generatePageStory()` itself is not unit tested (no live AI calls in tests, matching
  today's `generateLandingCopy()`, which also has no direct test) — verified manually
  against real Etsy listings before rollout, the same way `generateLandingCopy()` was.

## Out of Scope (future iterations)

- Multiple visual treatments per section type (the "full layout variation" option
  discussed and deferred during design).
- A two-phase analysis-then-write pipeline, if single-call quality proves insufficient
  in practice.
- Re-generating or backfilling existing (`schemaVersion` absent) pages into the new
  format — sellers keep their current pages; only newly generated pages get the new
  engine.
- Any change to the made-to-order intake work (a separate, unrelated stage) — this
  redesign only touches the self-serve `POST /api/landing-pages` → `GET /p/:id` path.
