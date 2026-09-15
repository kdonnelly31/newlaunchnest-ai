// One-off tool: pulls a source image for your Etsy shop (icon, then banner,
// then your most recent listing photo -- whichever is set first) and reports
// its dominant colors as hex codes, so you can reuse your existing shop
// branding on the landing page.
//
// Usage: node scripts/extract-shop-icon-colors.mjs
import 'dotenv/config';
import { Jimp, intToRGBA } from 'jimp';
import { writeFile } from 'node:fs/promises';

const { ETSY_API_KEY, ETSY_SHARED_SECRET, ETSY_SELLER_SHOP_NAME } = process.env;

const ETSY_BASE = 'https://openapi.etsy.com/v3/application';
const API_KEY_HEADER = `${ETSY_API_KEY}:${ETSY_SHARED_SECRET}`;

async function etsyFetch(path) {
  const res = await fetch(`${ETSY_BASE}${path}`, { headers: { 'x-api-key': API_KEY_HEADER } });
  if (!res.ok) throw new Error(`Etsy API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function findShopByName(shopName) {
  const data = await etsyFetch(`/shops?shop_name=${encodeURIComponent(shopName)}&limit=1`);
  return data.results?.[0] ?? null;
}

// Shop icon is the ideal source, but plenty of shops never set one -- in that
// case, fall back to the primary photo of their most recent active listing.
async function findFallbackImage(shopId) {
  const listings = await etsyFetch(`/shops/${shopId}/listings/active?limit=1&sort_on=created&sort_order=desc`);
  const listing = listings.results?.[0];
  if (!listing) return null;

  const withImages = await etsyFetch(`/listings/${listing.listing_id}?includes=Images`);
  const firstImage = withImages.images?.[0];
  if (!firstImage) return null;
  return { url: firstImage.url_fullxfull ?? firstImage.url_570xN, source: `listing "${listing.title}"` };
}

// Rounds each channel to the nearest bucket so near-identical shades (e.g.
// #f1641e vs #f2651f from JPEG compression noise) count as one color.
const BUCKET = 24;
function quantize(r, g, b) {
  const round = (c) => Math.min(255, Math.round(c / BUCKET) * BUCKET);
  return `${round(r)},${round(g)},${round(b)}`;
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

async function main() {
  if (!ETSY_API_KEY || !ETSY_SHARED_SECRET || !ETSY_SELLER_SHOP_NAME) {
    console.error('Missing ETSY_API_KEY, ETSY_SHARED_SECRET, or ETSY_SELLER_SHOP_NAME in .env');
    process.exitCode = 1;
    return;
  }

  const shop = await findShopByName(ETSY_SELLER_SHOP_NAME);
  if (!shop) {
    console.error(`No Etsy shop found named "${ETSY_SELLER_SHOP_NAME}"`);
    process.exitCode = 1;
    return;
  }

  let imageUrl = shop.icon_url_fullxfull;
  let source = 'shop icon';

  if (!imageUrl && shop.image_url_760x100) {
    imageUrl = shop.image_url_760x100;
    source = 'shop banner';
  }

  if (!imageUrl) {
    console.log('This shop has no icon or banner set on Etsy -- falling back to your most recent listing photo.');
    const fallback = await findFallbackImage(shop.shop_id);
    if (!fallback) {
      console.error('No shop icon, banner, or listing photos found -- nothing to sample colors from.');
      process.exitCode = 1;
      return;
    }
    imageUrl = fallback.url;
    source = fallback.source;
  }

  console.log(`Source image (${source}): ${imageUrl}`);

  const image = await Jimp.read(imageUrl);
  image.resize({ w: 400, h: 400 });

  const counts = new Map();
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
    const { r, g, b, a } = intToRGBA(image.bitmap.data.readUInt32BE(idx));
    if (a < 128) return; // skip transparent pixels
    const key = quantize(r, g, b);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([key, count]) => {
      const [r, g, b] = key.split(',').map(Number);
      return { hex: toHex(r, g, b), pct: Math.round((count / total) * 100) };
    });

  console.log('\nTop colors by share of the image:');
  for (const { hex, pct } of top) {
    console.log(`  ${hex}  (${pct}%)`);
  }

  const css = [
    `/* Generated from your Etsy ${source} by scripts/extract-shop-icon-colors.mjs */`,
    ':root {',
    ...top.map(({ hex }, i) => `  --brand-color-${i + 1}: ${hex};`),
    '}',
    '',
  ].join('\n');

  await writeFile(new URL('./shop-icon-colors.css', import.meta.url), css);
  console.log('\nWrote CSS variables to scripts/shop-icon-colors.css');
  console.log('Note: the biggest % is often just the background, not a real brand color -- eyeball the list above and pick the ones that match your logo.');
}

await main();
