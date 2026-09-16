# Social Media Sharing — Design

Date: 2026-09-16
Status: Reviewed by Kim on 2026-09-16 — open questions resolved below, ready for planning/implementation.

## Problem

Sellers currently have no way to promote a landing page on social media from
inside the app. A prior social-posting feature (Pinterest/Facebook/
Instagram/TikTok "post" buttons embedded in the generated page) was removed
during the permanent-URL work (`docs/superpowers/specs/2026-09-15-permanent-landing-page-urls-design.md`)
because it was broken (`authedFetch is not defined`) and, more importantly,
didn't belong on a public, unauthenticated page in the first place.

Claude already writes a per-platform social caption for every landing page
(`generateLandingCopy`'s `socialPosts` field) — today it's generated for
Instagram only (a leftover default from the removed platform-picker
dropdown) and then never shown or used anywhere.

## Goal

From inside the authenticated app, a seller can share any of their landing
pages to Instagram, Facebook, or Pinterest with an AI-written, editable
caption — without leaving the app to log into those platforms, and without
LaunchNestAI storing any social-platform credentials or tokens.

## Non-goals (this pass)

- **OAuth / direct API posting.** Posting directly on a seller's behalf
  requires per-platform app registration, Meta App Review (slow, often
  rejected for small/new apps), and ongoing token storage and refresh. Share
  links accomplish the actual goal (get the page in front of the platform's
  audience) without any of that.
- **TikTok.** TikTok's API and web are built around video; a static landing
  page doesn't fit a share-intent model the way Pinterest/Facebook/Instagram
  images do. Dropped from `SOCIAL_PLATFORMS` for this pass.
- **True one-click Instagram posting.** Meta provides no web URL that opens
  Instagram's composer — this is a platform limitation, not a scoping
  choice. Instagram gets a "copy caption + open image to save" flow instead.
- **Guaranteed one-click image download for Instagram.** Etsy's CDN may not
  set CORS headers permitting a forced cross-origin download; the image
  action opens the image in a new tab (save/long-press) rather than
  promising a `<a download>` that could silently fail.
- **Lazy/on-demand caption generation.** All three platforms' captions are
  generated eagerly at page-creation time (see Architecture Overview) rather
  than on first share, to avoid a new endpoint, a new DB write path, and
  loading states for marginal AI-cost savings.

## Architecture Overview

No new database columns and no new *read* endpoints — the share UI is built
entirely from data a landing page's `content` snapshot already stores once
this ships.

1. **`server.js` — `POST /api/landing-pages`**: drop the client-supplied
   `platforms` field from the request body entirely (dead since the
   dropdown was removed) and always call
   `generateLandingCopy(listing, ['instagram', 'facebook', 'pinterest'])`.
   `SOCIAL_PLATFORMS` drops `'tiktok'`. The response gains a `copy` field
   (`{ id, url, copy }`) so the post-creation share panel (below) has
   captions available without a second fetch.
2. **`lib/landingPageTemplate.js`**: `renderLandingPageDocument` adds
   `og:title`, `og:description`, `og:image`, and `og:url` meta tags to the
   `<head>`. This is load-bearing, not cosmetic: Facebook's share dialog and
   Pinterest's rich-pin preview both pull their preview card from the
   target URL's Open Graph tags, not from anything passed in the share
   link's query string. Without these tags, a shared post shows a blank
   preview.
3. **New `public/shareLinks.js`**: pure, DOM-free functions —
   `buildPinterestShareUrl({ pageUrl, imageUrl, socialPost })`,
   `buildFacebookShareUrl({ pageUrl })`, `formatCaptionForCopy(socialPost)`
   (joins `caption` + `#hashtags`). This is the one place the fiddly,
   easy-to-get-wrong part (URL encoding, hashtag formatting, handling a
   missing image) lives, imported by both pages below instead of duplicated.
4. **`public/my-pages.html`**: each saved-page card gets a "Share" toggle
   that expands a panel (see Per-Platform Behavior) built from that card's
   own `row.content` — already fetched client-side via the existing
   RLS-scoped Supabase query, no new request needed.
5. **`public/index.html`**: the post-creation flow shows the same panel
   inline, in the *opener* window (which has a working authenticated
   session and `authedFetch`) — never inside the popped-up `/p/:id` tab,
   consistent with the prior spec's finding that seller-only controls don't
   belong on the public artifact.

## Per-Platform Behavior

| Platform | Mechanism | Notes |
|---|---|---|
| **Pinterest** | `https://www.pinterest.com/pin/create/button/?url=<pageUrl>&media=<heroImage>&description=<caption>` opened in a popup window. | Real one-click share — Pinterest is the one platform that reliably accepts pre-filled text via URL. `media` is omitted (not sent as a broken/empty param) if the listing has no image. |
| **Facebook** | `https://www.facebook.com/sharer/sharer.php?u=<pageUrl>` opened in a popup window. | Facebook's dialog only accepts a URL — it has not honored caption/quote text params for years (anti-spam). The preview it shows comes entirely from the `og:` tags on `/p/:id`. A "Copy caption" button sits next to Share with a hint to paste the caption into the post box Facebook opens. |
| **Instagram** | No share button. "Copy caption" + "Open image" (new tab, for manual save). | No web URL exists to open Instagram's composer — a platform limitation. Hint text tells the seller to post from the Instagram app. |

Each platform's section in the share panel shows: platform name, an
editable `<textarea>` pre-filled with the AI-written caption + hashtags
(formatted per that platform's convention), and its action buttons. On My
Pages, the panel is collapsed behind the per-card "Share" toggle to avoid
showing three open textareas on every card in a list; on the post-creation
prompt it's open by default, since it's a one-time, one-page moment.

## Error Handling

| Condition | Behavior |
|---|---|
| Clipboard copy fails | Same "Copy failed" text-swap pattern already used by My Pages' existing "Copy link" button. |
| Share popup blocked | Same alert-to-enable-popups pattern already used when the landing-page tab itself gets blocked. |
| Listing has no image | Pinterest URL omits `media`; button still opens with url + description filled in. Instagram's "Open image" action is hidden if there's no image to show. |
| Caption generation fails at creation time | Unchanged — existing `POST /api/landing-pages` error handling (502 with the Anthropic error message) already covers this; requesting 3 platforms instead of 1 doesn't change the failure mode. |

## Testing Plan

- `public/shareLinks.test.js` (new, `node --test`): correct URL encoding of
  special characters in captions/URLs; Pinterest URL omits `media` when no
  image is present; Facebook URL never contains caption text (proving the
  code doesn't rely on a param Facebook silently ignores); hashtag
  formatting handles an empty `hashtags` array.
- `lib/landingPageTemplate.test.js`: new assertions that `og:title`,
  `og:description`, and `og:image` render with correctly escaped values.
- Manual: generate a page, expand its share panel on My Pages, confirm each
  platform's popup opens with the expected pre-filled content; confirm the
  post-creation panel in `public/index.html` shows the same data without an
  extra network request.
- **Caveat, not a gap:** whether Facebook/Pinterest's *own* preview
  rendering looks right can only be verified against a real public URL —
  their crawlers can't reach `localhost`. That check happens after
  deploying, not during local development.

## Open Questions for Kim — Resolved 2026-09-16

1. Which platforms for v1: **Instagram, Facebook, Pinterest** (TikTok
   dropped — video-first, doesn't fit a share-intent model).
2. Posting mechanism: **share-intent links**, not OAuth + direct API
   posting — avoids Meta App Review, token storage, and ongoing per-platform
   API maintenance.
3. Where share controls live: **both** the permanent My Pages list and a
   one-time prompt right after page creation — My Pages is the durable home
   sellers will return to for restocks/re-shares; the post-creation prompt
   is nearly free to add since the data's already in hand at that moment.
4. Caption editability: **editable**, pre-filled in a textarea, not
   read-only — sellers often want to add their own voice/hashtags.
5. Caption generation timing: **eager**, at page-creation time (extends the
   existing single-platform generation to all three) rather than lazy/
   on-demand — avoids a new endpoint, DB write path, and per-share loading
   state for a trivial AI-cost difference.

## Out of Scope (separate, future work)

- OAuth-based direct posting to any platform.
- TikTok support of any kind.
- A forced, guaranteed-reliable one-click image download for Instagram.
- Analytics on share-button clicks or downstream post performance.
