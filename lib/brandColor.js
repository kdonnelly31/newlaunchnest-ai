import { Jimp, intToRGBA } from 'jimp';

function toHex(r, g, b) {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

// A color only counts as "on-brand" if it has real hue (not gray/white/cream)
// and isn't so dark it'd be indistinguishable from near-black photo noise.
const SATURATION_THRESHOLD = 0.35;
const MIN_VALUE = 45;

// Picks the most common color that looks like an intentional brand color
// rather than a background, out of raw {r, g, b, count} pixel tallies.
// Returns null if nothing in the image clears the bar (e.g. a grayscale photo).
export function pickAccentColor(colorCounts) {
  const candidates = colorCounts.filter(({ r, g, b }) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === 0) return false;
    const saturation = (max - min) / max;
    return saturation > SATURATION_THRESHOLD && max > MIN_VALUE;
  });
  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) => (b.count > a.count ? b : a));
  return toHex(best.r, best.g, best.b);
}

// Blends a hex color toward white by `amount` (0 = unchanged, 1 = white) --
// used to derive a harmonious secondary accent from the one extracted color.
export function lightenHex(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const blend = (c) => Math.round(c + (255 - c) * amount);
  return toHex(blend(r), blend(g), blend(b));
}

// Rounds each channel to the nearest bucket so near-identical shades (JPEG
// compression noise) count as one color when tallying frequency.
const BUCKET = 24;
function quantize(c) {
  return Math.min(255, Math.round(c / BUCKET) * BUCKET);
}

// Downloads `imageUrl` and extracts a brand accent color pair for theming a
// generated landing page. Never throws for "no good color found" -- only for
// actual fetch/decode failures, which the caller treats the same way (fall
// back to the default theme).
export async function extractAccentColor(imageUrl) {
  const image = await Jimp.read(imageUrl);
  image.resize({ w: 400, h: 400 });

  const counts = new Map();
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
    const { r, g, b, a } = intToRGBA(image.bitmap.data.readUInt32BE(idx));
    if (a < 128) return;
    const key = `${quantize(r)},${quantize(g)},${quantize(b)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  const colorCounts = [...counts.entries()].map(([key, count]) => {
    const [r, g, b] = key.split(',').map(Number);
    return { r, g, b, count };
  });

  const accent = pickAccentColor(colorCounts);
  if (!accent) return { accent: null, accentWarm: null };
  return { accent, accentWarm: lightenHex(accent, 0.45) };
}
