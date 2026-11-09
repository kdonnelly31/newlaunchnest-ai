// lib/pinCopyGenerator.js
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { PinBatchSchema, PIN_ANGLES } from './pinCopySchema.js';
import { PLATFORM_GUIDANCE } from './pageStoryGenerator.js';

// Same retry rationale as lib/pageStoryGenerator.js's MAX_ATTEMPTS: Claude's
// structured-output grammar makes an invalid value unlikely but not
// impossible, and a transient bad generation is worth one retry rather than
// failing a seller's whole batch outright.
const MAX_ATTEMPTS = 3;

const ANGLE_GUIDANCE = {
  spotlight: 'Spotlight: focus on the product itself -- its craftsmanship, materials, and what makes it distinctive.',
  buyer_focused: 'Buyer-Focused: focus on who this is for and the problem it solves for them.',
  gift_lifestyle: 'Gift & Lifestyle: focus on gifting occasions or how this fits into someone\'s everyday life.',
};

// Enforces what the flat PinVariationSchema can't express on its own: exactly
// one variation per angle, in PIN_ANGLES order. Mirrors the structural-check
// pattern in lib/pageStoryGenerator.js's validatePagePlan.
export function validatePinBatch(pinBatch) {
  const { variations } = pinBatch;
  if (!Array.isArray(variations) || variations.length !== PIN_ANGLES.length) {
    throw new Error(`Pin batch must have exactly ${PIN_ANGLES.length} variations.`);
  }
  PIN_ANGLES.forEach((angle, index) => {
    if (variations[index]?.angle !== angle) {
      throw new Error(`Pin batch variation ${index} must have angle "${angle}".`);
    }
  });
  return pinBatch;
}

export async function generatePinBatch(anthropic, listing, photoUrl) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await generatePinBatchOnce(anthropic, listing, photoUrl);
    } catch (err) {
      lastError = err;
      if (typeof err.status === 'number') throw err; // API-level error -- don't retry
      console.error(`generatePinBatch attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err.message);
    }
  }
  throw new Error('We had trouble generating your Pinterest pins. Please try again.', { cause: lastError });
}

async function generatePinBatchOnce(anthropic, listing, photoUrl) {
  const angleInstructions = PIN_ANGLES.map(a => `- ${ANGLE_GUIDANCE[a]}`).join('\n');

  const response = await anthropic.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: zodOutputFormat(PinBatchSchema) },
    system:
      'You are a marketing copywriter for a boutique Etsy marketing tool, writing Pinterest pin copy. ' +
      'First classify the photo you were shown as exactly one of: product, lifestyle, instructional, other. ' +
      '"instructional" means an infographic, size chart, care-instructions graphic, or any image whose main job is to explain something rather than show the product itself. Report your confidence as high, medium, or low. ' +
      'If the photo is "instructional", every variation\'s wording must explain what the graphic shows rather than pitch it like a product shot. ' +
      `Write exactly ${PIN_ANGLES.length} variations, one per angle below, in this exact order:\n${angleInstructions}\n` +
      `Pinterest format: ${PLATFORM_GUIDANCE.pinterest} ` +
      'Brand voice: helpful, encouraging, professional but approachable, simple, practical, outcomes-focused. ' +
      'Never promise sales, traffic, or rankings. Never invent testimonials, numbers, or claims not present in the listing data below -- you may rephrase and elevate what is given, but never fabricate details. No hype, no fake urgency, no technical jargon. ' +
      'Prefer words like simple, done for you, minutes, professional, share, confidence, your products. Avoid guaranteed sales, viral, passive income, and leading with "AI-powered". No emojis.',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'The photo to use for this pin:' },
        { type: 'image', source: { type: 'url', url: photoUrl } },
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
    }],
  });

  if (!response.parsed_output) {
    throw new Error('Claude did not return a parseable pin batch.');
  }
  return validatePinBatch(response.parsed_output);
}
