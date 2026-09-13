# Etsy Purchase Gating — Design

Date: 2026-09-13
Status: Approved for planning

## Problem

LaunchNestAI is sold as a digital-download listing on Etsy, delivered as a
hosted web app. Today, anyone can create an account (Supabase email-OTP
login auto-creates a `profiles` row with `status='requested'`), and the
account sits behind a manual approval gate: an admin has to look at the
Etsy sales dashboard themselves and click "Approve" in `/admin.html`. There
is no automated check that a given signup actually bought the product.

## Goal

Automatically verify, at signup time, that the buyer holds a real, paid
Etsy order for the LaunchNestAI listing, and auto-approve them if so — with
the existing manual admin Approve/Decline flow kept as a fallback for edge
cases (the automated check fails for a legitimate reason, Etsy API is down,
etc).

## Non-goals

- Automating `page_allowance` grants for repurchases (stays manual, as today,
  via the existing "Grant Pages" admin action).
- Automating a buyer's *own* `etsy_shop_name` assignment (the shop they'll
  manage with the tool) — stays a manual admin field, unrelated to this work.
- Supporting multiple listings/tiers as "valid purchase" — there is exactly
  one Etsy listing to check against.

## Architecture Overview

Two new capabilities are added to the existing Express + Supabase app:

1. **Etsy seller OAuth connection** (admin, one-time, low-frequency): lets
   the server read *your* shop's receipts (orders). The existing
   `ETSY_API_KEY`/`ETSY_SHARED_SECRET` only grant access to public storefront
   data (listings, shop profiles) — reading actual orders requires an
   OAuth 2.0 token authorized by you as the shop owner, scoped to
   `transactions_r`.
2. **Purchase verification endpoint** (buyer-facing, self-serve): given an
   Etsy receipt (order) number typed in by the buyer, confirms it's a paid
   order containing the LaunchNestAI listing, placed under the buyer's login
   email, and not already claimed by another account — then flips their
   profile to `approved`.

This mirrors the existing TikTok OAuth integration pattern already in
`server.js` (`/auth/tiktok`, `/auth/tiktok/callback`), adapted for Etsy's
OAuth 2.0 + PKCE flow and for token persistence in Supabase (rather than a
tmp file) since this token must survive redeploys and be refreshed
correctly, and reads happen on the buyer-facing critical path.

## Data Model Changes

New migration, `supabase/migrations/<timestamp>_etsy_purchase_verification.sql`:

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

## New Environment Variables

Added to `.env` / `.env.example`:

- `ETSY_SELLER_SHOP_NAME` — your own Etsy shop name (used once, at connect
  time, to resolve your `shop_id` via the existing public
  `findShopByName()` helper — no OAuth needed for that lookup).
- `ETSY_PRODUCT_LISTING_ID` — the numeric listing ID of the LaunchNestAI
  digital-download listing. Any paid receipt containing a transaction for
  this listing ID counts as a valid purchase.
- `ETSY_OAUTH_REDIRECT_URI` — e.g. `http://localhost:3000/auth/etsy/callback`
  in dev, the production URL in Vercel env vars. Must be registered as a
  redirect URI in the Etsy Developer app settings (same app as
  `ETSY_API_KEY`, OAuth enabled for the first time).

No new secret is needed for the OAuth *client* itself: Etsy's v3 OAuth uses
the existing API key (keystring) as the client ID, and PKCE (a
code_verifier/code_challenge pair generated at request time, via Node's
built-in `crypto`) instead of a client secret for the authorization code
exchange.

## Part 1 — Etsy OAuth Connection Flow

New routes in `server.js`, mirroring the TikTok pattern:

- `GET /auth/etsy/connect` — generates a PKCE `code_verifier` (random
  bytes) and `code_challenge` (SHA-256, base64url), writes the verifier to
  a tmp file (same approach as `TIKTOK_TOKEN_FILE`, same rationale:
  os.tmpdir() is writable on Vercel, the project directory isn't), then
  redirects to `https://www.etsy.com/oauth/connect` with `client_id`,
  `redirect_uri`, `scope=transactions_r`, `response_type=code`,
  `code_challenge`, `code_challenge_method=S256`, and a `state` value.
- `GET /auth/etsy/callback` — exchanges the `code` for tokens at
  `https://api.etsy.com/v3/public/oauth/token` (using the stashed
  `code_verifier`), resolves `shop_id` via `findShopByName(ETSY_SELLER_SHOP_NAME)`,
  and upserts the singleton row in `etsy_seller_connection` via
  `supabaseAdmin`. Redirects to `/admin.html?etsy=connected`.
- `GET /api/etsy/status` (admin-only, via `requireAdmin`) — reports whether
  a connection row exists and is healthy, for the admin panel to display.

**Token refresh:** Etsy access tokens last ~1 hour; refresh tokens last
~90 days and **rotate on every use** (Etsy issues a new refresh token each
time). A helper `getValidEtsyToken()` reads the stored row, and if
`expires_at` is within 5 minutes of now, calls the token endpoint with
`grant_type=refresh_token`, then immediately persists the *new*
access+refresh token pair back to the row before returning it. Every
receipt lookup goes through this helper first.

## Part 2 — Purchase Verification Endpoint

`POST /api/verify-purchase`, gated by a new lightweight `requireAuth`
middleware (like `requireApproved` but *without* the status/role check —
it only needs a valid Supabase session, since this is exactly the endpoint
that grants `approved` status).

Request body: `{ "receiptId": "1234567890" }`

Server-side steps, in order (each failure returns a distinct, user-facing
error message and an appropriate HTTP status):

1. **Validate input** — `receiptId` must be present and numeric.
   `400` otherwise.
2. **Already approved?** — if `req.profile.status === 'approved'`, return
   `200 { approved: true }` immediately (idempotent — a buyer refreshing
   the page shouldn't see an error).
3. **Already claimed?** — query `profiles` for an existing row with this
   `etsy_receipt_id` belonging to a *different* user id. If found,
   `409 "This order number has already been used to activate another account."`
4. **Etsy connection available?** — if no row in `etsy_seller_connection`,
   `503 "Purchase verification is temporarily unavailable — contact support."`
   (this is also the fallback path for admin manual approval).
5. **Fetch the receipt** — `getValidEtsyToken()`, then
   `GET /v3/application/shops/{shop_id}/receipts/{receiptId}` with
   `x-api-key: ETSY_API_KEY` and `Authorization: Bearer <access_token>`.
   - `404` from Etsy → `404 "We couldn't find that order number — double-check it and try again."`
   - Any other non-OK response → `502` with a generic retry message.
6. **Paid?** — `receipt.is_paid !== true` → `422 "That order hasn't completed payment yet."`
7. **Right listing?** — none of `receipt.transactions[].listing_id` equals
   `ETSY_PRODUCT_LISTING_ID` → `422 "That order doesn't include the LaunchNestAI product."`
8. **Right buyer?** — `receipt.buyer_email` (case-insensitive) does not
   match the logged-in user's email → `422 "That order was placed under a
   different email address. Log in with the email you used at checkout,
   or contact support."`
9. **Approve** — via `supabaseAdmin` (service role, since a user can't
   grant themselves `approved` under RLS), update the profile:
   `status = 'approved'`, `etsy_receipt_id = receiptId`,
   `purchase_verified_at = now()`. Return `200 { approved: true }`.

## Frontend Changes

- **`public/index.html`** — the existing "Almost there, awaiting approval"
  block (rendered when `status !== 'approved'` and not admin) is replaced
  with a small form: an input for the Etsy order number, a submit button,
  and an error/status area. On success, reload the page (the now-approved
  profile takes over the normal flow). Errors from the endpoint are shown
  verbatim (they're already written to be buyer-facing).
- **`public/admin.html`** — a small "Etsy connection" status line at the
  top (via `/api/etsy/status`): "Connected to shop X" or a "Connect Etsy"
  button linking to `/auth/etsy/connect` if not connected. Existing
  Approve/Decline/Grant Pages controls are unchanged.

## Security Notes

- The `etsy_seller_connection` table is RLS-locked with no policies at
  all — only the service-role key (server-side only, never sent to a
  browser) can read or write it, same pattern as the rest of the admin
  data path in this app.
- `requireAuth` (new) intentionally does *not* check `status`/`role` — it's
  the one endpoint whose entire job is to move a user out of `requested`.
  It still requires a valid, non-expired Supabase session token, so an
  anonymous caller can't call it at all.
- The email-match check (step 8) is the main anti-sharing control: knowing
  someone else's order number (e.g. from a leaked screenshot) isn't enough
  without also controlling the email address the order was placed under.
- Rate limiting / brute-forcing receipt IDs: out of scope for this pass,
  same risk profile as the app's other unauthenticated-adjacent endpoints
  today. Worth a follow-up if abuse is observed (e.g. cap attempts per
  account).

## Error Handling Summary

| Condition | Status | Buyer-facing message |
|---|---|---|
| Not numeric / missing | 400 | "Enter a valid Etsy order number." |
| Already approved | 200 | (silent success, no message shown) |
| Receipt used on another account | 409 | "This order number has already been used to activate another account." |
| No Etsy connection configured | 503 | "Purchase verification is temporarily unavailable — contact support." |
| Receipt not found | 404 | "We couldn't find that order number — double-check it and try again." |
| Receipt not paid | 422 | "That order hasn't completed payment yet." |
| Wrong listing | 422 | "That order doesn't include the LaunchNestAI product." |
| Wrong email | 422 | "That order was placed under a different email address. Log in with the email you used at checkout, or contact support." |
| Etsy API error | 502 | "Something went wrong checking your order — try again in a moment." |

In every failure case, the buyer stays on the pending screen and can retry,
or you can still manually approve them from `/admin.html`.

## Testing Plan

- Unit-level: PKCE challenge generation, token-refresh-when-near-expiry
  logic, the ordered validation steps in `/api/verify-purchase` (mocking
  the Etsy API responses for each branch in the error table above).
- Manual/integration, against a real Etsy sandbox order or a real low-value
  test purchase: full connect flow, a valid verification, an already-used
  receipt, a wrong-email receipt, a wrong-listing receipt, and a
  simulated expired-access-token call to confirm refresh works.
- Confirm existing flows are untouched: manual Approve/Decline in
  `/admin.html` still works for an unverified account; already-approved
  accounts are unaffected by any of this.

## Out of Scope (separate, unrelated change)

The "show newest listings first" dropdown request is a small, independent
fix: add `sort_on=created&sort_order=desc` to the Etsy
`/shops/{shopId}/listings/active` calls in `getAllActiveListings()`. No
design needed; implemented directly.
