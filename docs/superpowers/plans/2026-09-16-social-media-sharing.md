# Social Media Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a seller share any of their landing pages to Instagram, Facebook, or Pinterest from inside the authenticated app, using an AI-written, editable caption — via platform share-intent links, with no OAuth, no stored social credentials, and no new database columns.

**Architecture:** A new pure module, `public/shareLinks.js`, builds share URLs and caption text from data landing pages already store. `server.js` is widened to generate a caption for all three platforms (not just Instagram) at page-creation time and to stamp Open Graph tags onto the public `/p/:id` page so Facebook/Pinterest previews render correctly. `public/my-pages.html` and `public/index.html` each get a collapsible "share panel" UI built from `shareLinks.js`, wired to that page's own existing DOM/event patterns.

**Tech Stack:** Node.js (ESM), Express, Supabase (`@supabase/supabase-js`), `@anthropic-ai/sdk`, Node's built-in test runner (`node --test`) — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-social-media-sharing-design.md`

## Global Constraints

- ESM only (`"type": "module"` in `package.json`) — use `import`/`export`, not `require`.
- No new npm dependencies.
- No new database columns, tables, or endpoints for *reading* data — everything the share UI needs comes from the `content` snapshot each landing page already stores.
- Supported platforms for this pass: Instagram, Facebook, Pinterest. TikTok is explicitly out of scope — `SOCIAL_PLATFORMS` drops `'tiktok'`.
- Posting is share-intent links only (opens each platform's own share dialog, pre-filled where the platform allows it) — never OAuth, never a stored access token, never a direct API post.
- Captions are editable in a `<textarea>` before copying/sharing, not read-only.
- `public/shareLinks.js` exports pure, DOM-free functions only (URL/text builders) — no HTML string building. Each page (`public/index.html`, `public/my-pages.html`) builds its own share-panel markup using those functions, matching its own existing CSS/DOM conventions rather than sharing a UI component.
- Landing pages created before this ships only have an Instagram entry in `content.copy.socialPosts` — the UI must degrade gracefully for Facebook/Pinterest on those older rows (via `getSocialPost`'s fallback), not throw or show blank captions.
- Follow existing `server.js` conventions: route handlers wrapped in `try/catch`, errors logged with `console.error` then returned as `{ error: message }` JSON with an appropriate status code.
- This project has no automated test coverage for Express routes or browser DOM/event behavior (confirmed by the prior `permanent-landing-page-urls` plan) — those tasks are verified by hand, the same way. Only pure functions (`public/shareLinks.js`, `lib/landingPageTemplate.js`) get `node --test` coverage.

---

### Task 1: `public/shareLinks.js` — pure share-link and caption builders

**Files:**
- Create: `public/shareLinks.js`
- Test: `public/shareLinks.test.js`

**Interfaces:**
- Produces:
  - `formatCaptionForCopy(socialPost: { platform, title, caption, hashtags }): string`
  - `buildPinterestShareUrl({ pageUrl, imageUrl, socialPost }): string`
  - `buildFacebookShareUrl({ pageUrl }): string`
  - `getSocialPost(copy: { headline, subheadline, socialPosts }, platform: string): { platform, title, caption, hashtags }`
- Consumes: nothing from other tasks (pure functions, no I/O, no DOM). This is the module Tasks 4 and 5 both import.

`getSocialPost` exists because landing pages created before this feature ships only have an Instagram entry in `content.copy.socialPosts` (a leftover from the removed platform-picker dropdown, which always defaulted the server to generating one caption). Without a fallback, opening the share panel on an old page would show a blank/missing caption for Facebook and Pinterest.

- [ ] **Step 1: Write the failing test**

Create `public/shareLinks.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCaptionForCopy, buildPinterestShareUrl, buildFacebookShareUrl, getSocialPost } from './shareLinks.js';

test('formatCaptionForCopy joins caption and hashtags with # prefix', () => {
  const result = formatCaptionForCopy({
    platform: 'instagram', title: null,
    caption: 'A mug worth waking up for.',
    hashtags: ['handmade', 'ceramics'],
  });
  assert.equal(result, 'A mug worth waking up for.\n\n#handmade #ceramics');
});

test('formatCaptionForCopy includes the title when present (Pinterest)', () => {
  const result = formatCaptionForCopy({
    platform: 'pinterest', title: 'Hand-Thrown Ceramic Mug',
    caption: 'Thrown by hand, one at a time.',
    hashtags: ['pottery'],
  });
  assert.equal(result, 'Hand-Thrown Ceramic Mug\n\nThrown by hand, one at a time.\n\n#pottery');
});

test('formatCaptionForCopy omits a blank hashtag line when hashtags is empty', () => {
  const result = formatCaptionForCopy({ platform: 'facebook', title: null, caption: 'Fresh off the wheel.', hashtags: [] });
  assert.equal(result, 'Fresh off the wheel.');
});

test('buildPinterestShareUrl includes url, media, and description, all correctly encoded', () => {
  const url = buildPinterestShareUrl({
    pageUrl: 'https://example.com/p/abc123',
    imageUrl: 'https://img.etsystatic.com/full.jpg',
    socialPost: { platform: 'pinterest', title: null, caption: 'Tea & mugs, made "by hand"', hashtags: [] },
  });
  assert.match(url, /^https:\/\/www\.pinterest\.com\/pin\/create\/button\?/);
  const params = new URL(url).searchParams;
  assert.equal(params.get('url'), 'https://example.com/p/abc123');
  assert.equal(params.get('media'), 'https://img.etsystatic.com/full.jpg');
  assert.equal(params.get('description'), 'Tea & mugs, made "by hand"');
});

test('buildPinterestShareUrl omits the media param when no imageUrl is given', () => {
  const url = buildPinterestShareUrl({
    pageUrl: 'https://example.com/p/abc',
    imageUrl: '',
    socialPost: { platform: 'pinterest', title: null, caption: 'No photo yet', hashtags: [] },
  });
  assert.equal(new URL(url).searchParams.has('media'), false);
});

test('buildFacebookShareUrl only includes the u param, never leaks caption text', () => {
  const url = buildFacebookShareUrl({ pageUrl: 'https://example.com/p/abc' });
  const params = new URL(url).searchParams;
  assert.equal(params.get('u'), 'https://example.com/p/abc');
  assert.equal(Array.from(params.keys()).length, 1);
});

test('getSocialPost returns the matching platform entry when present', () => {
  const copy = {
    headline: 'H', subheadline: 'S',
    socialPosts: [{ platform: 'facebook', title: null, caption: 'FB caption', hashtags: [] }],
  };
  assert.deepEqual(getSocialPost(copy, 'facebook'), { platform: 'facebook', title: null, caption: 'FB caption', hashtags: [] });
});

test('getSocialPost falls back to a generic caption when the platform is missing (older saved pages)', () => {
  const copy = {
    headline: 'A Mug Worth Waking Up For', subheadline: 'Thrown by hand.',
    socialPosts: [{ platform: 'instagram', title: null, caption: 'IG only', hashtags: [] }],
  };
  const result = getSocialPost(copy, 'pinterest');
  assert.equal(result.platform, 'pinterest');
  assert.equal(result.caption, 'A Mug Worth Waking Up For — Thrown by hand.');
  assert.deepEqual(result.hashtags, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test public/shareLinks.test.js`
Expected: FAIL — `Cannot find module './shareLinks.js'`.

- [ ] **Step 3: Write the implementation**

Create `public/shareLinks.js`:

```js
// Pure, DOM-free link/text builders for social sharing. Lives in public/
// (not lib/) because it's imported directly by the browser — Express only
// serves the public/ directory as static files (see server.js's
// `express.static(path.join(__dirname, 'public'))`).

export function formatCaptionForCopy(socialPost) {
  const parts = [];
  if (socialPost.title) parts.push(socialPost.title);
  parts.push(socialPost.caption);
  const hashtagText = (socialPost.hashtags || []).map(tag => `#${tag}`).join(' ');
  if (hashtagText) parts.push(hashtagText);
  return parts.join('\n\n');
}

export function buildPinterestShareUrl({ pageUrl, imageUrl, socialPost }) {
  const params = new URLSearchParams();
  params.set('url', pageUrl);
  if (imageUrl) params.set('media', imageUrl);
  params.set('description', formatCaptionForCopy(socialPost));
  return `https://www.pinterest.com/pin/create/button/?${params.toString()}`;
}

// Facebook's sharer has not honored caption/quote text params for years
// (anti-spam) -- it only ever takes the target URL, then pulls its preview
// card from that URL's Open Graph tags (see lib/landingPageTemplate.js).
export function buildFacebookShareUrl({ pageUrl }) {
  const params = new URLSearchParams();
  params.set('u', pageUrl);
  return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
}

// Falls back to a generic caption built from the page's own headline/
// subheadline for landing pages created before this feature shipped, whose
// stored content.copy.socialPosts only ever has an Instagram entry.
export function getSocialPost(copy, platform) {
  const existing = (copy.socialPosts || []).find(p => p.platform === platform);
  if (existing) return existing;
  return { platform, title: null, caption: `${copy.headline} — ${copy.subheadline}`, hashtags: [] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test public/shareLinks.test.js`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add public/shareLinks.js public/shareLinks.test.js
git commit -m "Add pure share-link and caption builders for social sharing"
```

---

### Task 2: Open Graph tags on `/p/:id`

**Files:**
- Modify: `lib/landingPageTemplate.js`
- Modify: `server.js`
- Test: `lib/landingPageTemplate.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `renderLandingPageDocument` gains an optional `pageUrl` field in its input object — `renderLandingPageDocument({ listing, copy, price, colors, pageUrl })`. When `pageUrl` is omitted, `og:url` is omitted; when the listing has no image, `og:image` is omitted.

Facebook's share dialog and Pinterest's rich-pin preview both read their preview card from the target URL's Open Graph tags, not from anything passed in the share link's query string (see Task 1's `buildFacebookShareUrl` comment). Without these tags, a shared post shows a blank preview — this task is a prerequisite for Tasks 4 and 5 actually looking right when used.

- [ ] **Step 1: Write the failing tests**

In `lib/landingPageTemplate.test.js`, add these two tests (after the existing `'renderLandingPageDocument includes a copy-link button...'` test, before `renderNotFoundPage`'s test):

```js
test('renderLandingPageDocument includes Open Graph tags for link previews', () => {
  const html = renderLandingPageDocument({
    listing: sampleListing, copy: sampleCopy, price: '18.00', colors: null,
    pageUrl: 'https://example.com/p/abc-123',
  });
  assert.match(html, /<meta property="og:title" content="A Mug Worth Waking Up For" \/>/);
  assert.match(html, /<meta property="og:description" content="Thrown by hand, one at a time\." \/>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/img\.etsystatic\.com\/full\.jpg" \/>/);
  assert.match(html, /<meta property="og:url" content="https:\/\/example\.com\/p\/abc-123" \/>/);
});

test('renderLandingPageDocument omits og:image and og:url when there is no image or pageUrl', () => {
  const listingNoImages = { ...sampleListing, images: [] };
  const html = renderLandingPageDocument({ listing: listingNoImages, copy: sampleCopy, price: '18.00', colors: null });
  assert.doesNotMatch(html, /property="og:image"/);
  assert.doesNotMatch(html, /property="og:url"/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test lib/landingPageTemplate.test.js`
Expected: FAIL — the two new tests fail (no `og:` tags exist yet); the other existing tests still pass.

- [ ] **Step 3: Extract a shared hero-image helper**

In `lib/landingPageTemplate.js`, find:

```js
function renderLandingPageBody({ listing, copy, price }) {
  const heroImage = listing.images?.[0]?.url_fullxfull || listing.images?.[0]?.url_570xN || '';
  const galleryImages = (listing.images || []).slice(1);
```

Replace with:

```js
function getHeroImage(listing) {
  return listing.images?.[0]?.url_fullxfull || listing.images?.[0]?.url_570xN || '';
}

function renderLandingPageBody({ listing, copy, price }) {
  const heroImage = getHeroImage(listing);
  const galleryImages = (listing.images || []).slice(1);
```

- [ ] **Step 4: Add the Open Graph tags**

In `lib/landingPageTemplate.js`, find:

```js
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
```

Replace with:

```js
export function renderLandingPageDocument({ listing, copy, price, colors, pageUrl }) {
  let styles = LP_STYLES;
  if (colors?.accent && colors?.accentWarm) {
    styles = styles
      .replace(/--lp-accent:\s*#[0-9a-fA-F]{6};/, `--lp-accent: ${colors.accent};`)
      .replace(/--lp-accent-warm:\s*#[0-9a-fA-F]{6};/, `--lp-accent-warm: ${colors.accentWarm};`);
  }
  const bodyHtml = renderLandingPageBody({ listing, copy, price });
  const heroImage = getHeroImage(listing);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(copy.headline)}</title>
<meta property="og:type" content="website" />
<meta property="og:title" content="${escapeHtml(copy.headline)}" />
<meta property="og:description" content="${escapeHtml(copy.subheadline)}" />
${heroImage ? `<meta property="og:image" content="${escapeHtml(heroImage)}" />` : ''}
${pageUrl ? `<meta property="og:url" content="${escapeHtml(pageUrl)}" />` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com" />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test lib/landingPageTemplate.test.js`
Expected: PASS, all tests green (9 total: 7 existing + 2 new).

- [ ] **Step 6: Pass a real `pageUrl` from the `/p/:id` route**

In `server.js`, find:

```js
    res.set('Content-Type', 'text/html').send(renderLandingPageDocument(row.content));
```

Replace with:

```js
    res.set('Content-Type', 'text/html').send(renderLandingPageDocument({
      ...row.content,
      pageUrl: `${req.protocol}://${req.get('host')}/p/${req.params.id}`,
    }));
```

- [ ] **Step 7: Manually verify**

1. Run `npm start`.
2. Open any existing `/p/<uuid>` landing page in a browser and view source (Ctrl+U).
3. Confirm `<meta property="og:title" ...>`, `og:description`, `og:image`, and `og:url` are present, with `og:url` reading `http://localhost:3000/p/<the same uuid>`.
4. This can't be fully validated (i.e. an actual Facebook/Pinterest preview render) until the app is deployed to a public URL — their crawlers can't reach `localhost`. That's expected; defer that check to after deployment.

- [ ] **Step 8: Commit**

```bash
git add lib/landingPageTemplate.js lib/landingPageTemplate.test.js server.js
git commit -m "Add Open Graph tags to /p/:id for social share previews"
```

---

### Task 3: Generate captions for all 3 platforms at creation time

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `generateLandingCopy` (unchanged function, existing signature).
- Produces: `POST /api/landing-pages`'s success response becomes `{ id, url, copy }` (previously `{ id, url }`) — `copy` is consumed by Task 5's post-creation share panel.

The client-side platform picker was already removed in a prior commit, so `POST /api/landing-pages`'s `platforms` request field is currently dead — every call silently defaults to generating one Instagram-only caption. This task removes that vestige and always generates all three supported platforms.

- [ ] **Step 1: Drop TikTok from `SOCIAL_PLATFORMS` and its guidance**

In `server.js`, find:

```js
const SOCIAL_PLATFORMS = ['tiktok', 'facebook', 'instagram', 'pinterest'];

const PLATFORM_GUIDANCE = {
  tiktok: 'TikTok: a short, punchy, hook-first caption (1-2 sentences) in a casual, trend-aware voice. 5-8 relevant hashtags. No title.',
  facebook: 'Facebook: a warm, conversational caption (2-4 sentences), like a small-shop owner talking to regulars. 0-3 hashtags at most. No title.',
  instagram: 'Instagram: an inviting caption (roughly 60-120 words) with a bit of storytelling, ending on a soft call-to-action. 8-12 relevant hashtags. No title.',
  pinterest: 'Pinterest: a keyword-rich, benefit-led title (under 100 characters) plus a descriptive caption (2-3 sentences) written to surface in search. 3-6 hashtags.',
};
```

Replace with:

```js
const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'pinterest'];

const PLATFORM_GUIDANCE = {
  facebook: 'Facebook: a warm, conversational caption (2-4 sentences), like a small-shop owner talking to regulars. 0-3 hashtags at most. No title.',
  instagram: 'Instagram: an inviting caption (roughly 60-120 words) with a bit of storytelling, ending on a soft call-to-action. 8-12 relevant hashtags. No title.',
  pinterest: 'Pinterest: a keyword-rich, benefit-led title (under 100 characters) plus a descriptive caption (2-3 sentences) written to surface in search. 3-6 hashtags.',
};
```

- [ ] **Step 2: Always request all three platforms**

In `server.js`, inside `app.post('/api/landing-pages', ...)`, find:

```js
  const { listingId, platforms } = req.body ?? {};
  if (!listingId) {
    return res.status(400).json({ error: 'Missing listingId.' });
  }
  const resolvedPlatforms = Array.isArray(platforms)
    ? [...new Set(platforms.filter(p => SOCIAL_PLATFORMS.includes(p)))]
    : [];
  if (resolvedPlatforms.length === 0) resolvedPlatforms.push('instagram');
```

Replace with:

```js
  const { listingId } = req.body ?? {};
  if (!listingId) {
    return res.status(400).json({ error: 'Missing listingId.' });
  }
```

Then find:

```js
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
```

Replace with:

```js
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
```

- [ ] **Step 3: Return `copy` in the response**

In `server.js`, find:

```js
    res.json({ id: row.id, url: `/p/${row.id}` });
```

Replace with:

```js
    res.json({ id: row.id, url: `/p/${row.id}`, copy });
```

- [ ] **Step 4: Manually verify**

1. Run `npm start`, log in as an approved user, open a listing, click "✦ Create Landing Page".
2. In the Supabase Dashboard → Table Editor, open the new `landing_pages` row and confirm `content.copy.socialPosts` has exactly 3 entries, with `platform` values `instagram`, `facebook`, and `pinterest` (no `tiktok`).
3. In the browser console (same page/session), after creating a page, check the network response body for `POST /api/landing-pages` — confirm it includes a top-level `copy` field matching the same `socialPosts`.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "Generate Instagram, Facebook, and Pinterest captions for every landing page"
```

---

### Task 4: Share panel on My Pages

**Files:**
- Modify: `public/my-pages.html`

**Interfaces:**
- Consumes: `formatCaptionForCopy`, `buildPinterestShareUrl`, `buildFacebookShareUrl`, `getSocialPost` (from `public/shareLinks.js`, Task 1).
- Produces: no exports (browser script) — each page card gets a "Share" toggle button revealing a per-platform share panel.

- [ ] **Step 1: Import `shareLinks.js`**

In `public/my-pages.html`, find:

```js
    import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
```

Replace with:

```js
    import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
    import { buildPinterestShareUrl, buildFacebookShareUrl, formatCaptionForCopy, getSocialPost } from './shareLinks.js';
```

- [ ] **Step 2: Let the card wrap onto a second row for the panel**

In `public/my-pages.html`, find:

```css
  .page-card {
    display: flex;
    gap: 1rem;
    align-items: center;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1rem;
  }
```

Replace with:

```css
  .page-card {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1rem;
  }
```

- [ ] **Step 3: Add CSS for the share panel**

In `public/my-pages.html`, find:

```css
  .page-card.unavailable .info h3 {
    color: var(--muted);
  }
```

Replace with:

```css
  .page-card.unavailable .info h3 {
    color: var(--muted);
  }
  .share-panel {
    flex: 1 1 100%;
    margin-top: .75rem;
    padding-top: .75rem;
    border-top: 1px solid var(--border);
    display: grid;
    gap: 1rem;
  }
  .share-platform h4 {
    margin: 0 0 .4rem;
    font-size: .85rem;
  }
  .share-caption {
    width: 100%;
    min-height: 4.5rem;
    padding: .5rem .6rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-family: inherit;
    font-size: .85rem;
    resize: vertical;
    box-sizing: border-box;
  }
  .share-hint {
    margin: .4rem 0 0;
    font-size: .78rem;
    color: var(--muted);
  }
  .share-actions {
    display: flex;
    gap: .5rem;
    margin-top: .5rem;
  }
```

- [ ] **Step 4: Render the share panel per card**

In `public/my-pages.html`, find:

```js
    function renderCard(row) {
```

Insert this new function immediately before it:

```js
    function renderSharePanel(row) {
      const { listing, copy } = row.content;
      const pageUrl = new URL(`/p/${row.id}`, window.location.origin).href;
      const imageUrl = listing?.images?.[0]?.url_fullxfull || listing?.images?.[0]?.url_570xN || '';

      const platforms = [
        { key: 'pinterest', label: 'Pinterest' },
        { key: 'facebook', label: 'Facebook' },
        { key: 'instagram', label: 'Instagram' },
      ];

      return `
        <div class="share-panel" hidden>
          ${platforms.map(({ key, label }) => {
            const post = getSocialPost(copy, key);
            const caption = formatCaptionForCopy(post);
            let actionsHtml = `<button type="button" class="copy-caption-btn" data-platform="${key}">Copy caption</button>`;
            let hint = '';
            if (key === 'pinterest') {
              const shareUrl = buildPinterestShareUrl({ pageUrl, imageUrl, socialPost: post });
              actionsHtml += `<button type="button" class="platform-share-btn" data-url="${escapeHtml(shareUrl)}">Share to Pinterest</button>`;
            } else if (key === 'facebook') {
              const shareUrl = buildFacebookShareUrl({ pageUrl });
              actionsHtml += `<button type="button" class="platform-share-btn" data-url="${escapeHtml(shareUrl)}">Share to Facebook</button>`;
              hint = `<p class="share-hint">Facebook won't let us fill this in for you — click Share, then paste this caption into the post box that opens.</p>`;
            } else {
              if (imageUrl) {
                actionsHtml += `<a class="platform-share-btn" href="${escapeHtml(imageUrl)}" target="_blank" rel="noopener noreferrer">Open image</a>`;
              }
              hint = `<p class="share-hint">Instagram doesn't support posting from a browser — copy the caption, save the image, then post from the Instagram app.</p>`;
            }
            return `
              <div class="share-platform">
                <h4>${label}</h4>
                <textarea class="share-caption" data-platform="${key}">${escapeHtml(caption)}</textarea>
                ${hint}
                <div class="share-actions">${actionsHtml}</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    function renderCard(row) {
```

- [ ] **Step 5: Wire the panel into each card**

In `public/my-pages.html`, find:

```js
      return `
        <div class="page-card">
          ${image ? `<img src="${escapeHtml(image)}" alt="" />` : ''}
          <div class="info">
            <h3>${escapeHtml(title)}</h3>
            <div class="date">Created ${created}</div>
          </div>
          <div class="actions">
            <button type="button" class="copy-btn" data-url="${escapeHtml(url)}">Copy link</button>
            <a class="primary" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">View page →</a>
          </div>
        </div>
      `;
```

Replace with:

```js
      return `
        <div class="page-card">
          ${image ? `<img src="${escapeHtml(image)}" alt="" />` : ''}
          <div class="info">
            <h3>${escapeHtml(title)}</h3>
            <div class="date">Created ${created}</div>
          </div>
          <div class="actions">
            <button type="button" class="copy-btn" data-url="${escapeHtml(url)}">Copy link</button>
            <button type="button" class="share-toggle-btn">Share</button>
            <a class="primary" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">View page →</a>
          </div>
          ${renderSharePanel(row)}
        </div>
      `;
```

- [ ] **Step 6: Handle the new buttons in the delegated click listener**

In `public/my-pages.html`, find:

```js
      grid.addEventListener('click', async (e) => {
        const btn = e.target.closest('.copy-btn');
        if (!btn) return;
        const original = btn.textContent;
        try {
          await navigator.clipboard.writeText(new URL(btn.dataset.url, window.location.origin).href);
          btn.textContent = 'Copied!';
        } catch {
          btn.textContent = 'Copy failed';
        }
        setTimeout(() => { btn.textContent = original; }, 1500);
      });
```

Replace with:

```js
      grid.addEventListener('click', async (e) => {
        const copyLinkBtn = e.target.closest('.copy-btn');
        if (copyLinkBtn) {
          const original = copyLinkBtn.textContent;
          try {
            await navigator.clipboard.writeText(new URL(copyLinkBtn.dataset.url, window.location.origin).href);
            copyLinkBtn.textContent = 'Copied!';
          } catch {
            copyLinkBtn.textContent = 'Copy failed';
          }
          setTimeout(() => { copyLinkBtn.textContent = original; }, 1500);
          return;
        }

        const shareToggleBtn = e.target.closest('.share-toggle-btn');
        if (shareToggleBtn) {
          const panel = shareToggleBtn.closest('.page-card').querySelector('.share-panel');
          panel.hidden = !panel.hidden;
          return;
        }

        const copyCaptionBtn = e.target.closest('.copy-caption-btn');
        if (copyCaptionBtn) {
          const platform = copyCaptionBtn.dataset.platform;
          const textarea = copyCaptionBtn.closest('.share-platform').querySelector(`textarea[data-platform="${platform}"]`);
          const original = copyCaptionBtn.textContent;
          try {
            await navigator.clipboard.writeText(textarea.value);
            copyCaptionBtn.textContent = 'Copied!';
          } catch {
            copyCaptionBtn.textContent = 'Copy failed';
          }
          setTimeout(() => { copyCaptionBtn.textContent = original; }, 1500);
          return;
        }

        const platformShareBtn = e.target.closest('.platform-share-btn[data-url]');
        if (platformShareBtn) {
          const popup = window.open(platformShareBtn.dataset.url, '_blank', 'width=750,height=550');
          if (!popup) {
            alert('Please allow pop-ups for this site to open the share dialog.');
          }
        }
      });
```

- [ ] **Step 7: Manually verify**

1. Run `npm start`, log in, go to My Pages (`/my-pages.html`).
2. Click "Share" on a card — confirm the panel expands showing Pinterest, Facebook, and Instagram sections, each with a pre-filled, editable caption.
3. Edit the Instagram caption text, click its "Copy caption" button, and paste elsewhere — confirm the *edited* text was copied, not the original.
4. Click "Share to Pinterest" — confirm a popup opens to `pinterest.com/pin/create/button` with the description pre-filled.
5. Click "Share to Facebook" — confirm a popup opens to `facebook.com/sharer/sharer.php` with the page URL.
6. For a page whose listing has no images, confirm the Instagram "Open image" link doesn't render (no broken link).
7. If you have a landing page row created before this plan shipped (only an Instagram `socialPosts` entry), open its share panel and confirm Facebook/Pinterest still show a reasonable fallback caption instead of erroring or showing blank text.

- [ ] **Step 8: Commit**

```bash
git add public/my-pages.html
git commit -m "Add a collapsible share panel to each My Pages card"
```

---

### Task 5: Share panel right after page creation

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `formatCaptionForCopy`, `buildPinterestShareUrl`, `buildFacebookShareUrl`, `getSocialPost` (from `public/shareLinks.js`, Task 1); the `copy` field on `POST /api/landing-pages`'s response (Task 3).
- Produces: no exports — `createLandingPage()` shows a share panel in the opener window immediately after a page is successfully created.

This panel renders in the *opener* window (which has `authedFetch` and a live session), never inside the popped-up `/p/:id` tab — consistent with the earlier permanent-URL work's finding that seller-only controls don't belong on the public artifact.

- [ ] **Step 1: Import and expose `shareLinks.js`**

In `public/index.html`, find:

```js
  <script type="module">
    import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

    const configRes = await fetch('/api/config');
```

Replace with:

```js
  <script type="module">
    import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
    import * as shareLinks from './shareLinks.js';

    // Exposed so the plain <script> below (app functionality) can use it —
    // same pattern as window.authedFetch/window.supabaseClient below.
    window.shareLinks = shareLinks;

    const configRes = await fetch('/api/config');
```

- [ ] **Step 2: Add CSS for the share panel**

In `public/index.html`, find:

```css
  .landing-btn:disabled {
    opacity: .6;
    cursor: wait;
  }
```

Replace with:

```css
  .landing-btn:disabled {
    opacity: .6;
    cursor: wait;
  }
  #detail .share-panel {
    margin: 1rem 0;
    display: grid;
    gap: 1rem;
  }
  #detail .share-platform h4 {
    margin: 0 0 .4rem;
    font-size: .9rem;
  }
  #detail .share-caption {
    width: 100%;
    min-height: 4.5rem;
    padding: .5rem .6rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-family: inherit;
    font-size: .85rem;
    resize: vertical;
    box-sizing: border-box;
  }
  #detail .share-hint {
    margin: .4rem 0 0;
    font-size: .78rem;
    color: var(--muted);
  }
  #detail .share-actions {
    display: flex;
    gap: .5rem;
    margin-top: .5rem;
  }
  #detail .platform-share-btn,
  #detail .copy-caption-btn {
    border: 1px solid var(--accent);
    color: var(--accent);
    background: transparent;
    border-radius: 999px;
    padding: .4rem 1rem;
    font-size: .82rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    transition: background .15s ease, color .15s ease;
  }
  #detail .platform-share-btn:hover,
  #detail .copy-caption-btn:hover {
    background: var(--accent);
    color: white;
  }
```

- [ ] **Step 3: Add the panel container to the listing detail markup**

In `public/index.html`, find:

```js
          <div class="detail-actions">
            <a class="detail-url" href="${l.url}" target="_blank" rel="noopener noreferrer">View on Etsy →</a>
            <button id="create-landing-btn" class="landing-btn">✦ Create Landing Page</button>
          </div>

          ${images ? `<div class="images">${images}</div>` : ''}
```

Replace with:

```js
          <div class="detail-actions">
            <a class="detail-url" href="${l.url}" target="_blank" rel="noopener noreferrer">View on Etsy →</a>
            <button id="create-landing-btn" class="landing-btn">✦ Create Landing Page</button>
          </div>
          <div id="share-panel-container"></div>

          ${images ? `<div class="images">${images}</div>` : ''}
```

- [ ] **Step 4: Add the panel-rendering and wiring functions**

In `public/index.html`, find:

```js
    async function createLandingPage() {
```

Insert these two new functions immediately before it:

```js
    function renderSharePanel(pageUrl, listing, copy) {
      const { buildPinterestShareUrl, buildFacebookShareUrl, formatCaptionForCopy, getSocialPost } = window.shareLinks;
      const imageUrl = listing?.images?.[0]?.url_fullxfull || listing?.images?.[0]?.url_570xN || '';

      const platforms = [
        { key: 'pinterest', label: 'Pinterest' },
        { key: 'facebook', label: 'Facebook' },
        { key: 'instagram', label: 'Instagram' },
      ];

      return `
        <div class="share-panel">
          ${platforms.map(({ key, label }) => {
            const post = getSocialPost(copy, key);
            const caption = formatCaptionForCopy(post);
            let actionsHtml = `<button type="button" class="copy-caption-btn" data-platform="${key}">Copy caption</button>`;
            let hint = '';
            if (key === 'pinterest') {
              const shareUrl = buildPinterestShareUrl({ pageUrl, imageUrl, socialPost: post });
              actionsHtml += `<button type="button" class="platform-share-btn" data-url="${escapeHtml(shareUrl)}">Share to Pinterest</button>`;
            } else if (key === 'facebook') {
              const shareUrl = buildFacebookShareUrl({ pageUrl });
              actionsHtml += `<button type="button" class="platform-share-btn" data-url="${escapeHtml(shareUrl)}">Share to Facebook</button>`;
              hint = `<p class="share-hint">Facebook won't let us fill this in for you — click Share, then paste this caption into the post box that opens.</p>`;
            } else {
              if (imageUrl) {
                actionsHtml += `<a class="platform-share-btn" href="${escapeHtml(imageUrl)}" target="_blank" rel="noopener noreferrer">Open image</a>`;
              }
              hint = `<p class="share-hint">Instagram doesn't support posting from a browser — copy the caption, save the image, then post from the Instagram app.</p>`;
            }
            return `
              <div class="share-platform">
                <h4>${label}</h4>
                <textarea class="share-caption" data-platform="${key}">${escapeHtml(caption)}</textarea>
                ${hint}
                <div class="share-actions">${actionsHtml}</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    function wireSharePanel(container) {
      container.addEventListener('click', async (e) => {
        const copyCaptionBtn = e.target.closest('.copy-caption-btn');
        if (copyCaptionBtn) {
          const platform = copyCaptionBtn.dataset.platform;
          const textarea = copyCaptionBtn.closest('.share-platform').querySelector(`textarea[data-platform="${platform}"]`);
          const original = copyCaptionBtn.textContent;
          try {
            await navigator.clipboard.writeText(textarea.value);
            copyCaptionBtn.textContent = 'Copied!';
          } catch {
            copyCaptionBtn.textContent = 'Copy failed';
          }
          setTimeout(() => { copyCaptionBtn.textContent = original; }, 1500);
          return;
        }

        const platformShareBtn = e.target.closest('.platform-share-btn[data-url]');
        if (platformShareBtn) {
          const popup = window.open(platformShareBtn.dataset.url, '_blank', 'width=750,height=550');
          if (!popup) {
            alert('Please allow pop-ups for this site to open the share dialog.');
          }
        }
      });
    }

    async function createLandingPage() {
```

- [ ] **Step 5: Show the panel after a successful creation**

In `public/index.html`, find:

```js
        newTab.location.href = data.url;
        window.refreshPagesRemaining();
```

Replace with:

```js
        newTab.location.href = data.url;
        window.refreshPagesRemaining();

        const shareContainer = document.getElementById('share-panel-container');
        const absolutePageUrl = new URL(data.url, window.location.origin).href;
        shareContainer.innerHTML = renderSharePanel(absolutePageUrl, currentListing, data.copy);
        wireSharePanel(shareContainer);
```

- [ ] **Step 6: Manually verify the full click-through flow**

1. Run `npm start`, log in, search a shop, open a listing, click "✦ Create Landing Page".
2. After the new tab navigates to the finished page, confirm a share panel now appears in the *original* tab (not the popped-up one), below the "Create Landing Page" button, with Pinterest/Facebook/Instagram sections pre-filled.
3. Click "Share to Pinterest" and "Share to Facebook" — confirm both open the expected platform dialog in a popup.
4. Confirm no share panel or share script ever appears if you view-source the popped-up `/p/<uuid>` tab itself.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "Show a social share panel right after a landing page is created"
```

---

### Task 6: End-to-end verification against the spec's testing plan

**Files:** none (verification only).

This re-runs the spec's Testing Plan now that every piece is in place together, as a final gate before considering the feature done.

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: PASS — all tests across `lib/*.test.js` and `public/shareLinks.test.js` green.

- [ ] **Step 2: Fresh-eyes click-through on My Pages**

Open My Pages, expand the share panel on at least one page created *after* Task 3 shipped (all 3 captions AI-generated) and one created *before* it (Instagram-only, relying on `getSocialPost`'s fallback for Facebook/Pinterest). Confirm both look reasonable — no blank captions, no console errors.

- [ ] **Step 3: Confirm Facebook/Pinterest preview readiness**

View-source a `/p/:id` page and confirm `og:title`, `og:description`, `og:image`, and `og:url` are present with real values (not empty strings). Note for Kim: actually seeing Facebook's/Pinterest's rendered preview card requires a public URL — verify that visually after the next deploy, using Facebook's Sharing Debugger or Pinterest's own share flow against the live site.

- [ ] **Step 4: Confirm the public page still has zero seller-only controls**

View-source a `/p/:id` page and confirm there is no `share-panel`, `copy-caption-btn`, `platform-share-btn`, or `authedFetch` anywhere in the output — the only interactive element should be the existing `lp-share-btn` "Copy link" button.
