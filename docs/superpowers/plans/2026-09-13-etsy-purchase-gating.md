# Etsy Purchase Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 100%-manual admin approval of new LaunchNestAI signups with automatic verification of a real, paid Etsy order for the LaunchNestAI listing, keeping manual admin Approve/Decline as a fallback.

**Architecture:** Two additions to the existing Express + Supabase app: (1) a one-time Etsy OAuth connection so the server can read the seller's own shop receipts, stored in a new Supabase table and refreshed automatically; (2) a buyer-facing `/api/verify-purchase` endpoint that looks up a submitted Etsy order number against that shop's receipts and auto-approves the account if it's paid and contains the right listing. A small, unrelated fix (sort the shop-listings dropdown newest-first) is bundled in as its own first task.

**Tech Stack:** Node.js (ESM), Express, Supabase (`@supabase/supabase-js`), Etsy Open API v3 (OAuth 2.0 + PKCE), Node's built-in test runner (`node --test`) — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-13-etsy-purchase-gating-design.md`

## Global Constraints

- ESM only (`"type": "module"` in `package.json`) — use `import`/`export`, not `require`.
- No new npm dependencies. Node's built-in `crypto` and `node:test` cover everything needed.
- The service-role Supabase client (`supabaseAdmin`) is server-side only — never expose it or its results unfiltered to the browser.
- Follow existing `server.js` conventions: route handlers wrapped in `try/catch`, errors logged with `console.error` then returned as `{ error: message }` JSON with an appropriate status code.
- Buyer-facing error messages must be plain language (per the spec's Error Handling Summary table) — no raw Etsy API error text shown to buyers.
- The email-match check described as a "Future Enhancement" in the spec is explicitly **not** part of this plan — do not implement it.

---

### Task 1: Sort the shop-listings dropdown newest-first

**Files:**
- Modify: `server.js` (the `getAllActiveListings` function, currently around lines 245-260)

**Interfaces:**
- No new exports. `getAllActiveListings(shopId)` keeps its existing signature and return type (`Promise<Array<RawEtsyListing>>`, each with at least `listing_id` and `created_timestamp` as returned by Etsy).

Etsy's `sort_order` parameter on this endpoint is documented as only taking effect when combined with a keyword/region search, which this endpoint doesn't do — so passing `sort_on`/`sort_order` query params here would silently do nothing. Sorting the already-fetched results ourselves is guaranteed correct regardless of Etsy's behavior.

- [ ] **Step 1: Add the sort**

In `server.js`, find:

```js
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

  return listings;
}
```

Replace the final `return listings;` with:

```js
  // Etsy's sort_order query param only takes effect alongside a keyword/region
  // search, which this endpoint doesn't do -- sorting here is what actually works.
  listings.sort((a, b) => b.created_timestamp - a.created_timestamp);
  return listings;
}
```

- [ ] **Step 2: Manually verify**

Run: `node server.js` (with a valid `.env` already in place), then in a browser log in as an approved user, search a shop with several listings, and confirm the "Product" dropdown lists the most recently created listing first. Compare against the shop's actual listing creation order on etsy.com if unsure.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "Sort shop listings newest-first in the product dropdown"
```

---

### Task 2: Database migration for purchase verification

**Files:**
- Create: `supabase/migrations/20260913000000_etsy_purchase_verification.sql`

**Interfaces:**
- Produces: table `public.etsy_seller_connection` (columns: `id`, `shop_id`, `access_token`, `refresh_token`, `expires_at`, `connected_at`, `updated_at`), RLS enabled with no policies (service-role only).
- Produces: `public.profiles.etsy_receipt_id` (text, nullable), `public.profiles.purchase_verified_at` (timestamptz, nullable), and a unique partial index `profiles_etsy_receipt_id_key` enforcing one account per receipt.
- Later tasks (3, 6) depend on these exact table/column names.

This project has no Supabase CLI wired up (migrations are plain SQL files, applied by hand) — so "testing" this task means running the SQL yourself and confirming it applies cleanly, not an automated test.

- [ ] **Step 1: Write the migration**

```sql
-- Holds the single OAuth connection to the seller's (your) own Etsy shop.
-- Never exposed to any client; only the service-role key reads/writes it.
create table public.etsy_seller_connection (
  id integer primary key default 1 check (id = 1), -- singleton row
  shop_id bigint not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.etsy_seller_connection enable row level security;
-- No policies: RLS blocks anon/authenticated entirely; service_role bypasses RLS.

-- Tracks which verified Etsy order unlocked each account, and prevents
-- one order number from being used to approve more than one account.
alter table public.profiles
  add column etsy_receipt_id text,
  add column purchase_verified_at timestamptz;

create unique index profiles_etsy_receipt_id_key
  on public.profiles (etsy_receipt_id)
  where etsy_receipt_id is not null;
```

- [ ] **Step 2: Apply it and verify**

In the Supabase Dashboard → SQL Editor, paste and run the file's contents against your project (the same way the earlier migrations in `supabase/migrations/` were applied). Then verify:
- Table Editor shows a new `etsy_seller_connection` table with 0 rows.
- The `profiles` table now has `etsy_receipt_id` and `purchase_verified_at` columns.
- Running `insert into public.etsy_seller_connection (id, shop_id, access_token, refresh_token, expires_at) values (2, 1, 'x', 'y', now());` fails (violates the `check (id = 1)` constraint) — then delete any test row you inserted with `id = 1` if you used one.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260913000000_etsy_purchase_verification.sql
git commit -m "Add etsy_seller_connection table and receipt-tracking columns on profiles"
```

---

### Task 3: Etsy OAuth helper module

**Files:**
- Create: `lib/etsyOAuth.js`
- Test: `lib/etsyOAuth.test.js`
- Modify: `package.json` (add a `test` script)
- Modify: `.env.example` (document new env vars)

**Interfaces:**
- Consumes: nothing from earlier tasks (Task 2's `etsy_seller_connection` table is read/written by `getValidEtsyToken`, called with a Supabase client passed in by the caller).
- Produces (used by Task 5):
  - `createPkcePair(): { codeVerifier: string, codeChallenge: string }`
  - `isTokenExpiringSoon(expiresAtIso: string, nowMs?: number, bufferMs?: number): boolean`
  - `exchangeCodeForToken({ code, codeVerifier, clientId, redirectUri }): Promise<{ access_token, refresh_token, expires_in }>`
  - `refreshEtsyToken({ refreshToken, clientId }): Promise<{ access_token, refresh_token, expires_in }>`
  - `getValidEtsyToken(supabaseAdmin, clientId): Promise<{ accessToken: string, shopId: number } | null>`
  - `writeEtsyOAuthState({ codeVerifier, state }): void`
  - `readEtsyOAuthState(): { codeVerifier: string, state: string } | null`

- [ ] **Step 1: Write the failing tests for the pure functions**

Create `lib/etsyOAuth.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPkcePair, isTokenExpiringSoon } from './etsyOAuth.js';

test('createPkcePair returns a verifier and a matching S256 challenge', () => {
  const { codeVerifier, codeChallenge } = createPkcePair();
  assert.match(codeVerifier, /^[A-Za-z0-9._~-]{43,128}$/);
  assert.match(codeChallenge, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(codeVerifier, codeChallenge);
});

test('createPkcePair returns a different pair each call', () => {
  const a = createPkcePair();
  const b = createPkcePair();
  assert.notEqual(a.codeVerifier, b.codeVerifier);
});

test('isTokenExpiringSoon is true when expiry is within the buffer window', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const expiresAt = new Date(now + 2 * 60 * 1000).toISOString(); // 2 min from now
  assert.equal(isTokenExpiringSoon(expiresAt, now, 5 * 60 * 1000), true);
});

test('isTokenExpiringSoon is false when expiry is well outside the buffer window', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const expiresAt = new Date(now + 30 * 60 * 1000).toISOString(); // 30 min from now
  assert.equal(isTokenExpiringSoon(expiresAt, now, 5 * 60 * 1000), false);
});

test('isTokenExpiringSoon is true for an already-expired token', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const expiresAt = new Date(now - 1000).toISOString();
  assert.equal(isTokenExpiringSoon(expiresAt, now, 5 * 60 * 1000), true);
});
```

- [ ] **Step 2: Add the test script and run to verify it fails**

In `package.json`, add under `"scripts"`:

```json
"test": "node --test"
```

Run: `npm test`
Expected: FAIL — `lib/etsyOAuth.js` doesn't exist yet.

- [ ] **Step 3: Write `lib/etsyOAuth.js`**

```js
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ETSY_TOKEN_ENDPOINT = 'https://api.etsy.com/v3/public/oauth/token';

export function createPkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function isTokenExpiringSoon(expiresAtIso, nowMs = Date.now(), bufferMs = 5 * 60 * 1000) {
  return new Date(expiresAtIso).getTime() - nowMs < bufferMs;
}

// PKCE state has to survive the round trip to Etsy and back. Stashed in a tmp
// file rather than a cookie or in-memory variable, matching the existing
// TIKTOK_TOKEN_FILE pattern in server.js: os.tmpdir() is writable on Vercel,
// the project directory isn't.
const ETSY_OAUTH_STATE_FILE = path.join(os.tmpdir(), 'etsy-shop-viewer-etsy-oauth-state.json');

export function writeEtsyOAuthState(state) {
  fs.writeFileSync(ETSY_OAUTH_STATE_FILE, JSON.stringify(state));
}

export function readEtsyOAuthState() {
  try {
    return JSON.parse(fs.readFileSync(ETSY_OAUTH_STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function requestToken(body) {
  const res = await fetch(ETSY_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parsed.error_description || parsed.error || `Etsy OAuth token request failed (${res.status})`);
  }
  return parsed;
}

export async function exchangeCodeForToken({ code, codeVerifier, clientId, redirectUri }) {
  return requestToken({
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
    code_verifier: codeVerifier,
  });
}

export async function refreshEtsyToken({ refreshToken, clientId }) {
  return requestToken({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });
}

// Returns the current connection's access token, refreshing it first (and
// persisting the refreshed pair, since Etsy rotates the refresh token on
// every use) if it's within 5 minutes of expiring. Returns null if no
// Etsy account has been connected yet.
export async function getValidEtsyToken(supabaseAdmin, clientId) {
  const { data: connection, error } = await supabaseAdmin
    .from('etsy_seller_connection')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!connection) return null;

  if (!isTokenExpiringSoon(connection.expires_at)) {
    return { accessToken: connection.access_token, shopId: connection.shop_id };
  }

  const refreshed = await refreshEtsyToken({ refreshToken: connection.refresh_token, clientId });
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  const { error: updateError } = await supabaseAdmin
    .from('etsy_seller_connection')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
  if (updateError) throw new Error(updateError.message);

  return { accessToken: refreshed.access_token, shopId: connection.shop_id };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (5 tests in `lib/etsyOAuth.test.js`).

- [ ] **Step 5: Document the new env vars**

In `.env.example`, add after the existing `ETSY_SHARED_SECRET` line:

```
ETSY_SELLER_SHOP_NAME=your_own_etsy_shop_name_here
ETSY_PRODUCT_LISTING_ID=your_launchnestai_listing_id_here
ETSY_OAUTH_REDIRECT_URI=http://localhost:3000/auth/etsy/callback
```

Add the same three lines (with your real values, and your production callback URL for `ETSY_OAUTH_REDIRECT_URI`) to your actual `.env` and to your Vercel project's environment variables before Task 5 is deployed.

- [ ] **Step 6: Commit**

```bash
git add lib/etsyOAuth.js lib/etsyOAuth.test.js package.json .env.example
git commit -m "Add Etsy OAuth helper module (PKCE, token exchange/refresh)"
```

---

### Task 4: Purchase-verification decision logic

**Files:**
- Create: `lib/verifyPurchase.js`
- Test: `lib/verifyPurchase.test.js`

**Interfaces:**
- Consumes: nothing (pure function, no I/O).
- Produces (used by Task 6):
  - `evaluateReceipt({ receipt, listingId, claimedByOtherUser }): { ok: true } | { ok: false, status: number, message: string }`
  - `receipt` is either `null` (not found) or an Etsy `ShopReceipt` object (has `is_paid: boolean` and `transactions: Array<{ listing_id: number }>`).

This is the one piece of `/api/verify-purchase`'s logic worth isolating and unit-testing on its own — it's pure decision-making with no network or database calls, so every branch in the spec's error table can be tested directly without mocking anything.

- [ ] **Step 1: Write the failing tests**

Create `lib/verifyPurchase.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateReceipt } from './verifyPurchase.js';

const paidReceiptWithListing = {
  is_paid: true,
  transactions: [{ listing_id: 111 }, { listing_id: 222 }],
};

test('rejects when the receipt was already claimed by another account', () => {
  const result = evaluateReceipt({ receipt: paidReceiptWithListing, listingId: 111, claimedByOtherUser: true });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test('rejects when the receipt does not exist', () => {
  const result = evaluateReceipt({ receipt: null, listingId: 111, claimedByOtherUser: false });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test('rejects when the receipt is not paid', () => {
  const receipt = { ...paidReceiptWithListing, is_paid: false };
  const result = evaluateReceipt({ receipt, listingId: 111, claimedByOtherUser: false });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.match(result.message, /payment/i);
});

test('rejects when the receipt does not include the target listing', () => {
  const result = evaluateReceipt({ receipt: paidReceiptWithListing, listingId: 999, claimedByOtherUser: false });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.match(result.message, /LaunchNestAI product/);
});

test('approves a paid receipt containing the target listing, unclaimed', () => {
  const result = evaluateReceipt({ receipt: paidReceiptWithListing, listingId: 222, claimedByOtherUser: false });
  assert.deepEqual(result, { ok: true });
});

test('matches listing_id even when one side is a string', () => {
  const result = evaluateReceipt({ receipt: paidReceiptWithListing, listingId: '222', claimedByOtherUser: false });
  assert.deepEqual(result, { ok: true });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `lib/verifyPurchase.js` doesn't exist yet.

- [ ] **Step 3: Write `lib/verifyPurchase.js`**

```js
export function evaluateReceipt({ receipt, listingId, claimedByOtherUser }) {
  if (claimedByOtherUser) {
    return {
      ok: false,
      status: 409,
      message: 'This order number has already been used to activate another account.',
    };
  }

  if (!receipt) {
    return {
      ok: false,
      status: 404,
      message: "We couldn't find that order number — double-check it and try again.",
    };
  }

  if (!receipt.is_paid) {
    return {
      ok: false,
      status: 422,
      message: "That order hasn't completed payment yet.",
    };
  }

  const hasListing = (receipt.transactions || []).some(
    t => String(t.listing_id) === String(listingId)
  );
  if (!hasListing) {
    return {
      ok: false,
      status: 422,
      message: "That order doesn't include the LaunchNestAI product.",
    };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all tests in both `lib/etsyOAuth.test.js` and `lib/verifyPurchase.test.js`).

- [ ] **Step 5: Commit**

```bash
git add lib/verifyPurchase.js lib/verifyPurchase.test.js
git commit -m "Add pure receipt-validation logic for purchase verification"
```

---

### Task 5: Wire up the Etsy connect flow and admin UI

**Files:**
- Modify: `server.js` (add imports, env vars, routes)
- Modify: `public/admin.html` (connection status + connect link)

**Interfaces:**
- Consumes: `createPkcePair`, `writeEtsyOAuthState`, `readEtsyOAuthState`, `exchangeCodeForToken` from `lib/etsyOAuth.js` (Task 3).
- Produces: `GET /auth/etsy/connect`, `GET /auth/etsy/callback`, `GET /api/etsy/status` routes, used manually by you and by Task 6's `getValidEtsyToken` call (via the `etsy_seller_connection` row this flow creates).

- [ ] **Step 1: Add the new imports and env vars to `server.js`**

Near the top of `server.js`, find:

```js
import { createClient } from '@supabase/supabase-js';
```

Add right after it:

```js
import crypto from 'crypto';
import {
  createPkcePair,
  writeEtsyOAuthState,
  readEtsyOAuthState,
  exchangeCodeForToken,
  getValidEtsyToken,
} from './lib/etsyOAuth.js';
```

Find the env var destructuring block:

```js
const {
  ETSY_API_KEY, ETSY_SHARED_SECRET, ANTHROPIC_API_KEY, PINTEREST_ACCESS_TOKEN,
  FACEBOOK_PAGE_ACCESS_TOKEN, FACEBOOK_PAGE_ID, INSTAGRAM_BUSINESS_ACCOUNT_ID,
  TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI = 'http://localhost:3000/auth/tiktok/callback',
  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
  PORT = 3000,
} = process.env;
```

Replace it with:

```js
const {
  ETSY_API_KEY, ETSY_SHARED_SECRET, ANTHROPIC_API_KEY, PINTEREST_ACCESS_TOKEN,
  FACEBOOK_PAGE_ACCESS_TOKEN, FACEBOOK_PAGE_ID, INSTAGRAM_BUSINESS_ACCOUNT_ID,
  TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI = 'http://localhost:3000/auth/tiktok/callback',
  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
  ETSY_SELLER_SHOP_NAME, ETSY_PRODUCT_LISTING_ID,
  ETSY_OAUTH_REDIRECT_URI = 'http://localhost:3000/auth/etsy/callback',
  PORT = 3000,
} = process.env;
```

Find the existing Supabase warning:

```js
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('Missing SUPABASE_SERVICE_ROLE_KEY. The admin panel will be unavailable.');
}
```

Add right after it:

```js
if (!ETSY_SELLER_SHOP_NAME || !ETSY_PRODUCT_LISTING_ID) {
  console.warn('Missing ETSY_SELLER_SHOP_NAME or ETSY_PRODUCT_LISTING_ID. Automatic purchase verification will be unavailable.');
}
```

- [ ] **Step 2: Add the OAuth connect/callback/status routes**

In `server.js`, find the TikTok callback route (it ends with `res.status(502).send(...)` inside a catch block, just before `app.get('/api/tiktok/status', ...)`). Add the following new routes directly after the TikTok callback route and before `app.get('/api/tiktok/status', ...)`:

```js
app.get('/auth/etsy/connect', (req, res) => {
  if (!ETSY_SELLER_SHOP_NAME) {
    return res.status(503).send('ETSY_SELLER_SHOP_NAME is not configured on the server.');
  }

  const { codeVerifier, codeChallenge } = createPkcePair();
  const state = crypto.randomBytes(16).toString('hex');
  writeEtsyOAuthState({ codeVerifier, state });

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

  const saved = readEtsyOAuthState();
  if (!saved || saved.state !== state) {
    return res.status(400).send('Etsy auth failed: state mismatch. Try connecting again from the admin panel.');
  }

  try {
    const token = await exchangeCodeForToken({
      code,
      codeVerifier: saved.codeVerifier,
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
    .select('shop_id, connected_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json({ connected: !!data, shopId: data?.shop_id ?? null, connectedAt: data?.connected_at ?? null });
});
```

- [ ] **Step 3: Add the connection status UI to `public/admin.html`**

Find:

```html
  <p id="status">Loading…</p>

  <div class="table-wrap">
```

Replace with:

```html
  <p id="status">Loading…</p>
  <p id="etsy-status" style="text-align:center; color:var(--muted); margin:0 0 1rem;"></p>

  <div class="table-wrap">
```

Find:

```js
    async function init() {
      const configRes = await fetch('/api/config');
      if (!configRes.ok) {
        setStatus('Admin panel is not available — the site is missing its Supabase configuration.', 'error');
        return;
      }
      const { supabaseUrl, supabaseAnonKey } = await configRes.json();
      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = '/login.html';
        return;
      }

      const res = await fetch('/api/admin/profiles', {
```

Replace with:

```js
    async function loadEtsyStatus(accessToken) {
      const etsyStatusEl = document.getElementById('etsy-status');
      const res = await fetch('/api/etsy/status', { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return;
      const data = await res.json();
      etsyStatusEl.innerHTML = data.connected
        ? `Etsy connected (shop ID ${data.shopId}).`
        : '<a href="/auth/etsy/connect" style="color:var(--accent);">Connect Etsy to enable automatic purchase verification</a>';
    }

    async function init() {
      const configRes = await fetch('/api/config');
      if (!configRes.ok) {
        setStatus('Admin panel is not available — the site is missing its Supabase configuration.', 'error');
        return;
      }
      const { supabaseUrl, supabaseAnonKey } = await configRes.json();
      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = '/login.html';
        return;
      }

      loadEtsyStatus(session.access_token);

      const res = await fetch('/api/admin/profiles', {
```

- [ ] **Step 4: Manually verify the connect flow**

1. Add real values for `ETSY_SELLER_SHOP_NAME` and `ETSY_PRODUCT_LISTING_ID` to your `.env` (leave `ETSY_OAUTH_REDIRECT_URI` as the default for local testing).
2. In your Etsy Developer app settings, add `http://localhost:3000/auth/etsy/callback` as a registered redirect URI (Etsy requires HTTPS for production redirect URIs, but allows plain HTTP for `localhost` during development — if your app rejects the local URI, register the production HTTPS URL instead and test the connect flow after deploying).
3. Run `node server.js`, log into `/admin.html` as an admin, confirm you see "Connect Etsy to enable automatic purchase verification".
4. Click it, authorize on Etsy's consent screen, confirm you land back on `/admin.html?etsy=connected` and the line now reads "Etsy connected (shop ID ...)".
5. In the Supabase Table Editor, confirm `etsy_seller_connection` now has exactly one row with `id = 1`.

- [ ] **Step 5: Commit**

```bash
git add server.js public/admin.html
git commit -m "Add Etsy OAuth connect flow and admin connection status"
```

---

### Task 6: Wire up self-serve purchase verification

**Files:**
- Modify: `server.js` (add `requireAuth` middleware and `/api/verify-purchase` route)
- Modify: `public/index.html` (replace the pending-approval screen with a receipt-entry form)

**Interfaces:**
- Consumes: `getValidEtsyToken` (Task 3), `evaluateReceipt` (Task 4), `ETSY_BASE`, `supabaseAdmin`, `ETSY_API_KEY`, `ETSY_PRODUCT_LISTING_ID` (all already in scope in `server.js`).
- Produces: `POST /api/verify-purchase`, consumed by the new form in `public/index.html`.

- [ ] **Step 1: Add the `requireAuth` middleware**

In `server.js`, find the end of `requireApproved`:

```js
  req.user = user;
  req.profile = profile;
  next();
}

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;
```

Replace with:

```js
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
```

- [ ] **Step 2: Add the import for `evaluateReceipt`**

Find the import added in Task 5:

```js
import {
  createPkcePair,
  writeEtsyOAuthState,
  readEtsyOAuthState,
  exchangeCodeForToken,
  getValidEtsyToken,
} from './lib/etsyOAuth.js';
```

Add right after it:

```js
import { evaluateReceipt } from './lib/verifyPurchase.js';
```

- [ ] **Step 3: Add the `/api/verify-purchase` route**

Find the `/api/etsy/status` route added in Task 5 (its closing `});`), and add the new route directly after it:

```js
app.post('/api/verify-purchase', requireAuth, async (req, res) => {
  const receiptId = String(req.body?.receiptId ?? '').trim();
  if (!/^\d+$/.test(receiptId)) {
    return res.status(400).json({ error: 'Enter a valid Etsy order number.' });
  }

  if (req.profile.role === 'admin' || req.profile.status === 'approved') {
    return res.json({ approved: true });
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
        headers: { 'x-api-key': ETSY_API_KEY, Authorization: `Bearer ${etsyToken.accessToken}` },
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
      })
      .eq('id', req.user.id);
    if (approveError) throw new Error(approveError.message);

    res.json({ approved: true });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Something went wrong checking your order — try again in a moment.' });
  }
});
```

- [ ] **Step 4: Replace the pending-approval screen in `public/index.html`**

Find:

```html
        if (profile?.role !== 'admin' && profile?.status !== 'approved') {
          document.body.innerHTML = `
            <div style="max-width:420px; margin:4rem auto; text-align:center; padding:0 1.5rem;
                        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
              <h1 style="margin-bottom:.5rem;">Almost there</h1>
              <p style="color:#6b6b6b;">Your account is awaiting approval. You'll be able to use the app once an admin approves it.</p>
              <p><a id="pending-logout" href="#" style="color:#d5641c;">Log out</a></p>
            </div>`;
          document.getElementById('pending-logout').addEventListener('click', async (e) => {
            e.preventDefault();
            await supabase.auth.signOut();
            window.location.href = '/login.html';
          });
        } else {
```

Replace with:

```html
        if (profile?.role !== 'admin' && profile?.status !== 'approved') {
          document.body.innerHTML = `
            <div style="max-width:420px; margin:4rem auto; text-align:center; padding:0 1.5rem;
                        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
              <h1 style="margin-bottom:.5rem;">Almost there</h1>
              <p style="color:#6b6b6b;">Enter your Etsy order number to verify your purchase and get instant access.</p>
              <form id="verify-purchase-form">
                <input id="receipt-id-input" type="text" inputmode="numeric" placeholder="e.g. 1234567890"
                       style="width:100%; padding:.65rem .8rem; margin-bottom:.75rem; border:1px solid #eee2d6; border-radius:8px; font-size:1rem; box-sizing:border-box;" required />
                <button id="verify-purchase-submit" type="submit"
                        style="width:100%; padding:.75rem; border:none; border-radius:8px; background:#d5641c; color:white; font-size:1rem; cursor:pointer;">
                  Verify Purchase
                </button>
              </form>
              <p id="verify-purchase-message" style="min-height:1.3rem; margin-top:1rem; font-size:.9rem; color:#b3261e;"></p>
              <p><a id="pending-logout" href="#" style="color:#d5641c;">Log out</a></p>
            </div>`;
          document.getElementById('pending-logout').addEventListener('click', async (e) => {
            e.preventDefault();
            await supabase.auth.signOut();
            window.location.href = '/login.html';
          });
          document.getElementById('verify-purchase-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = document.getElementById('verify-purchase-submit');
            const messageEl = document.getElementById('verify-purchase-message');
            const receiptId = document.getElementById('receipt-id-input').value.trim();
            submitBtn.disabled = true;
            messageEl.textContent = '';
            try {
              const verifyRes = await fetch('/api/verify-purchase', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                body: JSON.stringify({ receiptId }),
              });
              const verifyData = await verifyRes.json();
              if (!verifyRes.ok) {
                messageEl.textContent = verifyData.error || 'Something went wrong. Please try again.';
                submitBtn.disabled = false;
                return;
              }
              window.location.reload();
            } catch {
              messageEl.textContent = 'Something went wrong. Please try again.';
              submitBtn.disabled = false;
            }
          });
        } else {
```

- [ ] **Step 5: Manually verify end-to-end**

With a real (or real low-value test) Etsy order number for your LaunchNestAI listing:
1. Sign up a brand-new test account via `/login.html` (a fresh email you haven't used before).
2. Confirm you land on the "Almost there" screen with the order-number form.
3. Enter an order number that does **not** exist → confirm you see "We couldn't find that order number...".
4. Enter your real order number → confirm the page reloads and you now see the normal app (not the pending screen).
5. In the Supabase Table Editor, confirm that profile's `status` is `approved`, `etsy_receipt_id` matches what you entered, and `purchase_verified_at` is set.
6. Try entering that same order number again from a second test account → confirm you see "This order number has already been used to activate another account."
7. Confirm existing behavior is untouched: an admin can still manually Approve/Decline a pending account from `/admin.html`, and an already-approved account never sees the receipt form.

- [ ] **Step 6: Commit**

```bash
git add server.js public/index.html
git commit -m "Add self-serve Etsy purchase verification for account approval"
```
