import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import {
  createPkcePair,
  signPayload,
  verifySignedPayload,
  createConnectTicket,
  verifyConnectTicket,
  exchangeCodeForToken,
  getValidEtsyToken,
} from './lib/etsyOAuth.js';
import { evaluateReceipt } from './lib/verifyPurchase.js';
import { extractAccentColor } from './lib/brandColor.js';
import { renderLandingPageDocument, renderNotFoundPage } from './lib/landingPageTemplate.js';

const {
  ETSY_API_KEY, ETSY_SHARED_SECRET, ANTHROPIC_API_KEY, PINTEREST_ACCESS_TOKEN,
  FACEBOOK_PAGE_ACCESS_TOKEN, FACEBOOK_PAGE_ID, INSTAGRAM_BUSINESS_ACCOUNT_ID,
  TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI = 'http://localhost:3000/auth/tiktok/callback',
  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
  ETSY_SELLER_SHOP_NAME, ETSY_PRODUCT_LISTING_ID, ETSY_SHOP_NAME_QUESTION_ID,
  ETSY_OAUTH_REDIRECT_URI = 'http://localhost:3000/auth/etsy/callback',
  PORT = 3000,
} = process.env;

if (!ETSY_API_KEY || !ETSY_SHARED_SECRET) {
  console.error('Missing ETSY_API_KEY or ETSY_SHARED_SECRET. Copy .env.example to .env and fill both in.');
  process.exit(1);
}

if (!ANTHROPIC_API_KEY) {
  console.warn('Missing ANTHROPIC_API_KEY. The "Create Landing Page" feature will be unavailable.');
}

if (!PINTEREST_ACCESS_TOKEN) {
  console.warn('Missing PINTEREST_ACCESS_TOKEN. Pinterest posting will be unavailable.');
}

if (!FACEBOOK_PAGE_ACCESS_TOKEN || !FACEBOOK_PAGE_ID) {
  console.warn('Missing FACEBOOK_PAGE_ACCESS_TOKEN/FACEBOOK_PAGE_ID. Facebook posting will be unavailable.');
}

if (!INSTAGRAM_BUSINESS_ACCOUNT_ID) {
  console.warn('Missing INSTAGRAM_BUSINESS_ACCOUNT_ID. Instagram posting will be unavailable.');
}

if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
  console.warn('Missing TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET. TikTok posting will be unavailable.');
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Missing SUPABASE_URL/SUPABASE_ANON_KEY. Login/signup will be unavailable.');
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('Missing SUPABASE_SERVICE_ROLE_KEY. The admin panel will be unavailable.');
}

if (!ETSY_SELLER_SHOP_NAME || !ETSY_PRODUCT_LISTING_ID) {
  console.warn('Missing ETSY_SELLER_SHOP_NAME or ETSY_PRODUCT_LISTING_ID. Automatic purchase verification will be unavailable.');
}

// Service-role client: bypasses row-level security entirely, so it's only ever
// used server-side and never sent to the browser. Three legitimate uses here:
// admin-only routes (gated by requireAdmin), routes gated by requireApproved /
// requireAuth (which use it to verify the caller's own token and profile), and
// the fully public GET /p/:id, whose entire job is public serving -- it
// deliberately bypasses the owner-only select policy on landing_pages, the same
// reasoning already used for etsy_seller_connection.
const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

async function requireAdmin(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Admin features are not configured on the server.' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header.' });
  }

  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profileError || profile?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  req.adminUser = user;
  next();
}

async function requireApproved(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Auth is not configured on the server.' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header.' });
  }

  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role, status, etsy_shop_name')
    .eq('id', user.id)
    .single();
  if (profileError || (profile?.role !== 'admin' && profile?.status !== 'approved')) {
    return res.status(403).json({ error: 'Your account is pending approval.' });
  }

  req.user = user;
  req.profile = profile;
  next();
}

// Like requireApproved, but deliberately does not check status/role -- this is
// the one endpoint whose entire job is to move an account out of "requested".
async function requireAuth(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Auth is not configured on the server.' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header.' });
  }

  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, email, role, status')
    .eq('id', user.id)
    .single();
  if (profileError || !profile) {
    return res.status(401).json({ error: 'No profile found for this account.' });
  }

  req.user = user;
  req.profile = profile;
  next();
}

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

const PINTEREST_BASE = 'https://api.pinterest.com/v5';

async function pinterestFetch(path, options = {}) {
  const res = await fetch(`${PINTEREST_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PINTEREST_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.message || `Pinterest API ${res.status}`;
    throw new Error(message);
  }
  return body;
}

const META_BASE = 'https://graph.facebook.com/v21.0';

async function metaFetch(path, params) {
  const url = new URL(`${META_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, value);
  }
  const res = await fetch(url, { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message || `Meta API ${res.status}`;
    throw new Error(message);
  }
  return body;
}

// --- TikTok: OAuth token is per-user and short-lived, so it's persisted to
// a local gitignored file rather than kept only in memory.
// os.tmpdir() is writable both locally and on Vercel (whose function filesystem
// is otherwise read-only) — the project directory itself is not writable there.
const TIKTOK_TOKEN_FILE = path.join(os.tmpdir(), 'etsy-shop-viewer-tiktok-token.json');

function readTikTokToken() {
  try {
    return JSON.parse(fs.readFileSync(TIKTOK_TOKEN_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeTikTokToken(token) {
  fs.writeFileSync(TIKTOK_TOKEN_FILE, JSON.stringify(token, null, 2));
}

async function tiktokFetch(path, options = {}) {
  const token = readTikTokToken();
  if (!token) throw new Error('TikTok is not connected. Visit /auth/tiktok to connect it.');

  const res = await fetch(`https://open.tiktokapis.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      ...options.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error?.code && body.error.code !== 'ok') {
    throw new Error(body?.error?.message || `TikTok API ${res.status}`);
  }
  return body;
}

const ETSY_BASE = 'https://openapi.etsy.com/v3/application';
const PAGE_SIZE = 100;
const CONCURRENCY = 2;
const MAX_RETRIES = 5;
const API_KEY_HEADER = `${ETSY_API_KEY}:${ETSY_SHARED_SECRET}`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function etsyFetch(path, attempt = 0) {
  const res = await fetch(`${ETSY_BASE}${path}`, {
    headers: { 'x-api-key': API_KEY_HEADER },
  });

  if (res.status === 429 && attempt < MAX_RETRIES) {
    const retryAfterSec = Number(res.headers.get('retry-after'));
    const delayMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? retryAfterSec * 1000
      : 500 * 2 ** attempt;
    await sleep(delayMs);
    return etsyFetch(path, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Etsy API ${res.status}: ${body}`);
  }
  return res.json();
}

// Runs `fn` over `items` with at most CONCURRENCY in flight at once, to stay
// under Etsy's rate limit while still being much faster than one-at-a-time.
async function mapWithConcurrency(items, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

async function findShopByName(shopName) {
  const data = await etsyFetch(`/shops?shop_name=${encodeURIComponent(shopName)}&limit=1`);
  return data.results?.[0] ?? null;
}

async function getAllActiveListings(shopId) {
  const firstPage = await etsyFetch(`/shops/${shopId}/listings/active?limit=${PAGE_SIZE}&offset=0`);
  const listings = [...firstPage.results];

  const remainingOffsets = [];
  for (let offset = PAGE_SIZE; offset < firstPage.count; offset += PAGE_SIZE) {
    remainingOffsets.push(offset);
  }

  const pages = await mapWithConcurrency(remainingOffsets, offset =>
    etsyFetch(`/shops/${shopId}/listings/active?limit=${PAGE_SIZE}&offset=${offset}`)
  );
  for (const page of pages) listings.push(...page.results);

  // Etsy's sort_order query param only takes effect alongside a keyword/region
  // search, which this endpoint doesn't do -- sorting here is what actually works.
  listings.sort((a, b) => (b.created_timestamp ?? 0) - (a.created_timestamp ?? 0));
  return listings;
}

// findAllActiveListingsByShop doesn't honor includes=Images, so images are
// fetched separately via the batch listings endpoint, chunked to stay under
// Etsy's per-request listing_ids limit.
async function getListingImages(listingIds) {
  const imagesByListingId = new Map();
  const chunks = [];
  for (let i = 0; i < listingIds.length; i += PAGE_SIZE) {
    chunks.push(listingIds.slice(i, i + PAGE_SIZE));
  }

  const pages = await mapWithConcurrency(chunks, chunk =>
    etsyFetch(`/listings/batch?listing_ids=${chunk.join(',')}&includes=Images`)
  );

  for (const page of pages) {
    for (const listing of page.results) {
      const firstImage = listing.images?.[0];
      if (firstImage) {
        imagesByListingId.set(listing.listing_id, firstImage.url_570xN ?? firstImage.url_fullxfull);
      }
    }
  }

  return imagesByListingId;
}

function formatListing(listing, imagesByListingId) {
  const price = listing.price
    ? (Number(listing.price.amount) / Number(listing.price.divisor)).toFixed(2)
    : null;

  return {
    id: listing.listing_id,
    title: listing.title,
    price,
    currency: listing.price?.currency_code ?? '',
    quantity: listing.quantity,
    url: listing.url,
    image: imagesByListingId.get(listing.listing_id) ?? null,
    tags: listing.tags ?? [],
  };
}

const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'pinterest'];

const PLATFORM_GUIDANCE = {
  facebook: 'Facebook: a warm, conversational caption (2-4 sentences), like a small-shop owner talking to regulars. 0-3 hashtags at most. No title.',
  instagram: 'Instagram: an inviting caption (roughly 60-120 words) with a bit of storytelling, ending on a soft call-to-action. 8-12 relevant hashtags. No title.',
  pinterest: 'Pinterest: a keyword-rich, benefit-led title (under 100 characters) plus a descriptive caption (2-3 sentences) written to surface in search. 3-6 hashtags.',
};

const SocialPostSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  title: z.string().nullable().describe('Only for Pinterest: a keyword-rich pin title under 100 characters. Null for every other platform.'),
  caption: z.string().describe('The main post text, written in the voice, length, and norms of the target platform'),
  hashtags: z.array(z.string()).max(12).describe('Hashtags without the # symbol'),
});

const LandingCopySchema = z.object({
  eyebrow: z.string().describe('Short all-caps-style tag line, 2-5 words, e.g. "HANDCRAFTED · LIMITED RUN"'),
  headline: z.string().describe('A punchy, distinctive product headline — not just the raw listing title'),
  subheadline: z.string().describe('One enthusiastic sentence expanding on the headline'),
  story: z.array(z.string()).min(2).max(4).describe('2-4 short paragraphs rewriting the description with enthusiasm and specificity'),
  highlights: z.array(z.string()).min(3).max(5).describe('3-5 short, punchy benefit phrases (not full sentences)'),
  cta: z.string().describe('Call-to-action button label, e.g. "Get Yours on Etsy"'),
  socialPosts: z.array(SocialPostSchema).min(1).max(SOCIAL_PLATFORMS.length)
    .describe('One entry per requested platform, in the same order they were requested'),
});

async function generateLandingCopy(listing, platforms) {
  const platformInstructions = platforms.map(p => `- ${PLATFORM_GUIDANCE[p]}`).join('\n');

  const response = await anthropic.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: zodOutputFormat(LandingCopySchema) },
    system:
      'You are a copywriter for a boutique e-commerce landing page builder. ' +
      'Write enthusiastic, specific, tasteful marketing copy for the given handmade/vintage Etsy product. ' +
      'Sound like a confident independent brand, not a hype-filled ad. No emojis. No exclamation-point spam (at most one, if any). ' +
      'Never invent facts, materials, dimensions, or claims not present in the listing data — you may rephrase and elevate what is given, but do not fabricate details. ' +
      `Also draft one social media post per platform below — write distinct copy per platform, not the same text reused:\n${platformInstructions}\n` +
      `socialPosts must contain exactly ${platforms.length} entr${platforms.length === 1 ? 'y' : 'ies'}, one per platform listed above, each with its "platform" field set exactly to that platform's name.`,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
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
  });

  if (!response.parsed_output) {
    throw new Error('Claude did not return parseable landing page copy.');
  }
  return response.parsed_output;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const app = express();
app.use(express.json());
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'public')));

// The anon key is safe to hand to the browser -- it's designed to be public and is
// what Supabase's client library uses for login/signup. Access to data is enforced
// by the row-level security policies on the database side, not by keeping this secret.
app.get('/api/config', (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(503).json({ error: 'Supabase is not configured on the server.' });
  }
  res.json({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY });
});

app.get('/api/admin/profiles', requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, company_name, role, status, page_allowance, etsy_shop_name, created_at')
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json({ profiles: data });
});

const ROLES = ['admin', 'user'];
const STATUSES = ['approved', 'declined', 'requested'];

app.patch('/api/admin/profiles/:id', requireAdmin, async (req, res) => {
  const { role, status, etsy_shop_name } = req.body ?? {};
  const updates = {};
  if (role !== undefined) {
    if (!ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
    updates.role = role;
  }
  if (status !== undefined) {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    updates.status = status;
  }
  if (etsy_shop_name !== undefined) {
    updates.etsy_shop_name = typeof etsy_shop_name === 'string' ? etsy_shop_name.trim() || null : null;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Provide role, status, and/or etsy_shop_name to update.' });
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', req.params.id)
    .select('id, email, full_name, company_name, role, status, page_allowance, etsy_shop_name, created_at')
    .single();
  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json({ profile: data });
});

// Called when a buyer repurchases the Starter tier -- adds to (never resets)
// their page_allowance via the grant_additional_pages() Postgres function,
// which only the service-role key can execute.
app.post('/api/admin/profiles/:id/grant-pages', requireAdmin, async (req, res) => {
  const amount = Number.isInteger(req.body?.amount) ? req.body.amount : 3;
  if (amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive integer.' });
  }

  const { data: target, error: lookupError } = await supabaseAdmin
    .from('profiles')
    .select('email')
    .eq('id', req.params.id)
    .single();
  if (lookupError || !target) {
    return res.status(404).json({ error: 'No profile found for that id.' });
  }

  const { data: newAllowance, error: grantError } = await supabaseAdmin
    .rpc('grant_additional_pages', { p_email: target.email, p_amount: amount });
  if (grantError) {
    console.error(grantError);
    return res.status(500).json({ error: grantError.message });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, company_name, role, status, page_allowance, etsy_shop_name, created_at')
    .eq('id', req.params.id)
    .single();
  if (profileError) {
    console.error(profileError);
    return res.status(500).json({ error: profileError.message });
  }

  res.json({ profile, page_allowance: newAllowance });
});

app.get('/api/pinterest/boards', requireApproved, async (req, res) => {
  if (!PINTEREST_ACCESS_TOKEN) {
    return res.status(503).json({ error: 'PINTEREST_ACCESS_TOKEN is not configured on the server.' });
  }
  try {
    const data = await pinterestFetch('/boards?page_size=100');
    res.json({ boards: (data.items || []).map(b => ({ id: b.id, name: b.name })) });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/pinterest/pin', requireApproved, async (req, res) => {
  if (!PINTEREST_ACCESS_TOKEN) {
    return res.status(503).json({ error: 'PINTEREST_ACCESS_TOKEN is not configured on the server.' });
  }

  const { boardId, imageUrl, link, title, description } = req.body ?? {};
  if (!boardId || !imageUrl || !title) {
    return res.status(400).json({ error: 'Missing boardId, imageUrl, or title.' });
  }

  try {
    const pin = await pinterestFetch('/pins', {
      method: 'POST',
      body: JSON.stringify({
        board_id: boardId,
        title,
        description,
        link,
        media_source: { source_type: 'image_url', url: imageUrl },
      }),
    });
    res.json({ id: pin.id, url: `https://www.pinterest.com/pin/${pin.id}/` });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/facebook/post', requireApproved, async (req, res) => {
  if (!FACEBOOK_PAGE_ACCESS_TOKEN || !FACEBOOK_PAGE_ID) {
    return res.status(503).json({ error: 'Facebook is not configured on the server.' });
  }
  const { message, link } = req.body ?? {};
  if (!message) return res.status(400).json({ error: 'Missing message.' });

  try {
    const post = await metaFetch(`/${FACEBOOK_PAGE_ID}/feed`, {
      message,
      link,
      access_token: FACEBOOK_PAGE_ACCESS_TOKEN,
    });
    res.json({ id: post.id, url: `https://www.facebook.com/${post.id}` });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/instagram/post', requireApproved, async (req, res) => {
  if (!FACEBOOK_PAGE_ACCESS_TOKEN || !INSTAGRAM_BUSINESS_ACCOUNT_ID) {
    return res.status(503).json({ error: 'Instagram is not configured on the server.' });
  }
  const { imageUrl, caption } = req.body ?? {};
  if (!imageUrl) return res.status(400).json({ error: 'Missing imageUrl.' });

  try {
    const media = await metaFetch(`/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`, {
      image_url: imageUrl,
      caption,
      access_token: FACEBOOK_PAGE_ACCESS_TOKEN,
    });
    const published = await metaFetch(`/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish`, {
      creation_id: media.id,
      access_token: FACEBOOK_PAGE_ACCESS_TOKEN,
    });
    res.json({ id: published.id, url: `https://www.instagram.com/p/${published.id}/` });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.get('/auth/tiktok', (req, res) => {
  if (!TIKTOK_CLIENT_KEY) {
    return res.status(503).send('TIKTOK_CLIENT_KEY is not configured on the server.');
  }
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', TIKTOK_CLIENT_KEY);
  url.searchParams.set('scope', 'user.info.basic,video.publish');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', TIKTOK_REDIRECT_URI);
  url.searchParams.set('state', 'etsy-shop-viewer');
  res.redirect(url.toString());
});

app.get('/auth/tiktok/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  if (error) return res.status(400).send(`TikTok auth failed: ${error_description || error}`);

  try {
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: TIKTOK_REDIRECT_URI,
      }),
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || token.error) {
      throw new Error(token.error_description || token.error || `TikTok token exchange ${tokenRes.status}`);
    }

    writeTikTokToken({ ...token, obtained_at: Date.now() });
    res.redirect('/?tiktok=connected');
  } catch (err) {
    console.error(err);
    res.status(502).send(`Failed to connect TikTok: ${err.message}`);
  }
});

app.get('/api/etsy/connect-ticket', requireAdmin, (req, res) => {
  res.json({ ticket: createConnectTicket(ETSY_SHARED_SECRET) });
});

app.get('/auth/etsy/connect', (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).send('Admin features are not configured on the server.');
  }
  if (!ETSY_SELLER_SHOP_NAME) {
    return res.status(503).send('ETSY_SELLER_SHOP_NAME is not configured on the server.');
  }
  if (!verifyConnectTicket(req.query.ticket, ETSY_SHARED_SECRET)) {
    return res.status(403).send('This connect link is invalid or has expired. Go back to the admin panel and click Connect Etsy again.');
  }

  const { codeVerifier, codeChallenge } = createPkcePair();
  const state = signPayload({ codeVerifier, nonce: crypto.randomBytes(8).toString('hex') }, ETSY_SHARED_SECRET);

  const url = new URL('https://www.etsy.com/oauth/connect');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', ETSY_API_KEY);
  url.searchParams.set('redirect_uri', ETSY_OAUTH_REDIRECT_URI);
  url.searchParams.set('scope', 'transactions_r');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  res.redirect(url.toString());
});

app.get('/auth/etsy/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.status(400).send(`Etsy auth failed: ${error_description || error}`);

  const statePayload = verifySignedPayload(state, ETSY_SHARED_SECRET);
  if (!statePayload || typeof statePayload.codeVerifier !== 'string') {
    return res.status(400).send('Etsy auth failed: state mismatch. Try connecting again from the admin panel.');
  }

  try {
    const token = await exchangeCodeForToken({
      code,
      codeVerifier: statePayload.codeVerifier,
      clientId: ETSY_API_KEY,
      redirectUri: ETSY_OAUTH_REDIRECT_URI,
    });

    const shop = await findShopByName(ETSY_SELLER_SHOP_NAME);
    if (!shop) {
      throw new Error(`No Etsy shop found named "${ETSY_SELLER_SHOP_NAME}" — check the ETSY_SELLER_SHOP_NAME env var.`);
    }

    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
    const { error: upsertError } = await supabaseAdmin
      .from('etsy_seller_connection')
      .upsert({
        id: 1,
        shop_id: shop.shop_id,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      });
    if (upsertError) throw new Error(upsertError.message);

    res.redirect('/admin.html?etsy=connected');
  } catch (err) {
    console.error(err);
    res.status(502).send(`Failed to connect Etsy: ${err.message}`);
  }
});

app.get('/api/etsy/status', requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('etsy_seller_connection')
    .select('shop_id, connected_at, expires_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json({
    connected: !!data,
    shopId: data?.shop_id ?? null,
    connectedAt: data?.connected_at ?? null,
    expiresAt: data?.expires_at ?? null,
  });
});

app.post('/api/verify-purchase', requireAuth, async (req, res) => {
  const receiptId = String(req.body?.receiptId ?? '').trim();
  if (!/^\d+$/.test(receiptId)) {
    return res.status(400).json({ error: 'Enter a valid Etsy order number.' });
  }

  if (req.profile.role === 'admin' || req.profile.status === 'approved') {
    return res.json({ approved: true });
  }

  if (req.profile.status === 'declined') {
    return res.status(403).json({ error: "This account can't be activated automatically — contact support." });
  }

  if (!ETSY_PRODUCT_LISTING_ID) {
    return res.status(503).json({ error: 'Purchase verification is temporarily unavailable — contact support.' });
  }

  try {
    const { data: existingClaim, error: claimError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('etsy_receipt_id', receiptId)
      .neq('id', req.user.id)
      .maybeSingle();
    if (claimError) throw new Error(claimError.message);

    let receipt = null;
    if (!existingClaim) {
      const etsyToken = await getValidEtsyToken(supabaseAdmin, ETSY_API_KEY);
      if (!etsyToken) {
        return res.status(503).json({ error: 'Purchase verification is temporarily unavailable — contact support.' });
      }

      const receiptRes = await fetch(`${ETSY_BASE}/shops/${etsyToken.shopId}/receipts/${receiptId}`, {
        headers: { 'x-api-key': API_KEY_HEADER, Authorization: `Bearer ${etsyToken.accessToken}` },
      });
      if (receiptRes.status !== 404) {
        if (!receiptRes.ok) {
          throw new Error(`Etsy API ${receiptRes.status}: ${await receiptRes.text()}`);
        }
        receipt = await receiptRes.json();
      }
    }

    const result = evaluateReceipt({
      receipt,
      listingId: ETSY_PRODUCT_LISTING_ID,
      claimedByOtherUser: !!existingClaim,
      shopNameQuestionId: ETSY_SHOP_NAME_QUESTION_ID,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.message });
    }

    const { error: approveError } = await supabaseAdmin
      .from('profiles')
      .update({
        status: 'approved',
        etsy_receipt_id: receiptId,
        purchase_verified_at: new Date().toISOString(),
        // Falls back to the existing manual admin field when the buyer's
        // answer to the "Your Etsy Shop Name" personalization question is
        // missing (e.g. an older order placed before that question existed).
        ...(result.shopName ? { etsy_shop_name: result.shopName } : {}),
      })
      .eq('id', req.user.id);
    if (approveError) {
      if (approveError.code === '23505') {
        return res.status(409).json({ error: 'This order number has already been used to activate another account.' });
      }
      throw new Error(approveError.message);
    }

    res.json({ approved: true });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Something went wrong checking your order — try again in a moment.' });
  }
});

app.get('/api/tiktok/status', requireApproved, (req, res) => {
  res.json({ connected: !!readTikTokToken() });
});

app.post('/api/tiktok/post', requireApproved, upload.single('video'), async (req, res) => {
  if (!TIKTOK_CLIENT_KEY) {
    return res.status(503).json({ error: 'TikTok is not configured on the server.' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Missing video file.' });
  }
  const { title } = req.body;

  try {
    const init = await tiktokFetch('/v2/post/publish/video/init/', {
      method: 'POST',
      body: JSON.stringify({
        post_info: {
          title: title || '',
          privacy_level: 'SELF_ONLY', // required for unaudited apps — visible only to the connected account
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: req.file.size,
          chunk_size: req.file.size,
          total_chunk_count: 1,
        },
      }),
    });

    const { publish_id, upload_url } = init.data;
    const uploadRes = await fetch(upload_url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(req.file.size),
        'Content-Range': `bytes 0-${req.file.size - 1}/${req.file.size}`,
      },
      body: req.file.buffer,
    });
    if (!uploadRes.ok) {
      throw new Error(`TikTok video upload failed (${uploadRes.status})`);
    }

    res.json({
      publishId: publish_id,
      note: 'Submitted. Unaudited apps publish as private (visible only to the connected TikTok account) — check the TikTok app inbox to confirm.',
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/landing-pages', requireApproved, async (req, res) => {
  if (!anthropic) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Landing pages are not configured on the server.' });
  }

  const { listingId } = req.body ?? {};
  if (!listingId) {
    return res.status(400).json({ error: 'Missing listingId.' });
  }

  // Safe under the service-role client even though create_landing_page_allowed
  // guards with `if p_user_id <> auth.uid() then raise`: with no JWT, auth.uid()
  // is NULL, `p_user_id <> NULL` is NULL, and PL/pgSQL's IF treats NULL as false,
  // so the guard never fires and the explicitly-passed id is used. That id is
  // req.user.id, already authenticated by requireApproved above (never client-
  // supplied) -- but tightening that guard (e.g. to `is distinct from`) would
  // silently start rejecting every call here.
  const { data: allowance, error: allowanceError } = await supabaseAdmin
    .rpc('create_landing_page_allowed', { p_user_id: req.user.id });
  if (allowanceError) {
    console.error(allowanceError);
    return res.status(500).json({ error: allowanceError.message });
  }
  if (!allowance?.[0]?.allowed) {
    return res.status(403).json({ error: "You've reached your page limit — purchase again to unlock 3 more pages." });
  }

  let listing;
  try {
    listing = await etsyFetch(`/listings/${listingId}?includes=Images,Shop`);
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: err.message });
  }
  if (!assertShopAllowed(req, res, listing.shop?.shop_name || '')) return;

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

    const price = listing.price
      ? (Number(listing.price.amount) / Number(listing.price.divisor)).toFixed(2)
      : null;

    // Best-effort: theme the page with a color pulled from the shop's own
    // icon/banner/listing photo. Never blocks page creation on failure --
    // a bad or missing image just keeps the default theme.
    let colors = null;
    const brandImageUrl = listing.shop?.icon_url_fullxfull || listing.shop?.image_url_760x100 || listing.images?.[0]?.url_fullxfull;
    if (brandImageUrl) {
      try {
        colors = await extractAccentColor(brandImageUrl);
      } catch (err) {
        console.error('Brand color extraction failed, using default theme:', err.message);
      }
    }

    const content = { listing, copy, price, colors };

    // Insert as the caller, not the service role: the "Users can insert landing
    // pages within their allowance" RLS policy is the real paywall enforcement
    // point, and service-role inserts bypass RLS entirely -- which would let
    // concurrent requests that all passed the pre-check above each mint a page.
    const supabaseAsUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: req.headers.authorization } },
    });

    const { data: row, error: insertError } = await supabaseAsUser
      .from('landing_pages')
      .insert({ user_id: req.user.id, listing_id: listing.listing_id, content })
      .select('id')
      .single();
    if (insertError) {
      console.error(insertError);
      return res.status(500).json({ error: insertError.message });
    }

    res.json({ id: row.id, url: `/p/${row.id}`, copy });
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(502).json({ error: 'Invalid Anthropic API key.' });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(502).json({ error: 'Rate limited by Anthropic API — try again shortly.' });
    }
    res.status(502).json({ error: err.message });
  }
});

app.get('/p/:id', async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).send('Landing pages are not configured on the server.');
  }

  try {
    const { data: row, error } = await supabaseAdmin
      .from('landing_pages')
      .select('content')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error || !row?.content) {
      return res.status(404).send(renderNotFoundPage());
    }

    res.set('Content-Type', 'text/html').send(renderLandingPageDocument({
      ...row.content,
      pageUrl: `${req.protocol}://${req.get('host')}/p/${req.params.id}`,
    }));
  } catch (err) {
    // A malformed content snapshot can make rendering throw. This route is
    // public and unauthenticated, and an uncaught async throw here would take
    // down the whole process -- so fall back to the same 404 page.
    console.error(err);
    res.status(404).send(renderNotFoundPage());
  }
});

// Non-admin customers are restricted to the one shop an admin assigned them
// (etsy_shop_name) -- Etsy's API has no way to verify shop ownership, so this
// is the actual enforcement boundary; the UI just reflects it, doesn't create it.
function assertShopAllowed(req, res, shopName) {
  if (req.profile.role === 'admin') return true;
  if (!req.profile.etsy_shop_name) {
    res.status(403).json({ error: "Your account isn't linked to a shop yet — contact support." });
    return false;
  }
  if (req.profile.etsy_shop_name.toLowerCase() !== shopName.toLowerCase()) {
    res.status(403).json({ error: 'You can only view your own shop.' });
    return false;
  }
  return true;
}

app.get('/api/listing/:listingId', requireApproved, async (req, res) => {
  try {
    const listing = await etsyFetch(
      `/listings/${req.params.listingId}?includes=Images,Videos,Shop,User,Translations`
    );
    if (!assertShopAllowed(req, res, listing.shop?.shop_name || '')) return;
    res.json(listing);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/shop/:shopName', requireApproved, async (req, res) => {
  if (!assertShopAllowed(req, res, req.params.shopName)) return;
  try {
    const shop = await findShopByName(req.params.shopName);
    if (!shop) {
      return res.status(404).json({ error: `No Etsy shop found named "${req.params.shopName}"` });
    }

    const rawListings = await getAllActiveListings(shop.shop_id);
    const imagesByListingId = await getListingImages(rawListings.map(l => l.listing_id));

    res.json({
      shop: {
        id: shop.shop_id,
        name: shop.shop_name,
        title: shop.title,
        icon: shop.icon_url_fullxfull,
        listingCount: rawListings.length,
        // Etsy's own shop-summary counter -- kept separate from listingCount
        // (the actual /listings/active results) so the client can detect when
        // Etsy's search index hasn't caught up yet: the summary says there's
        // an active listing, but the detailed endpoint returns none.
        etsyReportedActiveCount: shop.listing_active_count ?? 0,
      },
      listings: rawListings.map(listing => formatListing(listing, imagesByListingId)),
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Etsy shop viewer running at http://localhost:${PORT}`);
});

// Lets Vercel's serverless function (api/index.js) import this same app
// instead of running its own server.
export default app;
