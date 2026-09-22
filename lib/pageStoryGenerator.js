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
