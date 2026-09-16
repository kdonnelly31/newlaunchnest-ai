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

test('renderLandingPageDocument does not throw for a listing with no images, shop, or price', () => {
  const sparseListing = {
    title: 'Bare Listing',
    url: 'https://www.etsy.com/listing/999/bare',
    quantity: 1,
    num_favorers: 0,
  };
  assert.doesNotThrow(() => {
    renderLandingPageDocument({ listing: sparseListing, copy: sampleCopy, price: null, colors: null });
  });
});

test('renderLandingPageDocument includes a copy-link button that copies the page URL', () => {
  const html = renderLandingPageDocument({ listing: sampleListing, copy: sampleCopy, price: '18.00', colors: null });
  assert.match(html, /id="lp-share-btn"/);
  assert.match(html, /Copy link/);
  assert.match(html, /navigator\.clipboard\.writeText\(window\.location\.href\)/);
});

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

test('renderNotFoundPage renders a plain HTML page, not JSON', () => {
  const html = renderNotFoundPage();
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /doesn't exist/i);
});
