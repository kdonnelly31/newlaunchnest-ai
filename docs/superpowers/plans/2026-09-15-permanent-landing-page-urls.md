# Permanent Landing Page URLs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every successful "Create Landing Page" click saves the generated page to the database and returns a permanent, public, bookmarkable URL (`/p/:id`) instead of only writing HTML into a throwaway browser tab.

**Architecture:** A new `POST /api/landing-pages` endpoint (in `server.js`) takes over the "generate copy → generate brand color → build HTML" sequence that `public/index.html` currently does client-side, and instead saves a content snapshot to a new `content` column on `landing_pages` plus the `listing_id`. A new public `GET /p/:id` route renders that snapshot as static HTML, forever, with no login required. The rendering logic itself (HTML + CSS, currently built client-side in `public/index.html` via `buildLandingPageDocument`) moves into a new shared, server-safe module, `lib/landingPageTemplate.js`, and is stripped of the social-posting buttons/scripts — those never belonged on a page anyone with the link can open, and are already broken today regardless (see spec). `public/index.html`'s `createLandingPage()` is rewritten to call the new endpoint and navigate its already-open tab to the returned URL, instead of building and writing HTML itself.

**Tech Stack:** Node.js (ESM), Express, Supabase (`@supabase/supabase-js`), `@anthropic-ai/sdk`, Node's built-in test runner (`node --test`) — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-15-permanent-landing-page-urls-design.md`

## Global Constraints

- ESM only (`"type": "module"` in `package.json`) — use `import`/`export`, not `require`.
- No new npm dependencies.
- Follow existing `server.js` conventions: route handlers wrapped in `try/catch`, errors logged with `console.error` then returned as `{ error: message }` JSON with an appropriate status code — except `GET /p/:id`, which is visited directly by real browsers and must return plain HTML (not JSON) on every path, including "not found."
- The public `/p/:id` page renders only static marketing content (hero, story, highlights, stats, gallery, final CTA, footer) — **no social-posting buttons or scripts, ever**, per the resolved design decision. Fixing social posting is separate future work, to be done inside the authenticated app, not on this public page.
- `content` is a frozen snapshot taken at creation time (never re-fetched from Etsy on view) — `GET /p/:id` must never call `etsyFetch` or any other external API.
- URLs are plain `/p/<uuid>` for this pass — no custom slugs (resolved design decision).
- This project has no Supabase CLI wired up — migrations are plain SQL files, applied by hand in the Supabase Dashboard → SQL Editor.
- The service-role Supabase client (`supabaseAdmin`) is server-side only — never expose it or its results unfiltered to the browser.

---

### Task 1: Database migration — snapshot columns on `landing_pages`

**Files:**
- Create: `supabase/migrations/20260915000000_landing_page_content.sql`

**Interfaces:**
- Produces: `public.landing_pages.listing_id` (`bigint`, nullable) and `public.landing_pages.content` (`jsonb`, nullable) — consumed by the insert in Task 3 and the read in Task 4.

This project has no Supabase CLI wired up (migrations are plain SQL files, applied by hand) — so "testing" this task means running the SQL yourself and confirming it applies cleanly, not an automated test.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260915000000_landing_page_content.sql`:

```sql
-- Extends the existing landing_pages table (rather than adding a new one)
-- to hold a frozen content snapshot so /p/:id can serve a permanent public
-- page without re-fetching Etsy or the seller's data on every view.
alter table public.landing_pages
  add column listing_id bigint,
  add column content jsonb;
```

- [ ] **Step 2: Apply and verify the migration**

In the Supabase Dashboard → SQL Editor, paste and run the file's contents against your project (the same way the earlier migrations in `supabase/migrations/` were applied). Then verify:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'landing_pages'
order by ordinal_position;
```

Expected: rows for `id`, `user_id`, `created_at` (existing), plus new `listing_id` (`bigint`, nullable) and `content` (`jsonb`, nullable).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260915000000_landing_page_content.sql
git commit -m "Add listing_id and content snapshot columns to landing_pages"
```

---

### Task 2: Server-safe landing page rendering module

**Files:**
- Create: `lib/landingPageTemplate.js`
- Test: `lib/landingPageTemplate.test.js`

**Interfaces:**
- Produces:
  - `escapeHtml(value: unknown): string`
  - `renderLandingPageDocument({ listing, copy, price, colors }): string` — full standalone HTML document. `listing` is a raw Etsy listing object (from `etsyFetch(...includes=Images,Shop)`); `copy` is whatever `generateLandingCopy` returns (`{ eyebrow, headline, subheadline, story, highlights, cta, socialPosts }`); `price` is a string like `"18.00"` or `null`; `colors` is `{ accent: string, accentWarm: string } | null`.
  - `renderNotFoundPage(): string` — full standalone HTML document for an unknown/bad `/p/:id`.
- Consumes: nothing from other tasks (pure functions, no I/O). This is the module both Task 3 (to build the snapshot's eventual render) and Task 4 (to serve it) will import.

The browser's existing `buildLandingPageDocument`/`renderLandingPage` (in `public/index.html`) can't be reused as-is on the server: they call `document.getElementById('lp-styles').textContent` and use a DOM-based `escapeHtml` (`document.createElement('div')`) — neither exists in Node. This task rebuilds the same visual output as a self-contained Node module, moving the CSS out of `public/index.html`'s `<style id="lp-styles">` block and dropping every rule that only existed for the close-tab button and social-posting cards (`.lp-close*`, `.lp-social*`, `.lp-copy-btn`, `.lp-pin-*`) — those elements are never rendered here.

- [ ] **Step 1: Write the failing test**

Create `lib/landingPageTemplate.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderLandingPageDocument, renderNotFoundPage } from './landingPageTemplate.js';

test('escapeHtml escapes HTML-significant characters', () => {
  assert.equal(
    escapeHtml(`<script>alert("hi") & 'bye'</script>`),
    '&lt;script&gt;alert(&quot;hi&quot;) &amp; &#39;bye&#39;&lt;/script&gt;',
  );
});

test('escapeHtml treats null/undefined as an empty string', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

const sampleListing = {
  title: 'Hand-thrown Ceramic Mug',
  url: 'https://www.etsy.com/listing/123/mug',
  quantity: 4,
  num_favorers: 12,
  images: [{
    url_fullxfull: 'https://img.etsystatic.com/full.jpg',
    url_570xN: 'https://img.etsystatic.com/570.jpg',
  }],
  price: { amount: 1800, divisor: 100, currency_code: 'USD' },
  shop: {
    shop_name: 'ClayAndCo',
    url: 'https://www.etsy.com/shop/ClayAndCo',
    review_average: 4.9,
    review_count: 210,
    transaction_sold_count: 900,
  },
};

const sampleCopy = {
  eyebrow: 'HANDCRAFTED',
  headline: 'A Mug Worth Waking Up For',
  subheadline: 'Thrown by hand, one at a time.',
  story: ['Every piece starts as a lump of clay.', 'No two mugs are exactly alike.'],
  highlights: ['Dishwasher safe', 'Made to order', 'Ships in 3 days'],
  cta: 'Get Yours on Etsy',
  socialPosts: [],
};

test('renderLandingPageDocument includes headline, story, highlights, price, and CTA link', () => {
  const html = renderLandingPageDocument({ listing: sampleListing, copy: sampleCopy, price: '18.00', colors: null });
  assert.match(html, /A Mug Worth Waking Up For/);
  assert.match(html, /Every piece starts as a lump of clay\./);
  assert.match(html, /Dishwasher safe/);
  assert.match(html, /\$18\.00/);
  assert.match(html, /href="https:\/\/www\.etsy\.com\/listing\/123\/mug"/);
});

test('renderLandingPageDocument never includes social-posting buttons or scripts', () => {
  const html = renderLandingPageDocument({ listing: sampleListing, copy: sampleCopy, price: '18.00', colors: null });
  assert.doesNotMatch(html, /Post to Pinterest/);
  assert.doesNotMatch(html, /Post to Facebook/);
  assert.doesNotMatch(html, /Post to Instagram/);
  assert.doesNotMatch(html, /Post to TikTok/);
  assert.doesNotMatch(html, /authedFetch/);
  assert.doesNotMatch(html, /lp-close/);
});

test('renderLandingPageDocument applies custom accent colors when provided', () => {
  const html = renderLandingPageDocument({
    listing: sampleListing, copy: sampleCopy, price: '18.00',
    colors: { accent: '#003030', accentWarm: '#738d8d' },
  });
  assert.match(html, /--lp-accent: #003030;/);
  assert.match(html, /--lp-accent-warm: #738d8d;/);
});

test('renderLandingPageDocument escapes untrusted listing text', () => {
  const maliciousListing = { ...sampleListing, title: '<img src=x onerror=alert(1)>' };
  const html = renderLandingPageDocument({ listing: maliciousListing, copy: sampleCopy, price: '18.00', colors: null });
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
});

test('renderNotFoundPage renders a plain HTML page, not JSON', () => {
  const html = renderNotFoundPage();
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /doesn't exist/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test lib/landingPageTemplate.test.js`
Expected: FAIL — `Cannot find module './landingPageTemplate.js'`.

- [ ] **Step 3: Write the implementation**

Create `lib/landingPageTemplate.js`:

```js
// Server-safe HTML escaping. public/index.html's escapeHtml relies on
// document.createElement('div'), which doesn't exist in Node — this is a
// plain regex equivalent.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Moved out of public/index.html's <style id="lp-styles"> block. The rules
// that only existed for the close-tab button and social-posting cards
// (.lp-close*, .lp-social*, .lp-copy-btn, .lp-pin-*) are dropped — this
// module never renders those elements.
export const LP_STYLES = `
  .lp-root {
    --lp-paper: #F8F5EF;
    --lp-ink: #1D1B17;
    --lp-ink-soft: #57534A;
    --lp-accent: #2E4636;
    --lp-accent-warm: #C79A53;
    --lp-line: #E4DECE;
    background: var(--lp-paper);
    color: var(--lp-ink);
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    min-height: 100vh;
  }
  .lp-root .lp-display { font-family: "Fraunces", Georgia, serif; }
  .lp-root .lp-mono { font-family: "JetBrains Mono", ui-monospace, monospace; }

  .lp-hero {
    display: grid;
    grid-template-columns: 1.05fr 1fr;
    gap: 4.5rem;
    align-items: center;
    max-width: 1160px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem 5rem;
  }
  .lp-hero-media { position: relative; }
  .lp-hero-media img {
    width: 100%;
    aspect-ratio: 4 / 5;
    object-fit: cover;
    border-radius: 3px;
    background: #eee7d9;
  }
  .lp-price-tag {
    position: absolute;
    left: -1.1rem;
    bottom: -1.1rem;
    background: var(--lp-paper);
    border: 1px solid var(--lp-ink);
    box-shadow: 5px 5px 0 var(--lp-accent-warm);
    padding: .65rem 1.1rem .65rem 2rem;
    font-size: .95rem;
    font-weight: 500;
  }
  .lp-price-tag::before {
    content: "";
    position: absolute;
    left: .7rem;
    top: 50%;
    transform: translateY(-50%);
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1.5px solid var(--lp-ink);
    background: var(--lp-paper);
  }
  .lp-price-tag .lp-currency { color: var(--lp-ink-soft); font-size: .75rem; margin-left: .3rem; }

  .lp-eyebrow {
    display: inline-block;
    font-family: "JetBrains Mono", monospace;
    font-size: .72rem;
    letter-spacing: .09em;
    color: var(--lp-accent);
    border: 1px solid var(--lp-accent);
    border-radius: 999px;
    padding: .3rem .8rem;
    margin-bottom: 1.1rem;
  }
  .lp-headline {
    font-size: clamp(2.2rem, 4.2vw, 3.4rem);
    line-height: 1.05;
    font-weight: 500;
    letter-spacing: -.01em;
    margin: 0 0 1rem;
  }
  .lp-subheadline {
    font-size: 1.1rem;
    line-height: 1.5;
    color: var(--lp-ink-soft);
    margin: 0 0 1.8rem;
    max-width: 34ch;
  }
  .lp-cta {
    display: inline-flex;
    align-items: center;
    gap: .5rem;
    background: var(--lp-accent);
    color: var(--lp-paper);
    text-decoration: none;
    font-weight: 600;
    font-size: .95rem;
    padding: .85rem 1.6rem;
    border-radius: 3px;
    transition: transform .15s ease, box-shadow .15s ease;
  }
  .lp-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(46,70,54,.28); }
  .lp-cta:focus-visible { outline: 2px solid var(--lp-ink); outline-offset: 3px; }
  .lp-stock {
    margin: 1.1rem 0 0;
    font-size: .82rem;
    color: var(--lp-ink-soft);
  }

  .lp-story {
    max-width: 720px;
    margin: 0 auto;
    padding: 1rem 1.75rem 4rem;
  }
  .lp-pullquote {
    font-family: "Fraunces", Georgia, serif;
    font-style: italic;
    font-weight: 500;
    font-size: clamp(1.3rem, 2.4vw, 1.7rem);
    line-height: 1.4;
    color: var(--lp-ink);
    margin: 0 0 1.4rem;
  }
  .lp-story-body p {
    font-size: 1.02rem;
    line-height: 1.75;
    color: var(--lp-ink-soft);
    margin: 0 0 1.1rem;
  }

  .lp-highlights {
    max-width: 1160px;
    margin: 0 auto;
    padding: 1rem 1.75rem 4rem;
  }
  .lp-highlights ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 1.4rem 2rem;
    border-top: 1px solid var(--lp-line);
    padding-top: 1.8rem;
  }
  .lp-highlights li {
    font-size: .95rem;
    line-height: 1.4;
    padding-left: 1.6rem;
    position: relative;
  }
  .lp-highlights li::before {
    content: "";
    position: absolute;
    left: 0;
    top: .3rem;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--lp-accent-warm);
  }

  .lp-stats {
    background: var(--lp-ink);
    color: var(--lp-paper);
    padding: 3rem 1.75rem;
  }
  .lp-stats-inner {
    max-width: 1160px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 2rem;
    text-align: center;
  }
  .lp-stats strong {
    display: block;
    font-family: "Fraunces", Georgia, serif;
    font-size: 2.1rem;
    font-weight: 500;
  }
  .lp-stats span {
    display: block;
    font-size: .8rem;
    color: #C9C4B6;
    margin-top: .3rem;
    text-transform: uppercase;
    letter-spacing: .04em;
  }

  .lp-gallery {
    max-width: 1160px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem;
    display: flex;
    gap: 1rem;
    overflow-x: auto;
  }
  .lp-gallery img {
    width: 220px;
    height: 220px;
    object-fit: cover;
    border-radius: 3px;
    flex: 0 0 auto;
    background: #eee7d9;
  }

  .lp-final-cta {
    text-align: center;
    padding: 4.5rem 1.75rem 5rem;
  }
  .lp-final-cta h2 {
    font-family: "Fraunces", Georgia, serif;
    font-weight: 500;
    font-size: clamp(1.6rem, 3vw, 2.2rem);
    margin: 0 0 1.6rem;
  }

  .lp-footer {
    border-top: 1px solid var(--lp-line);
    text-align: center;
    padding: 1.6rem;
    font-size: .82rem;
    color: var(--lp-ink-soft);
  }
  .lp-footer a { color: var(--lp-ink); }

  @media (prefers-reduced-motion: no-preference) {
    .lp-hero-content > * { animation: lp-rise .6s ease both; }
    .lp-hero-content > *:nth-child(2) { animation-delay: .06s; }
    .lp-hero-content > *:nth-child(3) { animation-delay: .12s; }
    .lp-hero-content > *:nth-child(4) { animation-delay: .18s; }
    .lp-hero-content > *:nth-child(5) { animation-delay: .24s; }
    @keyframes lp-rise {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  }

  @media (max-width: 760px) {
    .lp-hero { grid-template-columns: 1fr; gap: 2.5rem; padding-top: 2rem; }
    .lp-price-tag { position: static; display: inline-block; margin-top: 1rem; box-shadow: none; border: 1px solid var(--lp-ink); }
  }
`;

function renderStats(listing) {
  const stats = [];
  const shop = listing.shop;
  if (shop?.review_average) stats.push([shop.review_average, 'Average rating']);
  if (shop?.review_count) stats.push([shop.review_count.toLocaleString(), 'Shop reviews']);
  if (listing.num_favorers) stats.push([listing.num_favorers.toLocaleString(), 'Favorited by shoppers']);
  if (shop?.transaction_sold_count) stats.push([shop.transaction_sold_count.toLocaleString(), 'Etsy sales']);
  return stats;
}

function renderLandingPageBody({ listing, copy, price }) {
  const heroImage = listing.images?.[0]?.url_fullxfull || listing.images?.[0]?.url_570xN || '';
  const galleryImages = (listing.images || []).slice(1);
  const shop = listing.shop;
  const stats = renderStats(listing);

  return `
    <div class="lp-root">
      <section class="lp-hero">
        <div class="lp-hero-media">
          ${heroImage ? `<img src="${heroImage}" alt="${escapeHtml(listing.title)}" />` : ''}
          ${price ? `<div class="lp-price-tag lp-mono">$${price}<span class="lp-currency">${escapeHtml(listing.price.currency_code)}</span></div>` : ''}
        </div>
        <div class="lp-hero-content">
          <span class="lp-eyebrow">${escapeHtml(copy.eyebrow)}</span>
          <h1 class="lp-headline lp-display">${escapeHtml(copy.headline)}</h1>
          <p class="lp-subheadline">${escapeHtml(copy.subheadline)}</p>
          <a class="lp-cta" href="${listing.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(copy.cta)} →</a>
          <p class="lp-stock">${listing.quantity} in stock${shop ? ` · Handmade by ${escapeHtml(shop.shop_name)}` : ''}</p>
        </div>
      </section>

      <section class="lp-story">
        <p class="lp-pullquote">${escapeHtml(copy.story[0])}</p>
        <div class="lp-story-body">
          ${copy.story.slice(1).map(p => `<p>${escapeHtml(p)}</p>`).join('')}
        </div>
      </section>

      <section class="lp-highlights">
        <ul>
          ${copy.highlights.map(h => `<li>${escapeHtml(h)}</li>`).join('')}
        </ul>
      </section>

      ${stats.length ? `
        <section class="lp-stats">
          <div class="lp-stats-inner">
            ${stats.map(([value, label]) => `
              <div><strong>${value}</strong><span>${escapeHtml(label)}</span></div>
            `).join('')}
          </div>
        </section>
      ` : ''}

      ${galleryImages.length ? `
        <div class="lp-gallery">
          ${galleryImages.map(img => `<img src="${img.url_570xN || img.url_fullxfull}" alt="" loading="lazy" />`).join('')}
        </div>
      ` : ''}

      <section class="lp-final-cta">
        <h2 class="lp-display">Ready to make it yours?</h2>
        <a class="lp-cta" href="${listing.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(copy.cta)} →</a>
      </section>

      <footer class="lp-footer">
        Handcrafted by <a href="${shop?.url || listing.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(shop?.shop_name || 'the seller')}</a> on Etsy
      </footer>
    </div>
  `;
}

export function renderLandingPageDocument({ listing, copy, price, colors }) {
  let styles = LP_STYLES;
  if (colors?.accent && colors?.accentWarm) {
    styles = styles
      .replace(/--lp-accent:\s*#[0-9a-fA-F]{6};/, `--lp-accent: ${colors.accent};`)
      .replace(/--lp-accent-warm:\s*#[0-9a-fA-F]{6};/, `--lp-accent-warm: ${colors.accentWarm};`);
  }
  const bodyHtml = renderLandingPageBody({ listing, copy, price });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(copy.headline)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet" />
<style>${styles}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

export function renderNotFoundPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Page not found</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #F8F5EF;
    color: #1D1B17;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    margin: 0;
    text-align: center;
  }
  .wrap { padding: 2rem; }
  h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
  p { color: #57534A; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>This page doesn't exist</h1>
    <p>The link may be broken, or the page may have been removed.</p>
  </div>
</body>
</html>`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test lib/landingPageTemplate.test.js`
Expected: PASS, all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/landingPageTemplate.js lib/landingPageTemplate.test.js
git commit -m "Add server-safe landing page rendering module"
```

---

### Task 3: `POST /api/landing-pages` endpoint

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `renderLandingPageDocument` is NOT called here (only Task 4 renders); this task only builds and stores the `content` snapshot. Consumes existing `server.js` internals: `anthropic`, `supabaseAdmin`, `etsyFetch(path)`, `generateLandingCopy(listing, platforms)`, `extractAccentColor(imageUrl)` (from `./lib/brandColor.js`, already imported), `SOCIAL_PLATFORMS`, `assertShopAllowed(req, res, shopName)`, `requireApproved` middleware (sets `req.user`, `req.profile`).
- Produces: `POST /api/landing-pages` — request body `{ listingId: string|number, platforms?: string[] }`, response `{ id: string, url: string }` on success (`url` is `/p/<uuid>`).

This re-fetches the listing server-side (via `etsyFetch`) rather than trusting the client-supplied listing payload, since this content is about to become permanent and public — matching how `/api/listing/:listingId` already re-verifies shop ownership via `assertShopAllowed`.

- [ ] **Step 1: Add the endpoint**

In `server.js`, immediately after the existing `app.post('/api/brand-color', ...)` block (currently ending around line 932, right before the `assertShopAllowed` function definition), add:

```js
app.post('/api/landing-pages', requireApproved, async (req, res) => {
  if (!anthropic) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Landing pages are not configured on the server.' });
  }

  const { listingId, platforms } = req.body ?? {};
  if (!listingId) {
    return res.status(400).json({ error: 'Missing listingId.' });
  }
  const resolvedPlatforms = Array.isArray(platforms)
    ? [...new Set(platforms.filter(p => SOCIAL_PLATFORMS.includes(p)))]
    : [];
  if (resolvedPlatforms.length === 0) resolvedPlatforms.push('instagram');

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
      resolvedPlatforms,
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

    const { data: row, error: insertError } = await supabaseAdmin
      .from('landing_pages')
      .insert({ user_id: req.user.id, listing_id: listing.listing_id, content })
      .select('id')
      .single();
    if (insertError) {
      console.error(insertError);
      return res.status(500).json({ error: insertError.message });
    }

    res.json({ id: row.id, url: `/p/${row.id}` });
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
```

- [ ] **Step 2: Manually verify**

There's no existing pattern in this codebase for testing Express routes directly (the `lib/*.test.js` files only test pure functions) — this is the same situation Task 2 of the `etsy-purchase-gating` plan hit, so verify by hand:

1. Run `npm start` (or your usual local run command).
2. Log in as an approved user in the browser, search a shop, open a listing detail page.
3. In the browser console (with the page's own valid session), run:
   ```js
   authedFetch('/api/landing-pages', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ listingId: currentListing.listing_id, platforms: ['instagram'] }),
   }).then(r => r.json()).then(console.log);
   ```
4. Expected: a JSON response like `{ "id": "<uuid>", "url": "/p/<uuid>" }`, with no error.
5. In the Supabase Dashboard → Table Editor, open `landing_pages` and confirm a new row exists with that `id`, a non-null `listing_id`, and a `content` JSON blob containing `listing`, `copy`, `price`, and `colors` keys.
6. Repeat with a `listingId` that doesn't belong to your assigned shop (if you're a non-admin user) and confirm you get the existing `403 "You can only view your own shop."` response, not a new row.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "Add POST /api/landing-pages to persist a landing page snapshot"
```

---

### Task 4: `GET /p/:id` public route

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `renderLandingPageDocument`, `renderNotFoundPage` (from `./lib/landingPageTemplate.js`, Task 2), `supabaseAdmin`.
- Produces: `GET /p/:id` — public, unauthenticated, always responds with `text/html` (never JSON).

Looks the row up via `supabaseAdmin` (the service-role client), deliberately bypassing the owner-only RLS `select` policy on `landing_pages` — this route's entire job is public serving, same reasoning already used for `etsy_seller_connection`. A malformed `:id` (not a valid UUID) makes Postgres return an error rather than an empty result, which is exactly why this checks `error || !row?.content` as a single "show 404" condition instead of only checking for a missing row.

- [ ] **Step 1: Add the import**

At the top of `server.js`, add to the existing imports (near `import { extractAccentColor } from './lib/brandColor.js';`):

```js
import { renderLandingPageDocument, renderNotFoundPage } from './lib/landingPageTemplate.js';
```

- [ ] **Step 2: Add the route**

In `server.js`, add this immediately after the `app.post('/api/landing-pages', ...)` block from Task 3:

```js
app.get('/p/:id', async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).send('Landing pages are not configured on the server.');
  }

  const { data: row, error } = await supabaseAdmin
    .from('landing_pages')
    .select('content')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error || !row?.content) {
    return res.status(404).send(renderNotFoundPage());
  }

  res.set('Content-Type', 'text/html').send(renderLandingPageDocument(row.content));
});
```

- [ ] **Step 3: Manually verify**

1. With the server running, take the `url` returned by Task 3's manual test (e.g. `/p/<uuid>`) and open `http://localhost:3000/p/<uuid>` in a **fresh incognito/unauthenticated browser window** — this is the actual proof the "public" part works, since RLS would silently block a client-side Supabase query but not this server-rendered route.
2. Expected: the landing page renders fully (hero image, headline, story, highlights, stats, gallery, final CTA, footer) with no login prompt.
3. View the page source (Ctrl+U) and confirm there is no "Post to Pinterest/Facebook/Instagram/TikTok" button anywhere and no reference to `authedFetch`.
4. Visit `http://localhost:3000/p/not-a-real-id` and confirm you get a plain HTML "This page doesn't exist" page with a 404 status (check via browser dev tools Network tab), not a JSON error.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Add public GET /p/:id route to serve saved landing pages"
```

---

### Task 5: Rewrite the client to use the new endpoint

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `POST /api/landing-pages` (Task 3) via the existing `authedFetch` helper.
- Produces: no new exports (this is a browser script, not a module) — `createLandingPage()` keeps its existing signature (invoked via the existing `create-landing-btn` click listener) but its implementation changes completely.

This removes the entire client-side HTML-building path — `buildLandingPageDocument`, `renderLandingPage`, `renderSocialPost`, `initPinterestPosting`, `initFacebookPosting`, `initInstagramPosting`, `initTikTokPosting`, the `PLATFORM_LABELS` map, and the `<style id="lp-styles">` block — since the server now owns rendering entirely (Tasks 2–4). `ALL_PLATFORMS` and `escapeHtml` are kept: `ALL_PLATFORMS` is still needed to resolve the `socialSelect` dropdown into a `platforms` array to send, and `escapeHtml` is still used throughout the rest of the page (shop/listing detail rendering) unrelated to landing pages.

- [ ] **Step 1: Track the current listing's id**

In `public/index.html`, find (around line 868):

```js
    let currentListing = null;
```

Replace with:

```js
    let currentListing = null;
    let currentListingId = null;
```

Then find, inside `showListingDetail` (around line 954):

```js
        currentListing = listing;
        detail.innerHTML = renderListingDetail(listing);
```

Replace with:

```js
        currentListing = listing;
        currentListingId = listingId;
        detail.innerHTML = renderListingDetail(listing);
```

- [ ] **Step 2: Rewrite `createLandingPage`**

Find the entire existing `createLandingPage` function (starting around line 1077, `async function createLandingPage() {`) through its closing `}` (ending right before `// Builds a fully self-contained HTML document...` / `function buildLandingPageDocument`).

Replace the whole function with:

```js
    async function createLandingPage() {
      if (!currentListing || !currentListingId) return;
      const btn = document.getElementById('create-landing-btn');
      const originalLabel = btn.textContent;

      const { data: allowance, error: allowanceError } = await window.supabaseClient.rpc(
        'create_landing_page_allowed',
        { p_user_id: window.currentUserId },
      );
      if (allowanceError) {
        status.textContent = 'Could not check your page allowance: ' + allowanceError.message;
        return;
      }
      if (!allowance?.[0]?.allowed) {
        status.textContent = "You've reached your page limit — purchase again to unlock 3 more pages.";
        return;
      }

      // Open the tab synchronously, in direct response to the click — opening
      // it after the awaited fetch below would get blocked as a popup.
      const newTab = window.open('', '_blank');
      if (!newTab) {
        alert('Please allow pop-ups for this site to open the landing page in a new tab.');
        return;
      }
      newTab.document.write('<!DOCTYPE html><title>Loading…</title><body style="font-family:sans-serif;padding:2rem;color:#57534A;">Writing your landing page…</body>');
      newTab.document.close();

      btn.disabled = true;
      btn.textContent = 'Writing your landing page…';

      const platforms = socialSelect.value === 'all' ? ALL_PLATFORMS : [socialSelect.value];

      try {
        const res = await authedFetch('/api/landing-pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId: currentListingId, platforms }),
        });
        const data = await res.json();

        if (!res.ok) {
          newTab.document.body.textContent = data.error || 'Failed to create landing page.';
          return;
        }

        newTab.location.href = data.url;
        window.refreshPagesRemaining();
      } catch (err) {
        newTab.document.body.textContent = 'Failed to reach the server: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    }
```

- [ ] **Step 3: Remove the now-unused rendering functions**

Immediately after the `createLandingPage` function you just replaced, delete these functions entirely, in order: `buildLandingPageDocument`, `renderLandingPage`. Continue deleting through `renderSocialPost`, `initPinterestPosting`, `initFacebookPosting`, `initInstagramPosting`, and `initTikTokPosting` — i.e., delete everything from the comment `// Builds a fully self-contained HTML document...` through the end of `initTikTokPosting`'s closing `}` (originally spanning roughly lines 1172–1543).

Also delete the now-unused `PLATFORM_LABELS` constant (it was only read inside `renderSocialPost`, which you just deleted):

```js
    const PLATFORM_LABELS = {
      tiktok: 'TikTok',
      facebook: 'Facebook',
      instagram: 'Instagram',
      pinterest: 'Pinterest',
    };
```

Leave `const ALL_PLATFORMS = ['tiktok', 'facebook', 'instagram', 'pinterest'];` in place — it's still used by `createLandingPage` above.

- [ ] **Step 4: Remove the landing-page styles and their fonts-only purpose check**

Delete the entire `<style id="lp-styles">...</style>` block from the `<head>` (originally lines 307–663) — that CSS now lives in `lib/landingPageTemplate.js` (Task 2) and is served as part of the `/p/:id` document, not this page. Leave the existing font `<link>` tags at the top of `<head>` (lines 7–9) in place — the main app's own UI (`.lp-display`-independent styles at the top of the file) already uses Fraunces/Inter/JetBrains Mono too.

- [ ] **Step 5: Manually verify the full click-through flow**

1. Run the app locally, log in as an approved user, search a shop, open a listing, and click "✦ Create Landing Page".
2. Expected: a new tab opens immediately showing "Writing your landing page…", then navigates to `/p/<uuid>` and shows the finished page — no browser console errors.
3. Confirm the "pages remaining" indicator in the main app updates afterward (via `window.refreshPagesRemaining()`), exactly as it did before this change.
4. Bookmark or copy the resulting `/p/<uuid>` URL, close the tab, and reopen the URL directly — confirm the exact same page loads again.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "Have Create Landing Page navigate to a saved permanent URL"
```

---

### Task 6: Remove the now-unused legacy endpoints

**Files:**
- Modify: `server.js`

**Interfaces:**
- No interface changes — this only deletes two now-unreachable route handlers. `generateLandingCopy` and `extractAccentColor` (the underlying functions) are untouched and stay in use by `POST /api/landing-pages` (Task 3).

After Task 5, nothing in the codebase calls `POST /api/landing-copy` or `POST /api/brand-color` anymore (confirmed via repo-wide search — only `public/index.html` and `server.js` itself ever referenced those paths). Leaving them in place would mean shipping two dead, unreachable HTTP endpoints.

- [ ] **Step 1: Delete the two route handlers**

In `server.js`, delete the entire `app.post('/api/landing-copy', ...)` block and the entire `app.post('/api/brand-color', ...)` block (the comment directly above `/api/brand-color` explaining the `.etsystatic.com` allowlist goes with it).

- [ ] **Step 2: Confirm nothing else references them**

Run:

```bash
grep -rn "landing-copy\|api/brand-color" --include=*.js --include=*.html .  --exclude-dir=node_modules
```

Expected: no matches in `server.js` or `public/index.html` (matches in `docs/superpowers/specs/*.md` describing the old behavior historically are fine and expected).

- [ ] **Step 3: Run the existing test suite**

Run: `npm test`
Expected: PASS — this change doesn't touch any of the pure functions covered by `lib/*.test.js`.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Remove landing-copy and brand-color endpoints, superseded by /api/landing-pages"
```

---

### Task 7: End-to-end verification against the spec's testing plan

**Files:** none (verification only).

This directly re-runs the spec's own "Testing Plan" section now that every piece is in place together, as a final gate before considering the feature done.

- [ ] **Step 1: Public, unauthenticated view**

Generate a page via the real UI, copy its `/p/<uuid>` URL, and open it in a fresh incognito window with no Supabase session. Confirm it renders fully with no login prompt.

- [ ] **Step 2: No social-posting script**

View-source the same `/p/:id` page and confirm there is no `authedFetch`, no `Post to Pinterest/Facebook/Instagram/TikTok` text, and no `<script>` block containing posting logic anywhere in the document.

- [ ] **Step 3: Allowance behavior unchanged**

As a test user close to their `page_allowance` limit (or after lowering it via the admin panel / `grant-pages` endpoint to a small number), generate pages until you hit the limit. Confirm the "You've reached your page limit…" message still appears at the same count as before this change, and that no new `landing_pages` row is created for the blocked attempt.

- [ ] **Step 4: Bad id handling**

Visit `/p/00000000-0000-0000-0000-000000000000` (a well-formed but nonexistent UUID) and `/p/definitely-not-a-uuid` (malformed). Confirm both return the plain-HTML "This page doesn't exist" page, not a JSON error and not a server crash.
