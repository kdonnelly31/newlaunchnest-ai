# Permanent Landing Page URLs — Design

Date: 2026-09-15
Status: Reviewed by Kim on 2026-09-15 — open questions resolved below, ready for planning/implementation.

## Problem

"Create Landing Page" currently opens a blank browser tab and writes the
generated HTML directly into it (`buildLandingPageDocument` in
`public/index.html`). Nothing is ever saved server-side — the `landing_pages`
table only holds `{id, user_id, created_at}`, purely to count against the
buyer's `page_allowance`. Two consequences:

1. **The page has no URL.** It only exists inside that one tab. It can't be
   bookmarked, pasted into an Etsy shop announcement, or put in a social bio
   — exactly the use case a buyer would want ("use it wherever they want").
2. **Closing the tab destroys it**, but the allowance was already spent. A
   buyer who accidentally closes the tab has permanently burned one of their
   (typically 3, cumulative) pages for nothing.

Both are solved by the same fix: persist the generated page and serve it at
a permanent URL, by default — not as an opt-in extra step.

## Goal

Every successful "Create Landing Page" click results in a row saved to the
database and a stable, public URL (`/p/:id`) that renders the same content
indefinitely, with no login required to view it.

## Non-goals (this pass)

- **Pretty/custom slugs** (e.g. `/p/my-cool-mug` instead of `/p/<uuid>`).
  Nice-to-have, adds slug-collision/sanitization complexity, doesn't block
  the core "shareable permanent link" outcome. Use the row's uuid as the
  slug for now.
- **A "my landing pages" list/dashboard** for buyers to browse their past
  pages. This data model makes that trivial to add later, but nothing today
  asks for it — skip it.
- **Editing or regenerating** an existing page in place. Each click still
  creates one new row/URL and spends one unit of allowance, same as today.
- **Fixing the broader social-posting feature.** Just relocating it out of
  the public artifact (see below) so it isn't broken worse than it already
  is; making it actually functional is separate follow-up work.

## Important finding: social-posting buttons don't belong on a public page

The current generated page embeds "post to Pinterest/Facebook/Instagram/
TikTok" buttons (`initPinterestPosting` etc.), which call `authedFetch` —
but `authedFetch` is only ever defined in the *opener* window's script
(`public/index.html:699`), not in the popped-up tab's own script scope.
Today, clicking any of these buttons throws `ReferenceError: authedFetch is
not defined`. This is a pre-existing bug, unrelated to permanent URLs.

It matters here because once a page is permanently and publicly served,
embedding seller-only controls (backed by a single shared set of
Pinterest/Facebook/Instagram credentials in `.env`) in a document anyone
with the link can open would be a real problem, not just a broken button.

**Recommendation:** the public `/p/:id` page renders *only* the static
marketing content (hero, story, highlights, CTA, price) — no social-posting
script at all. If/when the posting feature gets fixed, it belongs in the
authenticated app (e.g., a panel shown right after generation, in the same
tab that already has a working session), never inside the shared artifact.

## Architecture Overview

1. **`POST /api/landing-pages`** (new, `requireApproved`) replaces today's
   client-side "call `/api/landing-copy`, call `/api/brand-color`, build the
   HTML" sequence. Given `{ listingId, platforms }`, the server:
   - Checks `create_landing_page_allowed` (unchanged RPC).
   - Re-fetches the listing itself via the existing `etsyFetch(...,
     includes=Images,Shop)` + `assertShopAllowed` (rather than trusting a
     client-supplied listing payload for something that's about to become
     permanent, public content).
   - Calls the existing `generateLandingCopy` and `extractAccentColor`
     (unchanged, just moved one level up).
   - Inserts one row into `landing_pages` via `supabaseAdmin`, storing a
     content snapshot (see Data Model below).
   - Returns `{ id, url }`.
2. **`GET /p/:id`** (new, public, no auth) looks the row up via
   `supabaseAdmin` (bypassing the owner-only RLS on purpose — this route's
   entire job is public serving) and renders the static page from the
   stored snapshot. Unknown id → a plain 404 page.
3. **Client (`public/index.html`)**: `createLandingPage()` still opens a
   blank tab synchronously (to dodge the popup blocker, same as today), but
   instead of writing generated HTML into it directly, it calls
   `POST /api/landing-pages` and then does `newTab.location.href =
   data.url` — a real navigation to a real, bookmarkable URL. The direct
   `supabaseClient.from('landing_pages').insert(...)` call goes away; the
   server does the insert now.

## Data Model Changes

New migration, extending the existing `landing_pages` table rather than
adding a new one (one row already = one generated page):

```sql
alter table public.landing_pages
  add column listing_id bigint,
  add column content jsonb;
```

`content` is a single JSONB snapshot with everything `/p/:id` needs to
render, frozen at creation time:

```json
{
  "listing": { "title": "...", "images": [...], "shop": {...}, "tags": [...] },
  "copy": { "eyebrow": "...", "headline": "...", "story": [...], "highlights": [...], "cta": "..." },
  "price": "18.00",
  "colors": { "accent": "#003030", "accentWarm": "#738d8d" }
}
```

**Why a snapshot instead of re-fetching Etsy live on every public view:**
a permanent link should show *permanent* content — not silently change if
the seller edits their listing, and not break if the listing later goes
inactive or is deleted. It also avoids putting public, unauthenticated
traffic on a path that calls the Etsy API (rate-limit exposure).

Columns are added nullable (not `not null`) to keep the migration simple —
enforcement that every *new* row has content lives in the application
(the new endpoint always populates it), not the schema. No RLS policy
changes needed: existing owner-only `select`/`insert` policies stay correct
for any future "my pages" view; the public route reads via the service
role, which already bypasses RLS by design elsewhere in this app (e.g.
`etsy_seller_connection`).

## Error Handling

| Condition | Behavior |
|---|---|
| Over page allowance | Same as today: blocked before any work happens, existing message. |
| Etsy listing fetch fails / wrong shop | Same as today (`assertShopAllowed`, 502/403). |
| Claude copy generation fails | Same as today (502, existing messages). |
| Color extraction fails or finds nothing | Same as today: silently falls back to the default theme — never blocks creation. |
| `GET /p/:id` for an unknown/bad id | Plain 404 HTML page, not a JSON error (real visitors will hit this). |

## Testing Plan

- Manual: generate a page, then open the returned URL in a fresh
  incognito/unauthenticated browser context and confirm it renders fully
  with no login prompt — this is the actual proof the "public" part works,
  since RLS would silently block a client-side Supabase query but not a
  server-rendered route.
- Confirm the social-posting script is absent from `/p/:id`'s HTML output.
- Existing allowance/limit behavior unchanged — spot check the "reached
  your page limit" path still triggers at the same count.

## Open Questions for Kim — Resolved 2026-09-15

1. Dropping the (currently broken) social-posting buttons from the
   generated page, with no immediate replacement: **confirmed fine.** A
   working authenticated-app version is separate follow-up work, to be
   handled after this permanent-URL work ships.
2. Plain `/p/<uuid>` URL shape for v1 vs. holding for a prettier slug:
   **confirmed — ship with plain `/p/<uuid>` now.** Pretty slugs remain a
   later, non-blocking enhancement.

## Out of Scope (separate, future work)

- Pretty slugs.
- A buyer-facing "your landing pages" list.
- Actually fixing social-posting-from-the-generated-page (only relocating
  it out of the public artifact is in scope here).
