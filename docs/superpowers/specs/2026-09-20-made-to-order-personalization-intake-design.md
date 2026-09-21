# Made-to-Order Personalization Intake — Design

Date: 2026-09-20
Status: Approved for planning

## Problem

LaunchNestAI's Etsy listing (`ETSY_PRODUCT_LISTING_ID`) has just been
converted from an instant-download product (buyer gets self-serve account
access to build their own landing page) to a made-to-order product (buyer
answers personalization questions; LaunchNestAI builds the page for them).
The listing is currently paused while this is built.

The app has no way today to read a buyer's personalization answers, no
concept of a made-to-order "order" distinct from an account signup, and —
critically — its *existing* self-serve activation flow
(`/api/verify-purchase`) would happily grant old-style DIY account access
to anyone who buys the now-converted listing, since it only checks that a
receipt contains the right listing ID, not what kind of offer that listing
currently represents.

This is stage 1 of a larger made-to-order automation effort (brief
generation, AI page generation, quality checks, export, delivery are all
later stages). This stage's only job: get a made-to-order buyer's answers
into the database reliably, safely, and visibly — with a hard guarantee
that new buyers on this listing can no longer fall through into the old
self-serve grant path.

## Goal

- Every paid receipt for `ETSY_PRODUCT_LISTING_ID` created on or after a
  configured cutover time becomes one `mto_orders` row per purchased line
  item, with its personalization answers imported and (where possible)
  matched to the 5 known question fields, its uploaded assets copied into
  private storage, and its promoted product link validated.
- Receipts before the cutover are untouched — existing customer access,
  `claimed_etsy_receipts`, and the self-serve flow keep working exactly as
  they do today.
- After the cutover, `/api/verify-purchase` and the repurchase check can no
  longer grant self-serve access for a receipt on this listing — the buyer
  gets a clear message instead.
- An admin can see every made-to-order order, its raw and matched answers,
  and why anything needs attention, from a new dashboard screen.
- Sync is idempotent and safe to run concurrently (manual "Sync now" +
  scheduled polling) without ever creating duplicate orders.

## Non-goals (later stages)

- Creative briefs, AI page generation, quality checks, versioned approval.
- Export (ZIP) or any Etsy delivery/handoff.
- Any customer-facing screen, form, or message.
- Etsy webhooks — this stage is polling-only, as agreed.
- Editing/correcting imported data — this stage is read-only in the admin UI.

## Architecture Overview

Reuses the existing `etsy_seller_connection` OAuth token (already scoped
`transactions_r`) and the existing public-listing fetch path (`etsyFetch`,
API-key only) — no new Etsy scopes needed. Adds:

1. A settings row (`mto_settings`) holding the on/off switch and cutover
   timestamp, so turning this on is a data change, not a deploy.
2. A guard clause added to the existing verification code path.
3. A polling sync engine (`lib/etsySync.js`) callable both from an admin
   button and a Vercel Cron job, writing into four new tables.
4. A restricted asset downloader (`lib/assetImporter.js`) reusing the
   "validate host/size/type, don't trust the network" posture the rest of
   the app already needs for this kind of thing.
5. A config-driven personalization field mapper (`lib/mtoFieldMapping.js`).
6. Read-only admin routes + a new admin screen, behind the existing
   `requireAdmin` middleware.

## Data Model Changes

New migration, `supabase/migrations/<timestamp>_made_to_order_intake.sql`:

```sql
-- Singleton settings row, same pattern as etsy_seller_connection.
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
  payment_state text not null,        -- 'paid' | 'canceled' | 'refunded'
  fulfillment_status text not null default 'imported',
  needs_attention boolean not null default false,
  attention_reason text,              -- see "Exception reasons" table below
  attention_detail text,
  resolved_listing_id bigint,
  resolved_listing_snapshot jsonb,    -- title/price/currency/status at import time
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, transaction_id)
);
create index mto_orders_needs_attention_idx on public.mto_orders (needs_attention) where needs_attention;
alter table public.mto_orders enable row level security;
-- No policies: service-role only (admin routes use supabaseAdmin, same as
-- the rest of the admin surface in this app).

create table public.mto_personalization_answers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.mto_orders (id) on delete cascade,
  question_id text,
  formatted_name text,
  formatted_value text not null,
  mapped_field text not null default 'unmapped', -- see mapping table below
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
  status text not null default 'pending', -- 'pending' | 'downloaded' | 'failed'
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mto_assets enable row level security;

create table public.mto_sync_state (
  id integer primary key default 1 check (id = 1),
  cursor_min_created timestamptz,
  running_since timestamptz,  -- non-null while a sync is in flight; guards overlap
  updated_at timestamptz not null default now()
);
insert into public.mto_sync_state (id) values (1);
alter table public.mto_sync_state enable row level security;

create table public.mto_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null,        -- 'manual' | 'cron'
  receipts_seen integer not null default 0,
  orders_created integer not null default 0,
  orders_updated integer not null default 0,
  error text
);
alter table public.mto_sync_runs enable row level security;
```

Private Supabase Storage bucket `mto-assets` (not public), object path
`{order_id}/{asset_id}-{filename}`. Accessed only via
`supabaseAdmin.storage` server-side; the admin UI gets short-lived signed
URLs to display thumbnails.

## New Environment Variables

- `MTO_CRON_SECRET` — shared secret the Vercel Cron request must present
  (as a header) to trigger a sync run. Cron requests have no user session,
  so this substitutes for `requireAdmin` on that one route only.

No other new env vars — `ETSY_PRODUCT_LISTING_ID`, `ETSY_API_KEY`, and the
existing `etsy_seller_connection` token cover everything else.

## Part 1 — Cutover Guard on the Existing Self-Serve Flow

In `evaluateReceipt()` (`lib/verifyPurchase.js`), add one more check, run
after the existing "right listing?" check and before approval:

```js
if (madeToOrderEnabled && cutoverAt && receipt.create_timestamp && new Date(receipt.create_timestamp * 1000) >= cutoverAt) {
  return {
    ok: false,
    status: 422,
    message: 'This order is being custom-made for you — check your Etsy messages for updates, or contact support if you have questions.',
  };
}
```

`madeToOrderEnabled`/`cutoverAt` are read from `mto_settings` in
`/api/verify-purchase` and passed in, so `verifyPurchase.js` stays a pure,
easily unit-testable function (matching its current style). The repurchase
path (`/api/check-new-purchase`) gets the same guard, since it also matches
receipts by listing ID.

This is intentionally the *only* change to existing self-serve code in
this stage — everything else is new tables and new routes.

## Part 2 — Sync Engine (`lib/etsySync.js`)

`async function syncMadeToOrderReceipts({ supabaseAdmin, etsyToken, listingId, settings, trigger })`:

1. Take the advisory lock: if `mto_sync_state.running_since` is set and
   recent (< 5 min old, to self-heal from a crashed run), bail out
   immediately — this is what makes manual clicks and the cron overlap-safe.
2. Read `cursor_min_created`; if unset, default to `cutover_at` (bounded
   initial backfill — never scans further back than the cutover).
3. Page through `getShopReceipts` with `min_created = cursor - 1 hour`
   (overlap window) and `was_paid` not restricted (so cancellations and
   refunds are seen too, not just paid-only), capped at a fixed number of
   pages per run to stay inside the serverless function time limit —
   remaining pages are simply picked up on the next run via the cursor.
4. For each receipt with `create_timestamp >= cutover_at`, for each
   `transaction` where `transaction.listing_id === listingId`:
   - Upsert `mto_orders` on `(shop_id, transaction_id)` — insert if new,
     otherwise only refresh `payment_state`, `last_synced_at`, and
     re-derive `needs_attention` (so a later refund/cancellation is
     reflected even on an already-imported order).
   - `quantity > 1` → `needs_attention = true`,
     `attention_reason = 'multiple_units'`.
   - On first insert only: import personalization answers (Part 3),
     resolve the product link (below), and kick off asset downloads
     (Part 4) — never redone on a later sync pass, so operator or later
     brief edits are never clobbered by re-sync.
5. **Product resolution:** for the answer mapped to `product_url`, parse
   it as a URL, require the hostname to be exactly `www.etsy.com` (or
   `etsy.com`), extract the listing id from the path, and confirm it
   resolves via the existing public `etsyFetch`. Store title/price/
   currency/state in `resolved_listing_snapshot`. Missing/unparseable/
   404/inactive → `needs_attention = true`,
   `attention_reason = 'product_unclear'`.
6. Persist the advanced cursor and write the `mto_sync_runs` row only
   after the batch completes — a mid-run crash leaves the old cursor in
   place, and the upserts above make re-processing the same page safe.
7. Release the advisory lock.

Trigger points:
- `POST /api/admin/mto/sync-now` (`requireAdmin`) — runs synchronously,
  returns the `mto_sync_runs` summary.
- `POST /api/admin/mto/sync-cron` — same function, authenticated by
  `MTO_CRON_SECRET` header instead of a session; called every 10 minutes
  via a `vercel.json` `crons` entry.

## Part 3 — Personalization Mapping (`lib/mtoFieldMapping.js`)

A small versioned config, not a database table (so it ships with code
review, like the rest of the app's logic):

```js
export const MAPPING_VERSION = 1;

export const QUESTION_ID_MAP = {
  // filled in with the real question IDs from the listing once known --
  // 2 of the 5 fields are already configured per Kim; the rest are added
  // here as they're set up, no other code change needed.
};

const LABEL_FALLBACK = [
  { field: 'target_customer', pattern: /who (usually )?buys/i },
  { field: 'messaging', pattern: /what should shoppers understand/i },
  { field: 'traffic_source', pattern: /where will you share/i },
  { field: 'product_url', pattern: /which .*product.* (should|does) this .*promote/i },
  { field: 'assets', pattern: /upload your (product photos|brand assets)/i },
];

export function mapAnswer({ questionId, formattedName }) { /* ... */ }
```

`mapAnswer` checks `QUESTION_ID_MAP` first (authoritative), then
`LABEL_FALLBACK` by matching `formattedName` (Etsy's rendering of the
question text) case-insensitively, and returns `'unmapped'` if neither
hits. An order with any `unmapped` answer, or missing the required
`product_url` answer entirely, gets
`needs_attention = true` / `attention_reason = 'unmapped_personalization'`
or `'missing_information'` respectively.

> Implementation note: Etsy's receipt-transaction personalization fields
> (property_id 54) will be double-checked against the current
> [personalization-migration guide](https://developers.etsy.com/documentation/tutorials/personalization-migration/)
> during implementation — `verifyPurchase.js` already reads
> `variation.question_id` / `formatted_value` for the shop-name question,
> which this reuses, but the exact field set is worth confirming isn't
> a shape assumption baked in from a single existing use case.

## Part 4 — Restricted Asset Importer (`lib/assetImporter.js`)

`async function importAsset(url)`:

1. Parse the URL; require `https:`.
2. Resolve the hostname; reject if it resolves to a private/loopback/
   link-local address (basic SSRF guard) — checked again on every
   redirect hop, manual redirect following capped at 3 hops.
3. `HEAD` (or streamed `GET` with early abort) to check `Content-Length`
   (cap ~20MB) and `Content-Type` (allow-list: `image/jpeg`, `image/png`,
   `image/webp`, `image/gif` — explicitly not `image/svg+xml`).
4. Stream the validated bytes into `mto-assets/{order_id}/{asset_id}-{name}`
   via `supabaseAdmin.storage`.
5. On any failure at any step: `mto_assets.status = 'failed'` with a
   specific `failure_reason`, and the *order* gets
   `needs_attention = true` / `attention_reason = 'asset_unavailable'` —
   never blocks import of the rest of that order's data.

## Part 5 — Admin Surface

- `GET /api/admin/mto/orders` (`requireAdmin`) — list, filterable by
  `needs_attention`.
- `GET /api/admin/mto/orders/:id` (`requireAdmin`) — raw answers, mapped
  fields, resolved product snapshot, assets (as signed URLs), sync
  history.
- `GET /api/admin/mto/settings` / `POST /api/admin/mto/settings`
  (`requireAdmin`) — read/set `enabled` + `cutover_at`.
- A new section in the existing admin page: orders table (buyer, listing,
  payment state, attention reason, last synced), a "Sync now" button
  showing the last `mto_sync_runs` result, and the settings fields above.
  Read-only for order data in this stage — no edit/approve controls yet.

## Exception Reasons (this stage)

| `attention_reason` | Meaning | Resolved by |
|---|---|---|
| `missing_information` | Required `product_url` answer absent | Later manual entry or stage-2 brief editor |
| `unmapped_personalization` | An answer didn't match a known question | Extending `QUESTION_ID_MAP`, then a future re-run |
| `asset_unavailable` | A file upload failed to download | Automatic retry on next sync (asset stays `pending`→`failed`, safe to retry) |
| `product_unclear` | Product URL didn't resolve to a real, active listing | Manual correction, later stage |
| `multiple_units` | `quantity > 1` on one transaction | Manual decision, later stage (spec explicitly avoids silently ignoring quantity) |

## Security Notes

- All four new tables: RLS enabled, no policies — service-role only, same
  pattern as `etsy_seller_connection`. No client ever queries them
  directly.
- No buyer contact info is stored — only what Etsy already surfaces as
  semi-public on a receipt (`buyer_display_name`, `buyer_etsy_user_id`),
  consistent with `profiles.etsy_buyer_user_id` already doing the same
  thing today.
- `mto-assets` storage bucket is private; the admin UI only ever sees
  short-lived signed URLs.
- The cron sync route is the only new route not behind `requireAdmin`; it
  checks a constant-time comparison of `MTO_CRON_SECRET` and does nothing
  but call the same function the admin button calls.
- The asset importer's SSRF guard is deliberately layered (scheme +
  resolved-IP range + per-redirect-hop re-check), since this is the one
  place in this stage that fetches a URL supplied by an outside party
  (the buyer, via Etsy) rather than Etsy's own API.

## Testing Plan

`node --test`, no live Etsy/AI/network calls, following the existing
`lib/*.test.js` pattern:

- `lib/mtoFieldMapping.test.js` — question-id match, label-fallback match,
  unmapped case, mapping version stamped on output.
- `lib/assetImporter.test.js` (mocked `fetch`) — rejects private/loopback
  IPs, rejects oversized responses, rejects disallowed content types,
  follows redirects up to the cap and re-validates each hop, succeeds on
  a valid image.
- `lib/etsySync.test.js` (mocked Etsy responses + an in-memory fake of the
  Supabase calls it needs) — fixture receipts covering: multiple
  personalization entries, a custom question label, a file-upload answer,
  a receipt missing an optional field, quantity of 2, the same receipt
  processed twice (idempotent — no duplicate `mto_orders` row, no
  duplicate answers), a receipt dated before `cutover_at` (skipped
  entirely), a paid-then-canceled receipt across two sync runs (payment
  state updates, order not silently deleted), pagination across multiple
  Etsy API pages, and a resumable cursor after a simulated mid-run
  failure.
- `lib/verifyPurchase.test.js` additions — a pre-cutover receipt still
  approves as today; a post-cutover receipt on the same listing is
  rejected with the new message; the guard is a no-op when
  `mto_settings.enabled` is false (so nothing changes before you flip the
  switch).

## Out of Scope (future stages, in order)

1. Creative brief generation from the matched answers + resolved listing.
2. AI page generation + deterministic/visual quality checks.
3. Versioned system approval, export (ZIP), Etsy delivery/handoff.
4. Owner dashboard additions for exceptions, revisions, delivery tracking.
5. Etsy webhooks, once polling is proven in production.
