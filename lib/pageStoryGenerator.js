import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { PagePlanSchema } from './pageStorySchema.js';

const MAX_IMAGES = 10;

const PLATFORM_GUIDANCE = {
  facebook: 'Facebook: a warm, conversational caption (2-4 sentences), like a small-shop owner talking to regulars. 0-3 hashtags at most. No title.',
  instagram: 'Instagram: an inviting caption (roughly 60-120 words) with a bit of storytelling, ending on a soft call-to-action. 8-12 relevant hashtags. No title.',
  pinterest: 'Pinterest: a keyword-rich, benefit-led title (under 100 characters) plus a descriptive caption (2-3 sentences) written to surface in search. 3-6 hashtags.',
};

// Which top-level fields must be non-null for a section of this `type`.
// SectionSchema (lib/pageStorySchema.js) leaves every field nullable/an
// empty-array-by-default because Claude's structured-output grammar
// doesn't support a per-type discriminated union -- this table is what
// actually enforces "a hero section must have a headline" etc. at runtime.
const REQUIRED_FIELDS_BY_TYPE = {
  hero: ['headline', 'subheadline', 'imageId', 'ctaText'],
  emotional_story: ['headline'],
  benefits: ['headline'],
  lifestyle: ['headline'],
  product_details: [],
  trust: ['headline'],
  buyer_intent: ['headline'],
  final_cta: ['headline', 'supportingText', 'ctaText'],
};

// Which array field must be non-empty for a section of this `type`.
const REQUIRED_LIST_FIELD_BY_TYPE = {
  emotional_story: 'body',
  benefits: 'items',
  lifestyle: 'items',
  product_details: 'items',
  trust: ['body', 'supportingFacts'],
  buyer_intent: 'occasions',
};

// Which fields each `items[]` entry must have non-null, for section types
// that use `items`.
const ITEM_REQUIRED_FIELDS_BY_TYPE = {
  benefits: ['heading', 'body'],
  lifestyle: ['caption', 'imageId'],
  product_details: ['label', 'value'],
};

// Picks up to `maxImages` from the listing's own image order (Etsy sellers
// typically put their best/primary shot first) and builds the alternating
// "Image N:" label + image-block content Claude's API docs recommend for
// multi-image requests -- the label is also what lets the model's
// structured output refer back to a specific photo by a stable id instead
// of a URL. The manifest carries BOTH the full-resolution url (used for
// actual page rendering and sharing) and a smaller thumbnailUrl (sent to
// the model instead of the full-resolution image, since classification and
// placement don't need full resolution -- this cuts vision input tokens,
// and therefore cost and latency, substantially).
export function buildImageContentBlocks(images, maxImages = MAX_IMAGES) {
  const selected = (images || []).slice(0, maxImages);
  const contentBlocks = [];
  const manifest = [];

  selected.forEach((image, index) => {
    const url = image.url_fullxfull || image.url_570xN;
    if (!url) return;
    const thumbnailUrl = image.url_570xN || url;
    const id = `Image ${index + 1}`;
    contentBlocks.push({ type: 'text', text: `${id}:` });
    contentBlocks.push({ type: 'image', source: { type: 'url', url: thumbnailUrl } });
    manifest.push({ id, url, thumbnailUrl });
  });

  return { contentBlocks, manifest };
}

// Checks the type-appropriate required fields (REQUIRED_FIELDS_BY_TYPE /
// REQUIRED_LIST_FIELD_BY_TYPE / ITEM_REQUIRED_FIELDS_BY_TYPE above) are
// actually populated for one section -- this is the runtime replacement
// for what a discriminated union would otherwise guarantee at the schema
// level.
function assertSectionIsComplete(section) {
  for (const field of REQUIRED_FIELDS_BY_TYPE[section.type] ?? []) {
    if (!section[field]) {
      throw new Error(`Page plan's "${section.type}" section is missing required field "${field}".`);
    }
  }

  const listFields = REQUIRED_LIST_FIELD_BY_TYPE[section.type];
  for (const field of Array.isArray(listFields) ? listFields : listFields ? [listFields] : []) {
    if (!Array.isArray(section[field]) || section[field].length === 0) {
      throw new Error(`Page plan's "${section.type}" section is missing required list "${field}".`);
    }
  }

  const itemFields = ITEM_REQUIRED_FIELDS_BY_TYPE[section.type];
  if (itemFields) {
    for (const item of section.items) {
      for (const field of itemFields) {
        if (!item[field]) {
          throw new Error(`Page plan's "${section.type}" section has an item missing required field "${field}".`);
        }
      }
    }
  }
}

// Enforces the structural rules the flat SectionSchema can't express on its
// own (see lib/pageStorySchema.js for why it's flat, not a discriminated
// union): the conversion arc must start with hero and end with final_cta,
// no section type repeats, each section has the fields its type actually
// requires (assertSectionIsComplete), and every imageId a section
// references must be one that was ACTUALLY shown to the model -- checked
// against `manifest` (built server-side from the real Etsy listing data),
// not against the AI's own self-reported `images[]`, since an AI that
// hallucinates a self-consistent id/images[] pair would otherwise pass
// validation despite referencing nothing real. Also merges the manifest's
// real URLs onto each classified image before returning -- an image
// src/href on the rendered page must never be a value the AI authored,
// only a URL the server already trusted enough to show the AI in the first
// place.
export function validatePagePlan(pagePlan, manifest) {
  const { sections } = pagePlan;

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
    assertSectionIsComplete(section);
  }

  const knownImageIds = new Set(manifest.map(m => m.id));
  const referencedImageIds = sections.flatMap(section => {
    const fromItems = section.items?.map(item => item.imageId) ?? [];
    const own = section.imageId != null ? [section.imageId] : [];
    return [...own, ...fromItems].filter(id => id != null);
  });
  for (const imageId of referencedImageIds) {
    if (!knownImageIds.has(imageId)) {
      throw new Error(`Page plan references unknown image id "${imageId}".`);
    }
  }

  if (!Array.isArray(pagePlan.socialPosts) || pagePlan.socialPosts.length === 0) {
    throw new Error('Page plan has no social posts.');
  }

  const manifestById = new Map(manifest.map(m => [m.id, m]));
  pagePlan.images = pagePlan.images
    .filter(img => manifestById.has(img.id))
    .map(img => ({ ...img, url: manifestById.get(img.id).url, thumbnailUrl: manifestById.get(img.id).thumbnailUrl }));

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
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: zodOutputFormat(PagePlanSchema) },
    system:
      'You are a marketing strategist, copywriter, and creative director for a boutique e-commerce landing page builder. ' +
      'Analyze the handmade/vintage Etsy product below -- who is most likely to buy it, what emotional and functional angles matter, ' +
      'what makes it different, and what (if anything) makes it giftable or trustworthy -- then design a landing page assembled only from sections that genuinely fit this product. ' +
      'A hero section and a final_cta section are always required; every other section type is optional -- include it only when the listing data genuinely supports it, and omit it entirely rather than filling it with generic or invented content. Never repeat a section type. ' +
      'Every section shares one flat output shape with fields for every section type combined -- only fill in the fields that matter for the section\'s own "type" and leave every other field null (or an empty array, for list fields). Specifically: ' +
      'hero uses eyebrow/headline/subheadline/imageId/ctaText/trustIndicators. emotional_story uses headline/body(1-3 short paragraphs)/imageId. benefits uses headline/items (3-6 items, each with heading+body). lifestyle uses headline/items (1-4 items, each with caption+imageId). product_details uses items only (1+ items, each with label+value; no headline). trust uses headline/body (its 1-2 sentence claim, as a single-element array)/supportingFacts (1-4 short facts). buyer_intent uses headline/occasions (1-6). final_cta uses headline/supportingText/ctaText/imageId. ' +
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
  return validatePagePlan(response.parsed_output, manifest);
}
