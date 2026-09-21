# Made-to-Order Personalization Intake — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a made-to-order buyer's Etsy personalization answers into a new, queryable order record — reliably, safely, and visibly to the admin — with no AI, brief generation, or page generation involved, and with a guarantee that the app's existing self-serve signup flow can no longer mis-grant DIY account access on the now-converted listing.

**Architecture:** Reuses the existing Express + Supabase app's Etsy OAuth connection (`etsy_seller_connection`, already scoped `transactions_r`) and public-listing fetch (`etsyFetch`). Adds four new Supabase tables plus a settings/sync-state pair, a polling sync engine built as pure, dependency-injected functions (testable with `node --test` and no mocking library, matching the codebase's existing style), a restricted asset downloader, a config-driven personalization mapper, and a read-only admin screen. Automatic sync runs via Vercel Cron (confirmed Pro plan — every 10 minutes) plus a manual "Sync now" button; both call the same orchestrator.

**Tech Stack:** Node.js (ESM) + Express 4, Supabase (Postgres + Storage), plain `node:test` / `node:assert/strict` (no mocking framework — dependencies are injected as plain functions/objects, following the existing `lib/` pattern), Vercel (serverless functions + Cron Jobs).

**Spec:** `docs/superpowers/specs/2026-09-20-made-to-order-personalization-intake-design.md`

## Global Constraints

- No live Etsy scopes beyond the existing `transactions_r` — everything here reuses the current `etsy_seller_connection` token and the existing unauthenticated public-listing fetch (`etsyFetch`).
- No new npm dependencies. `fetch`, `node:dns/promises`, `node:crypto`, and the existing `@supabase/supabase-js` client cover everything needed.
- All new tables: RLS enabled, **no policies** (service-role only) — the exact pattern already used by `etsy_seller_connection` in `supabase/migrations/20260913000000_etsy_purchase_verification.sql`.
- All new admin routes are gated by the existing `requireAdmin` middleware, except the one Vercel-Cron-triggered route, which is gated by Vercel's standard `CRON_SECRET` convention instead (cron requests can't carry a user session).
- Personalization answers are `TransactionVariations` entries with `property_id === 54` (confirmed against Etsy's published OpenAPI schema — see Task 3). The existing `question_id`-based matching in `lib/verifyPurchase.js` is confirmed correct; `question_id` is a real, documented field on those entries, nullable except for personalization answers.
- Nothing in this stage is customer-facing. No AI calls, no page generation, no export, no Etsy delivery — those are later stages (see the spec's "Out of Scope" section).
- Every new pure function lives in `lib/` and gets a same-named `.test.js` file, following the existing convention (`lib/etsyOAuth.js` / `lib/etsyOAuth.test.js`, etc.) — no test framework beyond `node --test`.
- Money/price fields pulled from Etsy keep the API's raw `amount`/`divisor`/`currency_code` shape rather than being pre-divided, except where the existing codebase already establishes a different convention (e.g. `/api/landing-pages` already divides for display) — this stage only *stores* a snapshot, so raw amount/divisor/currency_code is kept as-is.

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260920000000_made_to_order_intake.sql`

**Interfaces:**
- Produces: tables `mto_settings`, `mto_orders`, `mto_personalization_answers`, `mto_assets`, `mto_sync_state`, `mto_sync_runs`, and Storage bucket `mto-assets` — column names below are relied on verbatim by every later task's Supabase calls.

- [ ] **Step 1: Write the migration**

```sql
-- Singleton settings row: the on/off switch and cutover timestamp for
-- made-to-order intake. Same pattern as etsy_seller_connection -- a data
-- change, not a deploy, turns this on.
create table public.mto_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  cutover_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.mto_settings (id) values (1);
alter table public.mto_settings enable row level security;
-- No policies: service-role only, same as etsy_seller_connection.

-- One row per purchased line item (an Etsy transaction), not per receipt --
-- a receipt can bundle several purchases.
create table public.mto_orders (
  id uuid primary key default gen_random_uuid(),
  shop_id bigint not null,
  receipt_id bigint not null,
  transaction_id bigint not null,
  listing_id bigint not null,
  quantity integer not null,
  buyer_etsy_user_id bigint,
  buyer_display_name text,
  receipt_created_at timestamptz not null,
  payment_state text not null check (payment_state in ('paid', 'canceled', 'refunded', 'pending')),
  fulfillment_status text not null default 'imported',
  needs_attention boolean not null default false,
  attention_reason text check (
    attention_reason is null or attention_reason in (
      'missing_information', 'unmapped_personalization', 'asset_unavailable',
      'product_unclear', 'multiple_units'
    )
  ),
  resolved_listing_id bigint,
  resolved_listing_snapshot jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, transaction_id)
);
create index mto_orders_needs_attention_idx on public.mto_orders (needs_attention) where needs_attention;
alter table public.mto_orders enable row level security;

create table public.mto_personalization_answers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.mto_orders (id) on delete cascade,
  question_id text,
  formatted_name text,
  formatted_value text not null,
  mapped_field text not null default 'unmapped' check (
    mapped_field in ('product_url', 'target_customer', 'messaging', 'traffic_source', 'assets', 'unmapped')
  ),
  mapping_version integer not null,
  created_at timestamptz not null default now()
);
alter table public.mto_personalization_answers enable row level security;

create table public.mto_assets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.mto_orders (id) on delete cascade,
  source_url text not null,
  storage_key text,
  content_type text,
  byte_size integer,
  status text not null default 'pending' check (status in ('pending', 'downloaded', 'failed')),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mto_assets enable row level security;

-- Singleton sync cursor + advisory lock (prevents the manual "Sync now"
-- button and the scheduled cron run from ever overlapping).
create table public.mto_sync_state (
  id integer primary key default 1 check (id = 1),
  cursor_min_created timestamptz,
  running_since timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.mto_sync_state (id) values (1);
alter table public.mto_sync_state enable row level security;

create table public.mto_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null check (trigger in ('manual', 'cron')),
  receipts_seen integer not null default 0,
  orders_created integer not null default 0,
  orders_updated integer not null default 0,
  error text
);
alter table public.mto_sync_runs enable row level security;

-- Private bucket for buyer-uploaded assets (photos/brand files). Never
-- public; the admin UI gets short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('mto-assets', 'mto-assets', false)
on conflict (id) do nothing;
```

- [ ] **Step 2: Apply the migration**

Run the SQL above against your Supabase project: open the Supabase Dashboard → SQL Editor → paste the full contents of the new file → **Run**. (Or, if you have the Supabase CLI linked to this project: `supabase db push`.)

- [ ] **Step 3: Verify**

In the Supabase Dashboard → Table Editor, confirm all six new tables appear (with one row each already in `mto_settings` and `mto_sync_state`), and Storage → confirm a **private** `mto-assets` bucket exists.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260920000000_made_to_order_intake.sql
git commit -m "Add made-to-order intake tables and private asset bucket"
```

---

### Task 2: Personalization Field Mapping (`lib/mtoFieldMapping.js`)

**Files:**
- Create: `lib/mtoFieldMapping.js`
- Test: `lib/mtoFieldMapping.test.js`

**Interfaces:**
- Produces: `MAPPING_VERSION` (number), `QUESTION_ID_MAP` (object, question_id string → field name), `mapAnswer({ questionId, formattedName }, { questionIdMap } = {})` → one of `'product_url' | 'target_customer' | 'messaging' | 'traffic_source' | 'assets' | 'unmapped'`.

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapAnswer, MAPPING_VERSION } from './mtoFieldMapping.js';

test('MAPPING_VERSION is a stable integer', () => {
  assert.equal(MAPPING_VERSION, 1);
});

test('matches by configured question_id first, ignoring the label', () => {
  const field = mapAnswer(
    { questionId: 999, formattedName: 'Some unrelated label' },
    { questionIdMap: { '999': 'target_customer' } },
  );
  assert.equal(field, 'target_customer');
});

test('falls back to label matching when question_id is not in the map', () => {
  assert.equal(mapAnswer({ questionId: 111, formattedName: 'Who usually buys this product?' }), 'target_customer');
  assert.equal(mapAnswer({ questionId: 111, formattedName: 'What should shoppers understand first?' }), 'messaging');
  assert.equal(mapAnswer({ questionId: 111, formattedName: 'Where will you share this page?' }), 'traffic_source');
  assert.equal(mapAnswer({ questionId: 111, formattedName: 'Which Etsy product should this page promote?' }), 'product_url');
  assert.equal(mapAnswer({ questionId: 111, formattedName: 'Upload your product photos and brand assets' }), 'assets');
});

test('label matching is case-insensitive', () => {
  assert.equal(mapAnswer({ questionId: null, formattedName: 'WHO USUALLY BUYS THIS PRODUCT?' }), 'target_customer');
});

test('returns unmapped when neither question_id nor label matches anything known', () => {
  assert.equal(mapAnswer({ questionId: 42, formattedName: 'Gift wrap color?' }), 'unmapped');
});

test('returns unmapped when formattedName is missing entirely', () => {
  assert.equal(mapAnswer({ questionId: null, formattedName: undefined }), 'unmapped');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/mtoFieldMapping.test.js`
Expected: FAIL — `mtoFieldMapping.js` doesn't exist yet.

- [ ] **Step 3: Implement**

```js
// Matches a buyer's personalization answer to one of LaunchNestAI's 5 known
// made-to-order questions. question_id (Etsy's stable ID for a listing's
// personalization question) is authoritative and checked first;
// formatted_name (the seller-configured label shown to the buyer) is a
// fallback for questions not yet added to QUESTION_ID_MAP below.
export const MAPPING_VERSION = 1;

// Etsy's personalization question_id for each of the 5 fields, once known.
// Empty until the real listing's question IDs are recorded here (Kim: fill
// these in as each question goes live on the listing) -- until then, every
// answer falls through to the label match below.
export const QUESTION_ID_MAP = {};

const LABEL_FALLBACK = [
  { field: 'product_url', pattern: /which .*product.* (should|does) this .*promote/i },
  { field: 'target_customer', pattern: /who (usually )?buys/i },
  { field: 'messaging', pattern: /what should shoppers understand/i },
  { field: 'traffic_source', pattern: /where will you share/i },
  { field: 'assets', pattern: /upload your (product photos|brand assets)/i },
];

export function mapAnswer({ questionId, formattedName }, { questionIdMap = QUESTION_ID_MAP } = {}) {
  if (questionId != null && questionIdMap[String(questionId)]) {
    return questionIdMap[String(questionId)];
  }
  const label = formattedName ?? '';
  const match = LABEL_FALLBACK.find(({ pattern }) => pattern.test(label));
  return match ? match.field : 'unmapped';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/mtoFieldMapping.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/mtoFieldMapping.js lib/mtoFieldMapping.test.js
git commit -m "Add config-driven personalization field mapping"
```

---

### Task 3: Pure Order Derivation (`lib/mtoOrders.js`)

**Files:**
- Create: `lib/mtoOrders.js`
- Test: `lib/mtoOrders.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure, standalone).
- Produces:
  - `derivePaymentState(receipt)` → `'paid' | 'canceled' | 'refunded' | 'pending'`
  - `isReceiptBeforeCutover(receipt, cutoverAt)` → boolean
  - `extractPersonalizationAnswers(transaction)` → `Array<{ questionId: number|null, formattedName: string|null, formattedValue: string }>`
  - `deriveOrderFromTransaction({ receipt, transaction, listingId, shopId })` → order-fields object (no `needsAttention`/`attentionReason`/`resolvedListing*` — those are computed later, once personalization + product resolution are known) or `null` if the transaction isn't for `listingId` or the receipt was never paid
  - `deriveAttentionReason({ quantity, mappedAnswers, productUnclear, anyAssetFailed })` → one of the 5 reason strings from the migration's check constraint, or `null`
  - `parseEtsyProductUrl(rawValue)` → `{ listingId: string }` or `null`

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  derivePaymentState,
  isReceiptBeforeCutover,
  extractPersonalizationAnswers,
  deriveOrderFromTransaction,
  deriveAttentionReason,
  parseEtsyProductUrl,
} from './mtoOrders.js';

// --- derivePaymentState ---

test('derivePaymentState: canceled status wins even if is_paid is true', () => {
  assert.equal(derivePaymentState({ status: 'canceled', is_paid: true }), 'canceled');
});

test('derivePaymentState: fully refunded status wins even if is_paid is true', () => {
  assert.equal(derivePaymentState({ status: 'fully refunded', is_paid: true }), 'refunded');
});

test('derivePaymentState: partially refunded with is_paid true counts as paid', () => {
  assert.equal(derivePaymentState({ status: 'partially refunded', is_paid: true }), 'paid');
});

test('derivePaymentState: paid status, is_paid true, counts as paid', () => {
  assert.equal(derivePaymentState({ status: 'paid', is_paid: true }), 'paid');
});

test('derivePaymentState: not yet paid counts as pending', () => {
  assert.equal(derivePaymentState({ status: 'open', is_paid: false }), 'pending');
});

// --- isReceiptBeforeCutover ---

test('isReceiptBeforeCutover: true when the receipt predates the cutover', () => {
  const receipt = { create_timestamp: Date.parse('2026-09-01T00:00:00Z') / 1000 };
  assert.equal(isReceiptBeforeCutover(receipt, '2026-09-15T00:00:00Z'), true);
});

test('isReceiptBeforeCutover: false when the receipt is at or after the cutover', () => {
  const receipt = { create_timestamp: Date.parse('2026-09-15T00:00:00Z') / 1000 };
  assert.equal(isReceiptBeforeCutover(receipt, '2026-09-15T00:00:00Z'), false);
});

// --- extractPersonalizationAnswers ---

test('extractPersonalizationAnswers: filters to property_id 54 only', () => {
  const transaction = {
    variations: [
      { property_id: 200, value_id: 1, formatted_name: 'Color', formatted_value: 'Blue' },
      { property_id: 54, value_id: null, question_id: 111, formatted_name: 'Who buys this?', formatted_value: 'Gift shoppers' },
    ],
  };
  assert.deepEqual(extractPersonalizationAnswers(transaction), [
    { questionId: 111, formattedName: 'Who buys this?', formattedValue: 'Gift shoppers' },
  ]);
});

test('extractPersonalizationAnswers: returns an empty array when there are no variations', () => {
  assert.deepEqual(extractPersonalizationAnswers({}), []);
});

test('extractPersonalizationAnswers: handles a null question_id (regular variation shape)', () => {
  const transaction = { variations: [{ property_id: 54, question_id: null, formatted_name: 'Note', formatted_value: 'Hi' }] };
  assert.deepEqual(extractPersonalizationAnswers(transaction), [{ questionId: null, formattedName: 'Note', formattedValue: 'Hi' }]);
});

// --- deriveOrderFromTransaction ---

const paidReceipt = {
  receipt_id: 555,
  buyer_user_id: 777,
  name: 'Jamie Buyer',
  is_paid: true,
  status: 'paid',
  create_timestamp: Date.parse('2026-09-16T12:00:00Z') / 1000,
};

test('deriveOrderFromTransaction: returns null for a transaction on a different listing', () => {
  const transaction = { transaction_id: 1, listing_id: 999, quantity: 1 };
  assert.equal(deriveOrderFromTransaction({ receipt: paidReceipt, transaction, listingId: 222, shopId: 1 }), null);
});

test('deriveOrderFromTransaction: returns null when the receipt was never paid', () => {
  const transaction = { transaction_id: 1, listing_id: 222, quantity: 1 };
  const receipt = { ...paidReceipt, is_paid: false, status: 'open' };
  assert.equal(deriveOrderFromTransaction({ receipt, transaction, listingId: 222, shopId: 1 }), null);
});

test('deriveOrderFromTransaction: builds the full order-fields object for a matching, paid transaction', () => {
  const transaction = { transaction_id: 1, listing_id: 222, quantity: 1 };
  const order = deriveOrderFromTransaction({ receipt: paidReceipt, transaction, listingId: 222, shopId: 42 });
  assert.deepEqual(order, {
    shopId: 42,
    receiptId: 555,
    transactionId: 1,
    listingId: 222,
    quantity: 1,
    buyerEtsyUserId: 777,
    buyerDisplayName: 'Jamie Buyer',
    receiptCreatedAt: new Date(paidReceipt.create_timestamp * 1000).toISOString(),
    paymentState: 'paid',
  });
});

test('deriveOrderFromTransaction: defaults quantity to 1 when Etsy omits it', () => {
  const transaction = { transaction_id: 1, listing_id: 222 };
  const order = deriveOrderFromTransaction({ receipt: paidReceipt, transaction, listingId: 222, shopId: 1 });
  assert.equal(order.quantity, 1);
});

// --- deriveAttentionReason ---

test('deriveAttentionReason: multiple units takes priority over everything else', () => {
  const reason = deriveAttentionReason({
    quantity: 2,
    mappedAnswers: [{ mappedField: 'product_url' }],
    productUnclear: true,
    anyAssetFailed: true,
  });
  assert.equal(reason, 'multiple_units');
});

test('deriveAttentionReason: missing product_url answer entirely', () => {
  const reason = deriveAttentionReason({ quantity: 1, mappedAnswers: [{ mappedField: 'target_customer' }], productUnclear: false, anyAssetFailed: false });
  assert.equal(reason, 'missing_information');
});

test('deriveAttentionReason: product link present but unresolvable', () => {
  const reason = deriveAttentionReason({ quantity: 1, mappedAnswers: [{ mappedField: 'product_url' }], productUnclear: true, anyAssetFailed: false });
  assert.equal(reason, 'product_unclear');
});

test('deriveAttentionReason: asset download failure', () => {
  const reason = deriveAttentionReason({ quantity: 1, mappedAnswers: [{ mappedField: 'product_url' }], productUnclear: false, anyAssetFailed: true });
  assert.equal(reason, 'asset_unavailable');
});

test('deriveAttentionReason: an unmapped answer, nothing else wrong', () => {
  const reason = deriveAttentionReason({
    quantity: 1,
    mappedAnswers: [{ mappedField: 'product_url' }, { mappedField: 'unmapped' }],
    productUnclear: false,
    anyAssetFailed: false,
  });
  assert.equal(reason, 'unmapped_personalization');
});

test('deriveAttentionReason: nothing wrong returns null', () => {
  const reason = deriveAttentionReason({
    quantity: 1,
    mappedAnswers: [{ mappedField: 'product_url' }, { mappedField: 'target_customer' }],
    productUnclear: false,
    anyAssetFailed: false,
  });
  assert.equal(reason, null);
});

// --- parseEtsyProductUrl ---

test('parseEtsyProductUrl: accepts a real Etsy listing URL', () => {
  assert.deepEqual(parseEtsyProductUrl('https://www.etsy.com/listing/123456789/some-product-name'), { listingId: '123456789' });
});

test('parseEtsyProductUrl: accepts the bare etsy.com host without www', () => {
  assert.deepEqual(parseEtsyProductUrl('https://etsy.com/listing/42/x'), { listingId: '42' });
});

test('parseEtsyProductUrl: rejects a non-Etsy host', () => {
  assert.equal(parseEtsyProductUrl('https://not-etsy.com/listing/123456789/x'), null);
});

test('parseEtsyProductUrl: rejects http (non-https)', () => {
  assert.equal(parseEtsyProductUrl('http://www.etsy.com/listing/123456789/x'), null);
});

test('parseEtsyProductUrl: rejects a URL with no listing ID in the path', () => {
  assert.equal(parseEtsyProductUrl('https://www.etsy.com/shop/SomeShop'), null);
});

test('parseEtsyProductUrl: rejects garbage input without throwing', () => {
  assert.equal(parseEtsyProductUrl('not a url at all'), null);
  assert.equal(parseEtsyProductUrl(''), null);
  assert.equal(parseEtsyProductUrl(undefined), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/mtoOrders.test.js`
Expected: FAIL — `mtoOrders.js` doesn't exist yet.

- [ ] **Step 3: Implement**

```js
// Pure functions that turn a raw Etsy receipt + one of its transactions
// into the fields made-to-order intake stores, with no network or database
// access -- keeps every decision here fully unit-testable, the same way
// verifyPurchase.js's evaluateReceipt() stays separate from the fetch that
// gets a receipt in the first place.

export function derivePaymentState(receipt) {
  if (receipt.status === 'canceled') return 'canceled';
  if (receipt.status === 'fully refunded') return 'refunded';
  if (receipt.is_paid) return 'paid';
  return 'pending';
}

export function isReceiptBeforeCutover(receipt, cutoverAt) {
  return receipt.create_timestamp * 1000 < new Date(cutoverAt).getTime();
}

// Personalization answers are TransactionVariations entries with
// property_id 54 (confirmed against Etsy's published OpenAPI schema) --
// other entries in the same array are ordinary product variations (size,
// color) that were never typed by the buyer as a personalization answer.
export function extractPersonalizationAnswers(transaction) {
  return (transaction.variations || [])
    .filter(v => v.property_id === 54)
    .map(v => ({
      questionId: v.question_id ?? null,
      formattedName: v.formatted_name ?? null,
      formattedValue: v.formatted_value,
    }));
}

// Returns null when the transaction isn't for the watched listing, or the
// receipt has never been paid (nothing to import yet). Deliberately omits
// needsAttention/attentionReason/resolvedListing* -- those depend on the
// personalization answers and product-link resolution, computed by the
// caller (lib/etsySync.js) once both are known.
export function deriveOrderFromTransaction({ receipt, transaction, listingId, shopId }) {
  if (String(transaction.listing_id) !== String(listingId)) return null;
  if (!receipt.is_paid) return null;

  return {
    shopId,
    receiptId: receipt.receipt_id,
    transactionId: transaction.transaction_id,
    listingId: transaction.listing_id,
    quantity: transaction.quantity ?? 1,
    buyerEtsyUserId: receipt.buyer_user_id ?? null,
    // Etsy's shipping-recipient name, not an account username -- the
    // closest thing to a buyer display name this scope of API access
    // exposes.
    buyerDisplayName: receipt.name ?? null,
    receiptCreatedAt: new Date(receipt.create_timestamp * 1000).toISOString(),
    paymentState: derivePaymentState(receipt),
  };
}

// Priority order matters: a multi-unit purchase is flagged regardless of
// what else is true about it, since the spec explicitly requires never
// silently ignoring quantity > 1.
export function deriveAttentionReason({ quantity, mappedAnswers, productUnclear, anyAssetFailed }) {
  if (quantity > 1) return 'multiple_units';
  const hasProductUrl = mappedAnswers.some(a => a.mappedField === 'product_url');
  if (!hasProductUrl) return 'missing_information';
  if (productUnclear) return 'product_unclear';
  if (anyAssetFailed) return 'asset_unavailable';
  if (mappedAnswers.some(a => a.mappedField === 'unmapped')) return 'unmapped_personalization';
  return null;
}

export function parseEtsyProductUrl(rawValue) {
  if (!rawValue) return null;
  let url;
  try {
    url = new URL(rawValue.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!/^(www\.)?etsy\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/\/listing\/(\d+)/);
  if (!match) return null;
  return { listingId: match[1] };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/mtoOrders.test.js`
Expected: PASS (24 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/mtoOrders.js lib/mtoOrders.test.js
git commit -m "Add pure order/attention derivation for made-to-order intake"
```

---

### Task 4: Restricted Asset Importer (`lib/assetImporter.js`)

**Files:**
- Create: `lib/assetImporter.js`
- Test: `lib/assetImporter.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `isBlockedIpAddress(ip)` → boolean
  - `isAllowedContentType(contentType)` → boolean
  - `importAsset(url, { fetchImpl, resolveIp, maxBytes, maxRedirects } = {})` → `Promise<{ ok: true, buffer: Buffer, contentType: string, byteSize: number } | { ok: false, failureReason: string }>`

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIpAddress, isAllowedContentType, importAsset } from './assetImporter.js';

// --- isBlockedIpAddress ---

test('isBlockedIpAddress: blocks common private/loopback IPv4 ranges', () => {
  assert.equal(isBlockedIpAddress('127.0.0.1'), true);
  assert.equal(isBlockedIpAddress('10.1.2.3'), true);
  assert.equal(isBlockedIpAddress('172.16.5.1'), true);
  assert.equal(isBlockedIpAddress('192.168.1.1'), true);
  assert.equal(isBlockedIpAddress('169.254.1.1'), true);
});

test('isBlockedIpAddress: allows an ordinary public IPv4 address', () => {
  assert.equal(isBlockedIpAddress('93.184.216.34'), false);
});

test('isBlockedIpAddress: blocks IPv6 loopback and link-local', () => {
  assert.equal(isBlockedIpAddress('::1'), true);
  assert.equal(isBlockedIpAddress('fe80::1'), true);
});

test('isBlockedIpAddress: blocks an IPv4-mapped IPv6 private address', () => {
  assert.equal(isBlockedIpAddress('::ffff:10.0.0.5'), true);
});

// --- isAllowedContentType ---

test('isAllowedContentType: allows the supported image types', () => {
  assert.equal(isAllowedContentType('image/jpeg'), true);
  assert.equal(isAllowedContentType('image/png'), true);
  assert.equal(isAllowedContentType('image/webp'), true);
  assert.equal(isAllowedContentType('image/gif'), true);
});

test('isAllowedContentType: ignores a charset suffix', () => {
  assert.equal(isAllowedContentType('image/png; charset=binary'), true);
});

test('isAllowedContentType: rejects SVG explicitly (active content risk)', () => {
  assert.equal(isAllowedContentType('image/svg+xml'), false);
});

test('isAllowedContentType: rejects non-image types and missing values', () => {
  assert.equal(isAllowedContentType('text/html'), false);
  assert.equal(isAllowedContentType(null), false);
  assert.equal(isAllowedContentType(undefined), false);
});

// --- importAsset ---

function fakeResponse({ status = 200, headers = {}, body = 'x' } = {}) {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headerMap.get(name.toLowerCase()) ?? null },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

test('importAsset: rejects a non-https URL', async () => {
  const result = await importAsset('http://example.com/photo.jpg');
  assert.deepEqual(result, { ok: false, failureReason: 'disallowed_scheme' });
});

test('importAsset: rejects when the host resolves to a blocked IP', async () => {
  const result = await importAsset('https://internal.example.com/photo.jpg', {
    resolveIp: async () => '10.0.0.5',
    fetchImpl: async () => { throw new Error('should not be called'); },
  });
  assert.deepEqual(result, { ok: false, failureReason: 'blocked_host' });
});

test('importAsset: rejects a disallowed content type', async () => {
  const result = await importAsset('https://cdn.example.com/file.html', {
    resolveIp: async () => '93.184.216.34',
    fetchImpl: async () => fakeResponse({ headers: { 'content-type': 'text/html' } }),
  });
  assert.deepEqual(result, { ok: false, failureReason: 'disallowed_content_type' });
});

test('importAsset: rejects a response over the byte cap via Content-Length', async () => {
  const result = await importAsset('https://cdn.example.com/huge.png', {
    resolveIp: async () => '93.184.216.34',
    fetchImpl: async () => fakeResponse({ headers: { 'content-type': 'image/png', 'content-length': '999999999' } }),
    maxBytes: 1000,
  });
  assert.deepEqual(result, { ok: false, failureReason: 'too_large' });
});

test('importAsset: follows a redirect within the cap and re-validates the new host', async () => {
  let call = 0;
  const result = await importAsset('https://cdn.example.com/redirect.png', {
    resolveIp: async () => '93.184.216.34',
    fetchImpl: async () => {
      call += 1;
      if (call === 1) return fakeResponse({ status: 302, headers: { location: 'https://cdn2.example.com/final.png' } });
      return fakeResponse({ headers: { 'content-type': 'image/png' }, body: 'imagebytes' });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.contentType, 'image/png');
  assert.equal(call, 2);
});

test('importAsset: fails after exceeding the redirect cap', async () => {
  const result = await importAsset('https://cdn.example.com/loop.png', {
    resolveIp: async () => '93.184.216.34',
    fetchImpl: async () => fakeResponse({ status: 302, headers: { location: 'https://cdn.example.com/loop.png' } }),
    maxRedirects: 2,
  });
  assert.deepEqual(result, { ok: false, failureReason: 'too_many_redirects' });
});

test('importAsset: succeeds for a valid small image', async () => {
  const result = await importAsset('https://cdn.example.com/photo.jpg', {
    resolveIp: async () => '93.184.216.34',
    fetchImpl: async () => fakeResponse({ headers: { 'content-type': 'image/jpeg' }, body: 'jpegbytes' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.contentType, 'image/jpeg');
  assert.equal(result.byteSize, Buffer.byteLength('jpegbytes'));
  assert.ok(Buffer.isBuffer(result.buffer));
});

test('importAsset: rejects an unparseable URL without throwing', async () => {
  const result = await importAsset('not a url');
  assert.deepEqual(result, { ok: false, failureReason: 'invalid_url' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/assetImporter.test.js`
Expected: FAIL — `assetImporter.js` doesn't exist yet.

- [ ] **Step 3: Implement**

```js
import { Resolver } from 'node:dns/promises';

const IPV4_BLOCKED_RANGES = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isBlockedIpv4(ip) {
  const value = ipv4ToInt(ip);
  return IPV4_BLOCKED_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

function isBlockedIpv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local, fc00::/7
  if (normalized.startsWith('::ffff:')) return isBlockedIpv4(normalized.slice('::ffff:'.length));
  return false;
}

// Basic SSRF guard: blocks the common private/loopback/link-local ranges.
// Not an exhaustive IANA reservation list -- sufficient for "don't let a
// buyer-supplied URL reach this server's internal network," which is the
// actual risk here.
export function isBlockedIpAddress(ip) {
  return ip.includes(':') ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function isAllowedContentType(contentType) {
  if (!contentType) return false;
  const base = contentType.split(';')[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.has(base);
}

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function defaultResolveIp(hostname) {
  const resolver = new Resolver();
  try {
    const addresses = await resolver.resolve4(hostname);
    return addresses[0] ?? null;
  } catch {
    try {
      const addresses = await resolver.resolve6(hostname);
      return addresses[0] ?? null;
    } catch {
      return null;
    }
  }
}

// Downloads a buyer-supplied URL (an Etsy personalization file-upload
// answer) only after validating scheme, resolved IP, content type, and
// size -- re-checked on every redirect hop, since a first hop passing
// validation says nothing about where a redirect sends the request next.
export async function importAsset(url, { fetchImpl = fetch, resolveIp = defaultResolveIp, maxBytes = MAX_BYTES, maxRedirects = MAX_REDIRECTS } = {}) {
  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, failureReason: 'invalid_url' };
    }
    if (parsed.protocol !== 'https:') {
      return { ok: false, failureReason: 'disallowed_scheme' };
    }

    const ip = await resolveIp(parsed.hostname);
    if (!ip || isBlockedIpAddress(ip)) {
      return { ok: false, failureReason: 'blocked_host' };
    }

    const res = await fetchImpl(currentUrl, { redirect: 'manual' });

    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get('location');
      if (!location || hop === maxRedirects) {
        return { ok: false, failureReason: 'too_many_redirects' };
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!res.ok) {
      return { ok: false, failureReason: `http_${res.status}` };
    }

    const contentType = res.headers.get('content-type');
    if (!isAllowedContentType(contentType)) {
      return { ok: false, failureReason: 'disallowed_content_type' };
    }

    const contentLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return { ok: false, failureReason: 'too_large' };
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      return { ok: false, failureReason: 'too_large' };
    }

    return { ok: true, buffer, contentType: contentType.split(';')[0].trim().toLowerCase(), byteSize: buffer.byteLength };
  }

  return { ok: false, failureReason: 'too_many_redirects' };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/assetImporter.test.js`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/assetImporter.js lib/assetImporter.test.js
git commit -m "Add restricted asset importer with SSRF and content-type guards"
```

---

### Task 5: Cutover Guard on the Existing Self-Serve Flow

**Files:**
- Modify: `lib/verifyPurchase.js`
- Modify: `lib/verifyPurchase.test.js` (append; do not change existing tests)

**Interfaces:**
- Consumes: nothing from earlier tasks (kept a standalone, leaf module on purpose, to minimize risk to this already-tested file).
- Produces: `evaluateReceipt({ receipt, listingId, claimedByOtherUser, shopNameQuestionId, madeToOrderEnabled = false, cutoverAt = null })` — same return shape as before, with one new rejection case. Both new parameters default to "guard off," so every existing call and test is unaffected.

- [ ] **Step 1: Write the failing tests (append to the existing file)**

```js
test('rejects a receipt created on/after the cutover when made-to-order is enabled', () => {
  const receipt = { ...paidReceiptWithListing, create_timestamp: Date.parse('2026-09-20T00:00:00Z') / 1000 };
  const result = evaluateReceipt({
    receipt,
    listingId: 222,
    claimedByOtherUser: false,
    madeToOrderEnabled: true,
    cutoverAt: '2026-09-15T00:00:00Z',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.match(result.message, /custom-made/i);
});

test('allows a receipt created before the cutover through even when made-to-order is enabled', () => {
  const receipt = { ...paidReceiptWithListing, create_timestamp: Date.parse('2026-09-01T00:00:00Z') / 1000 };
  const result = evaluateReceipt({
    receipt,
    listingId: 222,
    claimedByOtherUser: false,
    madeToOrderEnabled: true,
    cutoverAt: '2026-09-15T00:00:00Z',
  });
  assert.equal(result.ok, true);
});

test('does not apply the cutover guard when made-to-order is disabled', () => {
  const receipt = { ...paidReceiptWithListing, create_timestamp: Date.parse('2026-09-20T00:00:00Z') / 1000 };
  const result = evaluateReceipt({
    receipt,
    listingId: 222,
    claimedByOtherUser: false,
    madeToOrderEnabled: false,
    cutoverAt: '2026-09-15T00:00:00Z',
  });
  assert.equal(result.ok, true);
});

test('does not apply the cutover guard when no cutoverAt is configured', () => {
  const receipt = { ...paidReceiptWithListing, create_timestamp: Date.parse('2026-09-20T00:00:00Z') / 1000 };
  const result = evaluateReceipt({ receipt, listingId: 222, claimedByOtherUser: false, madeToOrderEnabled: true, cutoverAt: null });
  assert.equal(result.ok, true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/verifyPurchase.test.js`
Expected: FAIL — the 4 new tests fail (no cutover guard exists yet); all pre-existing tests still pass.

- [ ] **Step 3: Implement**

In `lib/verifyPurchase.js`, change the `evaluateReceipt` signature and insert the new check right after the existing "right listing?" check (`hasListing`) and before the final `return { ok: true, ... }`:

```js
export function evaluateReceipt({ receipt, listingId, claimedByOtherUser, shopNameQuestionId, madeToOrderEnabled = false, cutoverAt = null }) {
  // ...unchanged checks above (claimedByOtherUser, receipt existence, is_paid,
  // status, hasListing) stay exactly as they are...

  if (madeToOrderEnabled && cutoverAt && receipt.create_timestamp != null && receipt.create_timestamp * 1000 >= new Date(cutoverAt).getTime()) {
    return {
      ok: false,
      status: 422,
      message: 'This order is being custom-made for you — check your Etsy messages for updates, or contact support if you have questions.',
    };
  }

  return {
    ok: true,
    shopName: extractShopNameFromReceipt(receipt, listingId, shopNameQuestionId),
    buyerUserId: receipt.buyer_user_id ?? null,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/verifyPurchase.test.js`
Expected: PASS (all pre-existing tests + 4 new ones)

- [ ] **Step 5: Commit**

```bash
git add lib/verifyPurchase.js lib/verifyPurchase.test.js
git commit -m "Add made-to-order cutover guard to purchase verification"
```

---

### Task 6: Sync Orchestrator — New-Order Pass (`lib/etsySync.js`)

**Files:**
- Create: `lib/etsySync.js`
- Create: `lib/mtoTestFakes.js` (shared in-memory test double, reused by Task 7)
- Test: `lib/etsySync.test.js`

**Interfaces:**
- Consumes: `deriveOrderFromTransaction`, `extractPersonalizationAnswers`, `deriveAttentionReason`, `parseEtsyProductUrl`, `isReceiptBeforeCutover` from `lib/mtoOrders.js` (Task 3); `mapAnswer`, `MAPPING_VERSION` from `lib/mtoFieldMapping.js` (Task 2).
- Produces: `syncMadeToOrderReceipts({ listReceipts, resolveListing, importAndStoreAsset, store, listingId, shopId, cutoverAt, trigger, now = () => new Date() })` → `Promise<{ skipped: true, reason: string } | { skipped: false, receiptsSeen: number, ordersCreated: number, ordersUpdated: number }>`. Relies on an injected `store` implementing:
  - `getSyncState()` → `Promise<{ cursorMinCreated: string|null, runningSince: string|null }>`
  - `acquireLock(nowIso: string)` → `Promise<void>`
  - `releaseLock()` → `Promise<void>`
  - `getOrderByTransactionId(transactionId)` → `Promise<{ id: string, paymentState: string } | null>`
  - `upsertOrder(orderFields)` → `Promise<{ id: string }>` — `orderFields` is the object from `deriveOrderFromTransaction` plus `needsAttention`, `attentionReason`, `resolvedListingId`, `resolvedListingSnapshot`
  - `insertAnswers(orderId, mappedAnswers)` → `Promise<void>`
  - `insertAsset(orderId, asset)` → `Promise<void>` — `asset` is `{ sourceUrl, status, storageKey?, contentType?, byteSize?, failureReason? }`
  - `updatePaymentState(orderId, paymentState)` → `Promise<void>`
  - `saveCursor(isoString)` → `Promise<void>`
  - `recordSyncRun(summary)` → `Promise<void>`
  and an injected `listReceipts({ minCreated?, minLastModified?, maxLastModified?, limit, offset })` → `Promise<{ receipts: Array<RawEtsyReceipt> }>`, `resolveListing(listingId)` → `Promise<{ title, price, currency, state } | null>`, `importAndStoreAsset(transactionId, sourceUrl)` → `Promise<{ status: 'downloaded', storageKey, contentType, byteSize } | { status: 'failed', failureReason }>`.
  This task implements only the **new-order pass** (pagination + import); Task 7 adds the reconciliation pass, the advisory lock, and cursor persistence on top of the same file.

- [ ] **Step 1: Write the shared in-memory test double**

```js
// lib/mtoTestFakes.js
// A tiny in-memory stand-in for the real Supabase-backed store, used by
// lib/etsySync.test.js -- avoids needing a mocking library, matching the
// rest of this codebase's dependency-injection style (see getValidEtsyToken
// in lib/etsyOAuth.js, which takes supabaseAdmin as a plain parameter).
export function createFakeStore({ cursorMinCreated = null } = {}) {
  const ordersByTransactionId = new Map();
  const answersByOrderId = new Map();
  const assetsByOrderId = new Map();
  const syncRuns = [];
  let syncState = { cursorMinCreated, runningSince: null };
  let nextId = 1;

  return {
    _ordersByTransactionId: ordersByTransactionId,
    _answersByOrderId: answersByOrderId,
    _assetsByOrderId: assetsByOrderId,
    _syncRuns: syncRuns,

    async getSyncState() {
      return { ...syncState };
    },
    async acquireLock(nowIso) {
      syncState = { ...syncState, runningSince: nowIso };
    },
    async releaseLock() {
      syncState = { ...syncState, runningSince: null };
    },
    async getOrderByTransactionId(transactionId) {
      const order = ordersByTransactionId.get(String(transactionId));
      return order ? { id: order.id, paymentState: order.paymentState } : null;
    },
    async upsertOrder(orderFields) {
      const existing = ordersByTransactionId.get(String(orderFields.transactionId));
      const id = existing?.id ?? String(nextId++);
      ordersByTransactionId.set(String(orderFields.transactionId), { id, ...orderFields });
      return { id };
    },
    async insertAnswers(orderId, answers) {
      answersByOrderId.set(orderId, [...(answersByOrderId.get(orderId) ?? []), ...answers]);
    },
    async insertAsset(orderId, asset) {
      assetsByOrderId.set(orderId, [...(assetsByOrderId.get(orderId) ?? []), asset]);
    },
    async updatePaymentState(orderId, paymentState) {
      for (const order of ordersByTransactionId.values()) {
        if (order.id === orderId) order.paymentState = paymentState;
      }
    },
    async saveCursor(isoString) {
      syncState = { ...syncState, cursorMinCreated: isoString };
    },
    async recordSyncRun(summary) {
      syncRuns.push(summary);
    },
  };
}

export function sampleReceipt({ receiptId, createdAt, transactions, isPaid = true, status = 'paid', buyerUserId = 1, name = 'Jamie Buyer' }) {
  return {
    receipt_id: receiptId,
    buyer_user_id: buyerUserId,
    name,
    is_paid: isPaid,
    status,
    create_timestamp: Date.parse(createdAt) / 1000,
    transactions,
  };
}

export function sampleTransaction({ transactionId, listingId, quantity = 1, variations = [] }) {
  return { transaction_id: transactionId, listing_id: listingId, quantity, variations };
}

export function personalizationVariation({ questionId, formattedName, formattedValue }) {
  return { property_id: 54, question_id: questionId, formatted_name: formattedName, formatted_value: formattedValue };
}
```

- [ ] **Step 2: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncMadeToOrderReceipts } from './etsySync.js';
import { createFakeStore, sampleReceipt, sampleTransaction, personalizationVariation } from './mtoTestFakes.js';

const LISTING_ID = 222;
const SHOP_ID = 42;
const CUTOVER_AT = '2026-09-15T00:00:00Z';

function noAssets() {
  return async () => { throw new Error('importAndStoreAsset should not be called in this test'); };
}
function noProductAnswer() {
  return async () => null;
}

test('imports a new order with mapped personalization answers', async () => {
  const store = createFakeStore();
  const receipt = sampleReceipt({
    receiptId: 1,
    createdAt: '2026-09-16T00:00:00Z',
    transactions: [
      sampleTransaction({
        transactionId: 101,
        listingId: LISTING_ID,
        variations: [
          personalizationVariation({ questionId: null, formattedName: 'Which Etsy product should this page promote?', formattedValue: 'https://www.etsy.com/listing/999/x' }),
          personalizationVariation({ questionId: null, formattedName: 'Who usually buys this product?', formattedValue: 'New parents' }),
        ],
      }),
    ],
  });

  const result = await syncMadeToOrderReceipts({
    listReceipts: async ({ minCreated }) => (minCreated ? { receipts: [receipt] } : { receipts: [] }),
    resolveListing: async () => ({ title: 'A Nice Mug', price: { amount: 1999, divisor: 100 }, currency: 'USD', state: 'active' }),
    importAndStoreAsset: noAssets(),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  });

  assert.equal(result.skipped, false);
  assert.equal(result.ordersCreated, 1);
  const order = store._ordersByTransactionId.get('101');
  assert.equal(order.paymentState, 'paid');
  assert.equal(order.needsAttention, false);
  assert.equal(order.resolvedListingId, '999');
  const answers = store._answersByOrderId.get(order.id);
  assert.equal(answers.length, 2);
});

test('skips a receipt created before the cutover entirely', async () => {
  const store = createFakeStore();
  const receipt = sampleReceipt({
    receiptId: 2,
    createdAt: '2026-09-01T00:00:00Z',
    transactions: [sampleTransaction({ transactionId: 201, listingId: LISTING_ID })],
  });

  const result = await syncMadeToOrderReceipts({
    listReceipts: async () => ({ receipts: [receipt] }),
    resolveListing: noProductAnswer(),
    importAndStoreAsset: noAssets(),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  });

  assert.equal(result.ordersCreated, 0);
  assert.equal(store._ordersByTransactionId.size, 0);
});

test('running the same receipt through twice does not create a duplicate order', async () => {
  const store = createFakeStore();
  const receipt = sampleReceipt({
    receiptId: 3,
    createdAt: '2026-09-16T00:00:00Z',
    transactions: [sampleTransaction({ transactionId: 301, listingId: LISTING_ID })],
  });
  const deps = {
    listReceipts: async ({ minCreated }) => (minCreated ? { receipts: [receipt] } : { receipts: [] }),
    resolveListing: noProductAnswer(),
    importAndStoreAsset: noAssets(),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  };

  await syncMadeToOrderReceipts(deps);
  const secondRun = await syncMadeToOrderReceipts(deps);

  assert.equal(store._ordersByTransactionId.size, 1);
  assert.equal(secondRun.ordersCreated, 0);
});

test('flags an order with quantity > 1 as needing attention, reason multiple_units', async () => {
  const store = createFakeStore();
  const receipt = sampleReceipt({
    receiptId: 4,
    createdAt: '2026-09-16T00:00:00Z',
    transactions: [sampleTransaction({ transactionId: 401, listingId: LISTING_ID, quantity: 3 })],
  });

  await syncMadeToOrderReceipts({
    listReceipts: async () => ({ receipts: [receipt] }),
    resolveListing: noProductAnswer(),
    importAndStoreAsset: noAssets(),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  });

  const order = store._ordersByTransactionId.get('401');
  assert.equal(order.needsAttention, true);
  assert.equal(order.attentionReason, 'multiple_units');
});

test('flags an order missing the required product_url answer', async () => {
  const store = createFakeStore();
  const receipt = sampleReceipt({
    receiptId: 5,
    createdAt: '2026-09-16T00:00:00Z',
    transactions: [
      sampleTransaction({
        transactionId: 501,
        listingId: LISTING_ID,
        variations: [personalizationVariation({ questionId: null, formattedName: 'Who usually buys this product?', formattedValue: 'Gift shoppers' })],
      }),
    ],
  });

  await syncMadeToOrderReceipts({
    listReceipts: async () => ({ receipts: [receipt] }),
    resolveListing: noProductAnswer(),
    importAndStoreAsset: noAssets(),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  });

  const order = store._ordersByTransactionId.get('501');
  assert.equal(order.attentionReason, 'missing_information');
});

test('flags an order whose product link does not resolve to a real listing', async () => {
  const store = createFakeStore();
  const receipt = sampleReceipt({
    receiptId: 6,
    createdAt: '2026-09-16T00:00:00Z',
    transactions: [
      sampleTransaction({
        transactionId: 601,
        listingId: LISTING_ID,
        variations: [personalizationVariation({ questionId: null, formattedName: 'Which Etsy product should this page promote?', formattedValue: 'https://www.etsy.com/listing/999/x' })],
      }),
    ],
  });

  await syncMadeToOrderReceipts({
    listReceipts: async () => ({ receipts: [receipt] }),
    resolveListing: async () => null, // deleted/inactive/not found
    importAndStoreAsset: noAssets(),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  });

  const order = store._ordersByTransactionId.get('601');
  assert.equal(order.attentionReason, 'product_unclear');
});

test('downloads an uploaded asset and flags asset_unavailable when it fails', async () => {
  const store = createFakeStore();
  const receipt = sampleReceipt({
    receiptId: 7,
    createdAt: '2026-09-16T00:00:00Z',
    transactions: [
      sampleTransaction({
        transactionId: 701,
        listingId: LISTING_ID,
        variations: [
          personalizationVariation({ questionId: null, formattedName: 'Which Etsy product should this page promote?', formattedValue: 'https://www.etsy.com/listing/999/x' }),
          personalizationVariation({ questionId: null, formattedName: 'Upload your product photos and brand assets', formattedValue: 'https://images.etsy.com/photo.jpg' }),
        ],
      }),
    ],
  });

  await syncMadeToOrderReceipts({
    listReceipts: async () => ({ receipts: [receipt] }),
    resolveListing: async () => ({ title: 'X', price: {}, currency: 'USD', state: 'active' }),
    importAndStoreAsset: async () => ({ status: 'failed', failureReason: 'too_large' }),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  });

  const order = store._ordersByTransactionId.get('701');
  assert.equal(order.attentionReason, 'asset_unavailable');
  const assets = store._assetsByOrderId.get(order.id);
  assert.equal(assets[0].status, 'failed');
});

test('paginates across multiple pages of receipts', async () => {
  const store = createFakeStore();
  const pageOne = [sampleReceipt({ receiptId: 8, createdAt: '2026-09-16T00:00:00Z', transactions: [sampleTransaction({ transactionId: 801, listingId: LISTING_ID })] })];
  const pageTwo = [sampleReceipt({ receiptId: 9, createdAt: '2026-09-16T01:00:00Z', transactions: [sampleTransaction({ transactionId: 901, listingId: LISTING_ID })] })];
  let calls = 0;

  await syncMadeToOrderReceipts({
    listReceipts: async ({ minCreated, offset }) => {
      if (!minCreated) return { receipts: [] }; // reconciliation pass, not under test here
      calls += 1;
      if (offset === 0) return { receipts: pageOne.concat(Array(99).fill(pageOne[0])) }; // force a full page (limit 100)
      return { receipts: pageTwo };
    },
    resolveListing: noProductAnswer(),
    importAndStoreAsset: noAssets(),
    store,
    listingId: LISTING_ID,
    shopId: SHOP_ID,
    cutoverAt: CUTOVER_AT,
    trigger: 'manual',
  });

  assert.ok(calls >= 2, 'expected pagination to request a second page');
  assert.ok(store._ordersByTransactionId.has('901'), 'the second page\'s order should have been imported');
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test lib/etsySync.test.js`
Expected: FAIL — `etsySync.js` doesn't exist yet.

- [ ] **Step 4: Implement**

```js
import { deriveOrderFromTransaction, extractPersonalizationAnswers, deriveAttentionReason, parseEtsyProductUrl, isReceiptBeforeCutover, derivePaymentState } from './mtoOrders.js';
import { mapAnswer, MAPPING_VERSION } from './mtoFieldMapping.js';

const OVERLAP_MS = 60 * 60 * 1000; // 1 hour -- survives receipts arriving slightly out of creation order
const RECONCILE_WINDOW_MS = 72 * 60 * 60 * 1000; // 3 days -- catches a cancellation/refund on an older order
const MAX_PAGES_PER_RUN = 10; // bounds each invocation to stay inside the serverless function time limit
const PAGE_LIMIT = 100;
const LOCK_STALE_MS = 5 * 60 * 1000; // a lock older than this is treated as an abandoned/crashed run

export async function syncMadeToOrderReceipts({
  listReceipts,
  resolveListing,
  importAndStoreAsset,
  store,
  listingId,
  shopId,
  cutoverAt,
  trigger,
  now = () => new Date(),
}) {
  const runStartedAt = now();
  const state = await store.getSyncState();

  if (state.runningSince && runStartedAt.getTime() - new Date(state.runningSince).getTime() < LOCK_STALE_MS) {
    return { skipped: true, reason: 'already_running' };
  }
  await store.acquireLock(runStartedAt.toISOString());

  const summary = { receiptsSeen: 0, ordersCreated: 0, ordersUpdated: 0 };
  let errorMessage = null;

  try {
    const cursor = state.cursorMinCreated ? new Date(state.cursorMinCreated) : new Date(cutoverAt);
    const windowStart = new Date(cursor.getTime() - OVERLAP_MS);
    let latestSeenCreated = cursor;

    let offset = 0;
    for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      const { receipts } = await listReceipts({ minCreated: windowStart, limit: PAGE_LIMIT, offset });
      summary.receiptsSeen += receipts.length;
      for (const receipt of receipts) {
        const receiptCreated = new Date(receipt.create_timestamp * 1000);
        if (receiptCreated > latestSeenCreated) latestSeenCreated = receiptCreated;
        if (isReceiptBeforeCutover(receipt, cutoverAt)) continue;
        await processReceipt({ receipt, listingId, shopId, store, resolveListing, importAndStoreAsset, summary });
      }
      if (receipts.length < PAGE_LIMIT) break;
      offset += PAGE_LIMIT;
    }

    await reconcile({ listReceipts, listingId, store, runStartedAt, summary });

    await store.saveCursor(latestSeenCreated.toISOString());
  } catch (err) {
    errorMessage = err.message;
  }

  await store.recordSyncRun({
    startedAt: runStartedAt.toISOString(),
    finishedAt: now().toISOString(),
    trigger,
    receiptsSeen: summary.receiptsSeen,
    ordersCreated: summary.ordersCreated,
    ordersUpdated: summary.ordersUpdated,
    error: errorMessage,
  });
  await store.releaseLock();

  if (errorMessage) throw new Error(errorMessage);
  return { skipped: false, ...summary };
}

async function processReceipt({ receipt, listingId, shopId, store, resolveListing, importAndStoreAsset, summary }) {
  for (const transaction of receipt.transactions || []) {
    const orderFields = deriveOrderFromTransaction({ receipt, transaction, listingId, shopId });
    if (!orderFields) continue;

    const existing = await store.getOrderByTransactionId(orderFields.transactionId);
    if (existing) continue; // already imported; the reconciliation pass handles state changes

    const rawAnswers = extractPersonalizationAnswers(transaction);
    const mappedAnswers = rawAnswers.map(answer => ({
      ...answer,
      mappedField: mapAnswer(answer),
      mappingVersion: MAPPING_VERSION,
    }));

    const productUrlAnswer = mappedAnswers.find(a => a.mappedField === 'product_url');
    let resolvedListingId = null;
    let resolvedListingSnapshot = null;
    let productUnclear = false;
    if (productUrlAnswer) {
      const parsed = parseEtsyProductUrl(productUrlAnswer.formattedValue);
      const snapshot = parsed ? await resolveListing(parsed.listingId) : null;
      if (snapshot) {
        resolvedListingId = parsed.listingId;
        resolvedListingSnapshot = snapshot;
      } else {
        productUnclear = true;
      }
    }

    const assetAnswers = mappedAnswers.filter(a => a.mappedField === 'assets');
    const assetResults = [];
    for (const answer of assetAnswers) {
      const result = await importAndStoreAsset(orderFields.transactionId, answer.formattedValue);
      assetResults.push({ sourceUrl: answer.formattedValue, ...result });
    }
    const anyAssetFailed = assetResults.some(a => a.status === 'failed');

    const attentionReason = deriveAttentionReason({
      quantity: orderFields.quantity,
      mappedAnswers,
      productUnclear,
      anyAssetFailed,
    });

    const { id: orderId } = await store.upsertOrder({
      ...orderFields,
      needsAttention: attentionReason !== null,
      attentionReason,
      resolvedListingId,
      resolvedListingSnapshot,
    });
    summary.ordersCreated += 1;

    if (mappedAnswers.length > 0) {
      await store.insertAnswers(orderId, mappedAnswers);
    }
    for (const asset of assetResults) {
      await store.insertAsset(orderId, asset);
    }
  }
}

async function reconcile({ listReceipts, listingId, store, runStartedAt, summary }) {
  let offset = 0;
  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    const { receipts } = await listReceipts({
      minLastModified: new Date(runStartedAt.getTime() - RECONCILE_WINDOW_MS),
      maxLastModified: runStartedAt,
      limit: PAGE_LIMIT,
      offset,
    });
    for (const receipt of receipts) {
      for (const transaction of receipt.transactions || []) {
        if (String(transaction.listing_id) !== String(listingId)) continue;
        const existing = await store.getOrderByTransactionId(transaction.transaction_id);
        if (!existing) continue;

        const paymentState = derivePaymentState(receipt);
        if (paymentState !== existing.paymentState) {
          await store.updatePaymentState(existing.id, paymentState);
          summary.ordersUpdated += 1;
        }
      }
    }
    if (receipts.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }
}
```

*Note: the tests in this task pass `listReceipts` implementations that return `{ receipts: [] }` for the reconciliation pass (no `minCreated` in the call) — the reconciliation pass itself is exercised properly in Task 7.*

- [ ] **Step 5: Run to verify it passes**

Run: `node --test lib/etsySync.test.js`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/etsySync.js lib/mtoTestFakes.js lib/etsySync.test.js
git commit -m "Add made-to-order sync orchestrator: new-order pass"
```

---

### Task 7: Sync Orchestrator — Reconciliation, Lock, and Resumable Cursor

**Files:**
- Modify: `lib/etsySync.test.js` (append)

**Interfaces:**
- Consumes: `createFakeStore`, `sampleReceipt`, `sampleTransaction` from `lib/mtoTestFakes.js` (Task 6); `syncMadeToOrderReceipts` from `lib/etsySync.js` (Task 6 — no production code changes in this task, since the reconciliation/lock/cursor logic was already implemented in Task 6's `syncMadeToOrderReceipts`; this task's job is to prove that behavior with dedicated tests).

- [ ] **Step 1: Write the failing tests (append to `lib/etsySync.test.js`)**

```js
test('reconciliation pass updates payment state when a receipt is later canceled', async () => {
  const store = createFakeStore();
  const listingId = LISTING_ID, shopId = SHOP_ID;
  const transaction = sampleTransaction({ transactionId: 1001, listingId });
  const paidReceipt = sampleReceipt({ receiptId: 10, createdAt: '2026-09-16T00:00:00Z', transactions: [transaction] });

  // First run: import while still paid.
  await syncMadeToOrderReceipts({
    listReceipts: async ({ minCreated }) => (minCreated ? { receipts: [paidReceipt] } : { receipts: [] }),
    resolveListing: noProductAnswer(),
    importAndStoreAsset: noAssets(),
    store, listingId, shopId, cutoverAt: CUTOVER_AT, trigger: 'manual',
  });
  assert.equal(store._ordersByTransactionId.get('1001').paymentState, 'paid');

  // Second run: the same receipt, now canceled, surfaces only via the
  // reconciliation pass (min_last_modified), not the new-order pass.
  const canceledReceipt = { ...paidReceipt, status: 'canceled' };
  const result = await syncMadeToOrderReceipts({
    listReceipts: async ({ minCreated, minLastModified }) => {
      if (minCreated) return { receipts: [] };
      if (minLastModified) return { receipts: [canceledReceipt] };
      return { receipts: [] };
    },
    resolveListing: noProductAnswer(),
    importAndStoreAsset: noAssets(),
    store, listingId, shopId, cutoverAt: CUTOVER_AT, trigger: 'manual',
  });

  assert.equal(result.ordersUpdated, 1);
  assert.equal(store._ordersByTransactionId.get('1001').paymentState, 'canceled');
});

test('an order is never deleted when its receipt is later canceled', async () => {
  const store = createFakeStore();
  const listingId = LISTING_ID, shopId = SHOP_ID;
  const transaction = sampleTransaction({ transactionId: 1101, listingId });
  const paidReceipt = sampleReceipt({ receiptId: 11, createdAt: '2026-09-16T00:00:00Z', transactions: [transaction] });

  await syncMadeToOrderReceipts({
    listReceipts: async ({ minCreated }) => (minCreated ? { receipts: [paidReceipt] } : { receipts: [] }),
    resolveListing: noProductAnswer(), importAndStoreAsset: noAssets(),
    store, listingId, shopId, cutoverAt: CUTOVER_AT, trigger: 'manual',
  });

  const canceledReceipt = { ...paidReceipt, status: 'canceled' };
  await syncMadeToOrderReceipts({
    listReceipts: async ({ minLastModified }) => (minLastModified ? { receipts: [canceledReceipt] } : { receipts: [] }),
    resolveListing: noProductAnswer(), importAndStoreAsset: noAssets(),
    store, listingId, shopId, cutoverAt: CUTOVER_AT, trigger: 'manual',
  });

  assert.ok(store._ordersByTransactionId.has('1101'), 'the order row must still exist after cancellation');
});

test('a second sync run is skipped while a lock from the first run is still fresh', async () => {
  const store = createFakeStore();
  await store.acquireLock(new Date().toISOString());

  const result = await syncMadeToOrderReceipts({
    listReceipts: async () => { throw new Error('should not be called while locked'); },
    resolveListing: noProductAnswer(),
    importAndStoreAsset: noAssets(),
    store, listingId: LISTING_ID, shopId: SHOP_ID, cutoverAt: CUTOVER_AT, trigger: 'cron',
  });

  assert.deepEqual(result, { skipped: true, reason: 'already_running' });
});

test('a stale lock (older than 5 minutes) does not block a new run', async () => {
  const store = createFakeStore();
  const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await store.acquireLock(staleTime);

  const result = await syncMadeToOrderReceipts({
    listReceipts: async () => ({ receipts: [] }),
    resolveListing: noProductAnswer(),
    importAndStoreAsset: noAssets(),
    store, listingId: LISTING_ID, shopId: SHOP_ID, cutoverAt: CUTOVER_AT, trigger: 'cron',
  });

  assert.equal(result.skipped, false);
});

test('the lock is always released, even when listReceipts throws', async () => {
  const store = createFakeStore();

  await assert.rejects(() =>
    syncMadeToOrderReceipts({
      listReceipts: async () => { throw new Error('Etsy API 500'); },
      resolveListing: noProductAnswer(),
      importAndStoreAsset: noAssets(),
      store, listingId: LISTING_ID, shopId: SHOP_ID, cutoverAt: CUTOVER_AT, trigger: 'manual',
    })
  );

  const state = await store.getSyncState();
  assert.equal(state.runningSince, null);
  assert.equal(store._syncRuns.at(-1).error, 'Etsy API 500');
});

test('the cursor advances to the latest receipt creation time seen, and a later run resumes from there', async () => {
  const store = createFakeStore();
  const firstReceipt = sampleReceipt({ receiptId: 12, createdAt: '2026-09-16T00:00:00Z', transactions: [sampleTransaction({ transactionId: 1201, listingId: LISTING_ID })] });

  await syncMadeToOrderReceipts({
    listReceipts: async ({ minCreated }) => (minCreated ? { receipts: [firstReceipt] } : { receipts: [] }),
    resolveListing: noProductAnswer(), importAndStoreAsset: noAssets(),
    store, listingId: LISTING_ID, shopId: SHOP_ID, cutoverAt: CUTOVER_AT, trigger: 'manual',
  });

  const state = await store.getSyncState();
  assert.equal(new Date(state.cursorMinCreated).toISOString(), new Date('2026-09-16T00:00:00Z').toISOString());

  // A later run only re-requests from (roughly) that cursor forward, not
  // from the original cutover -- proven by asserting minCreated moved.
  let seenMinCreated = null;
  await syncMadeToOrderReceipts({
    listReceipts: async ({ minCreated }) => {
      if (minCreated) seenMinCreated = minCreated;
      return { receipts: [] };
    },
    resolveListing: noProductAnswer(), importAndStoreAsset: noAssets(),
    store, listingId: LISTING_ID, shopId: SHOP_ID, cutoverAt: CUTOVER_AT, trigger: 'manual',
  });
  assert.ok(seenMinCreated.getTime() > new Date(CUTOVER_AT).getTime());
});
```

- [ ] **Step 2: Run to verify it fails or passes**

Run: `node --test lib/etsySync.test.js`
Expected: these 6 new tests should already PASS, since Task 6 implemented the full orchestrator (reconciliation pass, lock, cursor) in one file — this task exists to give the reconciliation/lock/resumability behavior its own reviewable, independently-approvable test coverage, per the spec's explicit requirement to test these scenarios. If any of the 6 fail, fix `lib/etsySync.js` (not the tests) until they pass, since the Task 6 implementation is expected to already satisfy them.

- [ ] **Step 3: Run the full file once more to confirm nothing regressed**

Run: `node --test lib/etsySync.test.js`
Expected: PASS (14 tests total: 8 from Task 6 + 6 here)

- [ ] **Step 4: Commit**

```bash
git add lib/etsySync.test.js
git commit -m "Add reconciliation, lock, and resumable-cursor test coverage for made-to-order sync"
```

---

### Task 8: Real Store + Etsy/Asset Wiring, Sync Routes, Cron

**Files:**
- Create: `lib/mtoStore.js`
- Modify: `server.js`
- Modify: `vercel.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `createMtoStore(supabaseAdmin)` (this task) implementing the exact `store` interface documented in Task 6; `syncMadeToOrderReceipts` from `lib/etsySync.js` (Task 6/7); `importAsset` from `lib/assetImporter.js` (Task 4); the existing `ETSY_BASE`, `API_KEY_HEADER`, `getValidEtsyToken`, `etsyFetch`, `supabaseAdmin`, `requireAdmin` already defined in `server.js`.
- Produces: `POST /api/admin/mto/sync-now` (admin-triggered), `GET /api/cron/mto-sync` (Vercel-Cron-triggered).

Not unit-tested with `node --test` — like the existing `getValidEtsyToken` (which does real token refresh over the network) and the rest of `server.js`'s route handlers, this task's code talks to real Etsy/Supabase and is verified manually (Task 12's QA doc covers this end-to-end).

- [ ] **Step 1: Implement `lib/mtoStore.js`**

```js
// The real, Supabase-backed implementation of the `store` interface
// lib/etsySync.js's syncMadeToOrderReceipts() depends on. Not unit tested
// directly (same reasoning as getValidEtsyToken in lib/etsyOAuth.js) --
// exercised via the manual QA steps in docs/qa-made-to-order-intake.md.
export function createMtoStore(supabaseAdmin) {
  return {
    async getSyncState() {
      const { data, error } = await supabaseAdmin.from('mto_sync_state').select('cursor_min_created, running_since').eq('id', 1).single();
      if (error) throw new Error(error.message);
      return { cursorMinCreated: data.cursor_min_created, runningSince: data.running_since };
    },

    async acquireLock(nowIso) {
      const { error } = await supabaseAdmin.from('mto_sync_state').update({ running_since: nowIso, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) throw new Error(error.message);
    },

    async releaseLock() {
      const { error } = await supabaseAdmin.from('mto_sync_state').update({ running_since: null, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) throw new Error(error.message);
    },

    async getOrderByTransactionId(transactionId) {
      const { data, error } = await supabaseAdmin
        .from('mto_orders')
        .select('id, payment_state')
        .eq('transaction_id', transactionId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { id: data.id, paymentState: data.payment_state } : null;
    },

    async upsertOrder(orderFields) {
      const { data, error } = await supabaseAdmin
        .from('mto_orders')
        .upsert(
          {
            shop_id: orderFields.shopId,
            receipt_id: orderFields.receiptId,
            transaction_id: orderFields.transactionId,
            listing_id: orderFields.listingId,
            quantity: orderFields.quantity,
            buyer_etsy_user_id: orderFields.buyerEtsyUserId,
            buyer_display_name: orderFields.buyerDisplayName,
            receipt_created_at: orderFields.receiptCreatedAt,
            payment_state: orderFields.paymentState,
            needs_attention: orderFields.needsAttention,
            attention_reason: orderFields.attentionReason,
            resolved_listing_id: orderFields.resolvedListingId,
            resolved_listing_snapshot: orderFields.resolvedListingSnapshot,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: 'shop_id,transaction_id' },
        )
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return { id: data.id };
    },

    async insertAnswers(orderId, answers) {
      const { error } = await supabaseAdmin.from('mto_personalization_answers').insert(
        answers.map(a => ({
          order_id: orderId,
          question_id: a.questionId != null ? String(a.questionId) : null,
          formatted_name: a.formattedName,
          formatted_value: a.formattedValue,
          mapped_field: a.mappedField,
          mapping_version: a.mappingVersion,
        })),
      );
      if (error) throw new Error(error.message);
    },

    async insertAsset(orderId, asset) {
      const { error } = await supabaseAdmin.from('mto_assets').insert({
        order_id: orderId,
        source_url: asset.sourceUrl,
        storage_key: asset.storageKey ?? null,
        content_type: asset.contentType ?? null,
        byte_size: asset.byteSize ?? null,
        status: asset.status,
        failure_reason: asset.failureReason ?? null,
      });
      if (error) throw new Error(error.message);
    },

    async updatePaymentState(orderId, paymentState) {
      const { error } = await supabaseAdmin
        .from('mto_orders')
        .update({ payment_state: paymentState, last_synced_at: new Date().toISOString() })
        .eq('id', orderId);
      if (error) throw new Error(error.message);
    },

    async saveCursor(isoString) {
      const { error } = await supabaseAdmin.from('mto_sync_state').update({ cursor_min_created: isoString, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) throw new Error(error.message);
    },

    async recordSyncRun(summary) {
      const { error } = await supabaseAdmin.from('mto_sync_runs').insert({
        started_at: summary.startedAt,
        finished_at: summary.finishedAt,
        trigger: summary.trigger,
        receipts_seen: summary.receiptsSeen,
        orders_created: summary.ordersCreated,
        orders_updated: summary.ordersUpdated,
        error: summary.error,
      });
      if (error) throw new Error(error.message);
    },
  };
}
```

- [ ] **Step 2: Add the Etsy/asset glue and routes to `server.js`**

Add the import near the other `lib/` imports at the top of `server.js`:

```js
import { createMtoStore } from './lib/mtoStore.js';
import { syncMadeToOrderReceipts } from './lib/etsySync.js';
import { importAsset } from './lib/assetImporter.js';
```

Add near the other constants (after `MAX_RETRIES`/`API_KEY_HEADER`):

```js
const mtoStore = supabaseAdmin ? createMtoStore(supabaseAdmin) : null;

// Fetches one page of the seller's receipts for made-to-order sync. Mirrors
// the retry-on-429 behavior of etsyFetch(), but this needs query params and
// an Authorization header, which etsyFetch() doesn't support.
async function listMtoReceipts({ minCreated, minLastModified, maxLastModified, limit, offset }, attempt = 0) {
  const etsyToken = await getValidEtsyToken(supabaseAdmin, ETSY_API_KEY);
  if (!etsyToken) throw new Error('No Etsy seller connection configured.');

  const params = new URLSearchParams({ limit: String(limit), offset: String(offset), sort_on: 'created', sort_order: 'asc' });
  if (minCreated) params.set('min_created', String(Math.floor(minCreated.getTime() / 1000)));
  if (minLastModified) params.set('min_last_modified', String(Math.floor(minLastModified.getTime() / 1000)));
  if (maxLastModified) params.set('max_last_modified', String(Math.floor(maxLastModified.getTime() / 1000)));

  const res = await fetch(`${ETSY_BASE}/shops/${etsyToken.shopId}/receipts?${params}`, {
    headers: { 'x-api-key': API_KEY_HEADER, Authorization: `Bearer ${etsyToken.accessToken}` },
  });

  if (res.status === 429 && attempt < MAX_RETRIES) {
    const retryAfterSec = Number(res.headers.get('retry-after'));
    const delayMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 500 * 2 ** attempt;
    await sleep(delayMs);
    return listMtoReceipts({ minCreated, minLastModified, maxLastModified, limit, offset }, attempt + 1);
  }
  if (!res.ok) throw new Error(`Etsy API ${res.status}: ${await res.text()}`);

  const body = await res.json();
  return { receipts: body.results ?? [] };
}

// Confirms the buyer's pasted product link resolves to a real, active
// listing -- reuses the existing public etsyFetch() (no OAuth needed for
// listing reads).
async function resolveMtoListing(listingId) {
  try {
    const listing = await etsyFetch(`/listings/${listingId}`);
    if (listing.state !== 'active') return null;
    return { title: listing.title, price: listing.price, currency: listing.price?.currency_code, state: listing.state };
  } catch {
    return null;
  }
}

// Downloads a buyer-uploaded asset through the restricted importer, then
// copies the validated bytes into the private mto-assets bucket.
async function importAndStoreMtoAsset(transactionId, sourceUrl) {
  const result = await importAsset(sourceUrl);
  if (!result.ok) return { status: 'failed', failureReason: result.failureReason };

  const extension = (result.contentType.split('/')[1] || 'bin').replace('jpeg', 'jpg');
  const storageKey = `${transactionId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabaseAdmin.storage.from('mto-assets').upload(storageKey, result.buffer, { contentType: result.contentType });
  if (error) return { status: 'failed', failureReason: `storage_upload_failed: ${error.message}` };

  return { status: 'downloaded', storageKey, contentType: result.contentType, byteSize: result.byteSize };
}

async function getMtoSettings() {
  const { data, error } = await supabaseAdmin.from('mto_settings').select('enabled, cutover_at').eq('id', 1).single();
  if (error) throw new Error(error.message);
  return { enabled: data.enabled, cutoverAt: data.cutover_at };
}

async function runMtoSync(trigger) {
  if (!mtoStore) throw new Error('Made-to-order intake is not configured on the server.');
  const settings = await getMtoSettings();
  if (!settings.enabled || !settings.cutoverAt) {
    return { skipped: true, reason: 'not_enabled' };
  }
  const etsyToken = await getValidEtsyToken(supabaseAdmin, ETSY_API_KEY);
  if (!etsyToken) throw new Error('No Etsy seller connection configured.');

  return syncMadeToOrderReceipts({
    listReceipts: listMtoReceipts,
    resolveListing: resolveMtoListing,
    importAndStoreAsset: importAndStoreMtoAsset,
    store: mtoStore,
    listingId: ETSY_PRODUCT_LISTING_ID,
    shopId: etsyToken.shopId,
    cutoverAt: settings.cutoverAt,
    trigger,
  });
}
```

Add the two routes (near the other `/api/admin/*` routes):

```js
app.post('/api/admin/mto/sync-now', requireAdmin, async (req, res) => {
  try {
    const result = await runMtoSync('manual');
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

// Vercel Cron always sends GET, and (with CRON_SECRET set as a project env
// var) automatically attaches `Authorization: Bearer <CRON_SECRET>` -- see
// https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
app.get('/api/cron/mto-sync', async (req, res) => {
  if (!CRON_SECRET || req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  try {
    const result = await runMtoSync('cron');
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});
```

Add `CRON_SECRET` to the destructured env vars at the top of `server.js`:

```js
const {
  // ...existing vars...
  CRON_SECRET,
} = process.env;
```

- [ ] **Step 3: Add the cron schedule to `vercel.json`**

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/api/index" }
  ],
  "crons": [
    { "path": "/api/cron/mto-sync", "schedule": "*/10 * * * *" }
  ]
}
```

- [ ] **Step 4: Document the new env var in `.env.example`**

```
CRON_SECRET=a_random_16plus_char_secret_here
```

- [ ] **Step 5: Verify locally**

Run: `npm start`, then in a second terminal, with a valid admin Bearer token:

```bash
curl -X POST http://localhost:3000/api/admin/mto/sync-now -H "Authorization: Bearer <admin-access-token>"
```

Expected (before `mto_settings.enabled` is turned on): `{"skipped":true,"reason":"not_enabled"}`. Also confirm `curl http://localhost:3000/api/cron/mto-sync` (no auth header) returns `401`.

- [ ] **Step 6: Set `CRON_SECRET` in Vercel and deploy-time env**

In the Vercel dashboard: Project → Settings → Environment Variables → add `CRON_SECRET` (a random 16+ character value) for Production (and Preview, if you want the cron-secured route testable on preview deployments too). Vercel automatically sends it as the `Authorization` header on every cron invocation once set — no code change needed beyond what's above.

- [ ] **Step 7: Commit**

```bash
git add lib/mtoStore.js server.js vercel.json .env.example
git commit -m "Wire made-to-order sync into server.js with admin and cron-triggered routes"
```

---

### Task 9: Cutover Guard Wiring in the Self-Serve Routes

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `evaluateReceipt` (Task 5's new signature) and `getMtoSettings()` (Task 8).

- [ ] **Step 1: Wire settings into `/api/verify-purchase`**

In the `/api/verify-purchase` handler, right before the existing `const result = evaluateReceipt({...})` call, add:

```js
const mtoSettings = mtoStore ? await getMtoSettings() : { enabled: false, cutoverAt: null };
```

Then extend the existing `evaluateReceipt` call:

```js
const result = evaluateReceipt({
  receipt,
  listingId: ETSY_PRODUCT_LISTING_ID,
  claimedByOtherUser: !!existingClaim,
  shopNameQuestionId: ETSY_SHOP_NAME_QUESTION_ID,
  madeToOrderEnabled: mtoSettings.enabled,
  cutoverAt: mtoSettings.cutoverAt,
});
```

- [ ] **Step 2: Wire settings into `/api/check-new-purchase`**

In the `/api/check-new-purchase` handler, right before its `const result = evaluateReceipt({...})` call, add the same `mtoSettings` lookup and extend that call identically:

```js
const mtoSettings = mtoStore ? await getMtoSettings() : { enabled: false, cutoverAt: null };
const result = evaluateReceipt({
  receipt: candidate,
  listingId: ETSY_PRODUCT_LISTING_ID,
  claimedByOtherUser: false,
  madeToOrderEnabled: mtoSettings.enabled,
  cutoverAt: mtoSettings.cutoverAt,
});
```

- [ ] **Step 3: Verify locally**

With `mto_settings.enabled = false` (the default after Task 1's migration), confirm `POST /api/verify-purchase` with a real pre-existing test receipt still behaves exactly as before (unaffected). This is the safe default state to leave the app in until you're ready to flip the switch for real.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Read made-to-order settings into the self-serve purchase-verification guard"
```

---

### Task 10: Admin Read Routes

**Files:**
- Modify: `server.js`

**Interfaces:**
- Produces:
  - `GET /api/admin/mto/orders` (`requireAdmin`) — query param `needsAttention=true` optional filter
  - `GET /api/admin/mto/orders/:id` (`requireAdmin`)
  - `GET /api/admin/mto/settings` (`requireAdmin`)
  - `POST /api/admin/mto/settings` (`requireAdmin`) — body `{ enabled: boolean, cutoverAt: string | null }`

- [ ] **Step 1: Implement the routes**

```js
app.get('/api/admin/mto/orders', requireAdmin, async (req, res) => {
  let query = supabaseAdmin
    .from('mto_orders')
    .select('id, receipt_id, transaction_id, buyer_display_name, payment_state, fulfillment_status, needs_attention, attention_reason, receipt_created_at, last_synced_at')
    .order('receipt_created_at', { ascending: false });
  if (req.query.needsAttention === 'true') {
    query = query.eq('needs_attention', true);
  }
  const { data, error } = await query;
  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json({ orders: data });
});

app.get('/api/admin/mto/orders/:id', requireAdmin, async (req, res) => {
  const { data: order, error } = await supabaseAdmin.from('mto_orders').select('*').eq('id', req.params.id).maybeSingle();
  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  const { data: answers, error: answersError } = await supabaseAdmin
    .from('mto_personalization_answers')
    .select('question_id, formatted_name, formatted_value, mapped_field, mapping_version')
    .eq('order_id', order.id);
  if (answersError) {
    console.error(answersError);
    return res.status(500).json({ error: answersError.message });
  }

  const { data: assets, error: assetsError } = await supabaseAdmin
    .from('mto_assets')
    .select('id, source_url, storage_key, content_type, byte_size, status, failure_reason')
    .eq('order_id', order.id);
  if (assetsError) {
    console.error(assetsError);
    return res.status(500).json({ error: assetsError.message });
  }

  // Short-lived signed URLs -- the bucket is private, and these are the
  // only way the admin UI can display a thumbnail.
  const assetsWithUrls = await Promise.all(
    assets.map(async (asset) => {
      if (!asset.storage_key) return asset;
      const { data: signed } = await supabaseAdmin.storage.from('mto-assets').createSignedUrl(asset.storage_key, 300);
      return { ...asset, signedUrl: signed?.signedUrl ?? null };
    }),
  );

  res.json({ order, answers, assets: assetsWithUrls });
});

app.get('/api/admin/mto/settings', requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('mto_settings').select('enabled, cutover_at').eq('id', 1).single();
  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json({ enabled: data.enabled, cutoverAt: data.cutover_at });
});

app.post('/api/admin/mto/settings', requireAdmin, async (req, res) => {
  const { enabled, cutoverAt } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: '"enabled" must be a boolean.' });
  }
  if (cutoverAt !== null && Number.isNaN(Date.parse(cutoverAt))) {
    return res.status(400).json({ error: '"cutoverAt" must be a valid date/time or null.' });
  }
  const { error } = await supabaseAdmin
    .from('mto_settings')
    .update({ enabled, cutover_at: cutoverAt, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json({ enabled, cutoverAt });
});
```

- [ ] **Step 2: Verify locally**

With an admin Bearer token: `curl http://localhost:3000/api/admin/mto/settings -H "Authorization: Bearer <admin-token>"` returns `{"enabled":false,"cutoverAt":null}` (the Task 1 migration's default row). `curl http://localhost:3000/api/admin/mto/orders -H "Authorization: Bearer <admin-token>"` returns `{"orders":[]}`.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "Add admin read routes for made-to-order orders and settings"
```

---

### Task 11: Admin UI (`public/admin-mto.html`)

**Files:**
- Create: `public/admin-mto.html`
- Modify: `public/admin.html` (add one nav link)

**Interfaces:**
- Consumes: the four routes from Task 10, plus `POST /api/admin/mto/sync-now` from Task 8. Follows the existing `public/admin.html` conventions: vanilla HTML + an inline `<script type="module">`, `fetch()` with a Bearer token read the same way `admin.html` already does (check the top of `admin.html` for how it obtains `accessToken` before writing this file, and reuse that exact approach rather than inventing a new one).

- [ ] **Step 1: Add a nav link from the existing admin page**

In `public/admin.html`, add a link near the top of the page body to `admin-mto.html` (e.g. next to the existing page heading), labeled "Made-to-Order Orders".

- [ ] **Step 2: Build the new page**

Create `public/admin-mto.html` with three sections, styled consistently with `admin.html` (reuse its `<style>` block / CSS variables rather than redefining a new visual language):

1. **Settings panel**: two fields (an "Enabled" checkbox, a "Cutover time" datetime input) bound to `GET`/`POST /api/admin/mto/settings`, a "Save" button, and a "Sync now" button that calls `POST /api/admin/mto/sync-now` and displays the returned summary (`ordersCreated`, `ordersUpdated`, or the `skipped`/`reason` if intake isn't enabled yet).
2. **Orders table** (default view): columns Buyer, Receipt/Transaction, Payment State, Needs Attention (reason shown as a badge when true), Last Synced — fetched from `GET /api/admin/mto/orders`, with a checkbox to filter to `needsAttention=true` only. Each row links to `admin-mto.html?order=<id>`.
3. **Order detail view** (shown instead of the table when `?order=` is present in the URL): fetches `GET /api/admin/mto/orders/:id` and renders the order's core fields, a table of raw personalization answers side-by-side with their `mapped_field`, the resolved product snapshot (title/price/state) if present, and any assets as thumbnails (`<img>` pointing at `signedUrl`) with their status. A "Back to orders" link clears `?order=`.

This is a read-only page for this stage — no edit controls beyond the settings panel and the "Sync now" button.

- [ ] **Step 3: Manual verification**

Start the app (`npm start`), log in as an admin, open `/admin.html`, click through to `/admin-mto.html`, confirm: the settings panel loads and can save a cutover time, "Sync now" shows a result, and (once at least one test order exists in Supabase — insert one by hand via the Table Editor for this check) the orders table and detail view render correctly, including a signed asset URL if you attach a test asset row.

- [ ] **Step 4: Commit**

```bash
git add public/admin-mto.html public/admin.html
git commit -m "Add admin screen for made-to-order orders, settings, and sync"
```

---

### Task 12: Manual QA Script

**Files:**
- Create: `docs/qa-made-to-order-intake.md`

Following the existing `docs/qa-full-account-flow.md` pattern (a checklist a human runs by hand against a real or staging environment).

- [ ] **Step 1: Write the QA script**

```markdown
# Manual QA: Made-to-Order Personalization Intake

Run this after any change touching Etsy sync, personalization mapping, or
the made-to-order admin screen. Requires: an admin account, the Etsy seller
connection already set up (`/admin.html` → Etsy status), and the converted
listing's real ID in `ETSY_PRODUCT_LISTING_ID`.

**Before you start:** leave `mto_settings.enabled = false` until the very
last section — every earlier check can be done safely with intake off.

## 1. Settings panel

- [ ] Open `/admin-mto.html`. Confirm "Enabled" is unchecked and "Cutover
      time" is empty (the default from the migration).
- [ ] Set a cutover time in the past few minutes, leave "Enabled" unchecked,
      click Save. Reload the page — confirm the value persisted.

## 2. Sync while disabled

- [ ] Click "Sync now". Confirm the result shown is `skipped: not_enabled`
      and no rows appear in `mto_orders` (check Supabase Table Editor).

## 3. Sync while enabled, against a real test purchase

- [ ] Check "Enabled", Save.
- [ ] Place one real, low-value test purchase of the converted listing,
      filling in whatever personalization questions currently exist on it.
- [ ] Click "Sync now" (don't wait for the 10-minute cron). Confirm the
      result shows `ordersCreated: 1`.
- [ ] In `/admin-mto.html`'s orders table, confirm the new order appears
      with the correct buyer name and "paid" state.
- [ ] Open the order's detail view — confirm every answer you typed appears
      under "raw answers," and any question already in `QUESTION_ID_MAP`
      (or matching a known label) shows the right mapped field.

## 4. Duplicate-safe re-sync

- [ ] Click "Sync now" again immediately. Confirm `ordersCreated: 0` this
      time, and the orders table still shows exactly one row for that
      purchase (no duplicate).

## 5. Cancellation reconciliation

- [ ] Cancel that test order from your Etsy Shop Manager (Orders &
      Shipping).
- [ ] Click "Sync now". Confirm the order's Payment State flips to
      "canceled" and the row is **not** deleted.

## 6. Self-serve guard

- [ ] With `mto_settings.enabled` still true and the cutover time still in
      the past, try to activate a self-serve account
      (`/login.html` → order-number flow) using the **same** test receipt
      number from section 3. Confirm you get the "This order is being
      custom-made for you" message, not account approval.
- [ ] Confirm an **old** receipt number (from before the cutover time —
      use one from a previous, pre-conversion test purchase if you have
      one on file) still activates a self-serve account normally.

## 7. Multiple units and missing info (optional, only if you can test cheaply)

- [ ] If your test purchase can use quantity 2+, confirm that order shows
      "Needs Attention: multiple_units."
- [ ] If you can leave the product-link question blank, confirm that order
      shows "Needs Attention: missing_information."

## After this QA

- [ ] Set `mto_settings.enabled` back to `false` (or leave it on, if this
      was the real go-live run) and confirm the existing self-serve flow
      (`docs/qa-full-account-flow.md`) still passes unaffected.
```

- [ ] **Step 2: Commit**

```bash
git add docs/qa-made-to-order-intake.md
git commit -m "Add manual QA script for made-to-order personalization intake"
```

---

## Self-Review Notes

- **Spec coverage:** every numbered part of the spec (settings/cutover guard, sync engine incl. reconciliation, personalization mapping, asset importer, admin surface, exception reasons, security notes, testing plan) maps to a task above. The one deliberate refinement beyond the spec's literal text: the sync engine's reconciliation pass uses `min_last_modified` (not just `min_created`) so a cancellation/refund on an *older* order is still caught — the spec's Part 2 didn't specify a mechanism for this, and a pure `min_created`-cursor design would have missed it.
- **Vercel Cron correction:** the spec assumed a custom `MTO_CRON_SECRET` header; Vercel Cron only issues GET requests and has no way to set a custom header, so this plan uses Vercel's documented `CRON_SECRET` convention instead (automatic `Authorization: Bearer` injection) and makes the route `GET`, not `POST`. Confirmed against Vercel's current docs that the project is on the Pro plan, so the every-10-minutes schedule from the spec is achievable (Hobby would have capped this at once/day).
- **Etsy field names verified, not assumed:** `property_id`, `value_id`, `formatted_name`, `formatted_value`, and `question_id` on `TransactionVariations`, and `create_timestamp`/`status`/`is_paid`/`name` on `ShopReceipt`, were all checked directly against Etsy's published OpenAPI schema (`https://www.etsy.com/openapi/generated/oas/3.0.0.json`) rather than assumed from the existing code.
- **Placeholder scan:** no `TODO`/`TBD` markers; `QUESTION_ID_MAP` is intentionally empty with an explanation, not a placeholder.
- **Type consistency check:** `deriveOrderFromTransaction`'s output shape (Task 3) is consumed identically by `processReceipt` (Task 6) and by `lib/mtoStore.js`'s `upsertOrder` (Task 8) — field names (`shopId`, `receiptId`, `transactionId`, `listingId`, `quantity`, `buyerEtsyUserId`, `buyerDisplayName`, `receiptCreatedAt`, `paymentState`) match across all three. The `store` interface's method names and signatures are identical between the fake (`lib/mtoTestFakes.js`, Task 6) and the real implementation (`lib/mtoStore.js`, Task 8).
