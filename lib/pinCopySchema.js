// lib/pinCopySchema.js
import { z } from 'zod';

// One row per generated pin in a batch -- see pinterest_pins table
// (supabase/migrations/20261109010000_pinterest_pins.sql), whose check
// constraints use these exact same values.
export const PIN_ANGLES = ['spotlight', 'buyer_focused', 'gift_lifestyle'];

// Mirrors lib/pageStorySchema.js's IMAGE_CLASSIFICATIONS pattern: listing
// the valid values explicitly (rather than relying on structured-output
// grammar alone) makes this an easier generation task for the model.
// "instructional" is the one that drives the educational-copy branch
// (design doc §16 item 5) -- an infographic, size chart, or
// care-instructions graphic, as opposed to a straightforward product or
// lifestyle photo.
export const PHOTO_CLASSIFICATIONS = ['product', 'lifestyle', 'instructional', 'other'];

// Design doc §16 item 6: medium/low confidence surfaces a "please confirm"
// nudge in the Review step instead of silently committing to a guess.
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

const PinVariationSchema = z.object({
  angle: z.enum(PIN_ANGLES),
  headline: z.string().describe('3-8 words, punchy, fits as large text on a 1000x1500 pin graphic'),
  supportingText: z.string().describe('One short reinforcing sentence, not shown on the graphic itself'),
  pinTitle: z.string().describe('Keyword-rich Pinterest title, under 100 characters'),
  pinDescription: z.string().describe('2-3 sentence Pinterest description written to surface in search'),
  keywords: z.array(z.string()).describe('3-6 search keywords, no # symbol'),
  boardCategory: z.string().describe('A short Pinterest board-name suggestion, e.g. "Handmade Gifts"'),
});

export const PinBatchSchema = z.object({
  photoClassification: z.enum(PHOTO_CLASSIFICATIONS),
  classificationConfidence: z.enum(CONFIDENCE_LEVELS),
  variations: z.array(PinVariationSchema).describe(`Exactly ${PIN_ANGLES.length} entries, one per angle in ${JSON.stringify(PIN_ANGLES)}, in that order.`),
});
