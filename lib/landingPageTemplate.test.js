import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderLandingPageDocument, renderNotFoundPage } from './landingPageTemplate.js';
import { buildImageContentBlocks, validatePagePlan } from './pageStoryGenerator.js';

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

test('renderLandingPageDocument escapes HTML-significant characters in Open Graph tags', () => {
  const copyWithSpecialChars = { ...sampleCopy, headline: 'He said "hello" & left' };
  const html = renderLandingPageDocument({
    listing: sampleListing, copy: copyWithSpecialChars, price: '18.00', colors: null,
    pageUrl: 'https://example.com/p/abc-123',
  });
  assert.match(html, /<meta property="og:title" content="He said &quot;hello&quot; &amp; left" \/>/);
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

// --- schemaVersion 2 (conversion-story) rendering ---

const sampleHeroSection = {
  type: 'hero',
  eyebrow: 'HANDCRAFTED',
  headline: 'A Mug Worth Waking Up For',
  subheadline: 'Thrown by hand, one at a time.',
  imageId: 'Image 1',
  ctaText: 'Get Yours on Etsy',
  trustIndicators: ['Made to order', 'Ships in 3 days'],
};

const sampleFinalCtaSection = {
  type: 'final_cta',
  headline: 'Ready to make it yours?',
  supportingText: 'Every piece ships within 3 days.',
  ctaText: 'Get Yours on Etsy',
  imageId: 'Image 1',
};

const samplePagePlan = {
  productStory: { primaryAudience: 'x', emotionalAngle: 'x', functionalAngle: 'x', primaryBuyerIntent: 'x' },
  images: [{ id: 'Image 1', classification: 'hero', url: 'https://img.etsystatic.com/full.jpg' }],
  sections: [sampleHeroSection, sampleFinalCtaSection],
  socialPosts: [],
};

test('v2: renders the hero section headline, subheadline, CTA, and trust indicators', () => {
  const html = renderLandingPageDocument({
    listing: sampleListing, pagePlan: samplePagePlan, price: '18.00', colors: null, schemaVersion: 2,
  });
  assert.match(html, /A Mug Worth Waking Up For/);
  assert.match(html, /Thrown by hand, one at a time\./);
  assert.match(html, /Made to order/);
  assert.match(html, /href="https:\/\/www\.etsy\.com\/listing\/123\/mug"/);
});

test('v2: renders the final_cta section', () => {
  const html = renderLandingPageDocument({
    listing: sampleListing, pagePlan: samplePagePlan, price: '18.00', colors: null, schemaVersion: 2,
  });
  assert.match(html, /Ready to make it yours\?/);
  assert.match(html, /Every piece ships within 3 days\./);
});

test('v2: renders sections in the order given', () => {
  const plan = {
    ...samplePagePlan,
    sections: [
      sampleHeroSection,
      { type: 'trust', headline: 'Handmade with care', body: ['Every mug is made by hand.'], supportingFacts: ['Small batch'] },
      sampleFinalCtaSection,
    ],
  };
  const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: plan, price: '18.00', colors: null, schemaVersion: 2 });
  const heroIndex = html.indexOf('A Mug Worth Waking Up For');
  const trustIndex = html.indexOf('Handmade with care');
  const ctaIndex = html.indexOf('Ready to make it yours?');
  assert.ok(heroIndex < trustIndex, 'hero should render before trust');
  assert.ok(trustIndex < ctaIndex, 'trust should render before final_cta');
});

test('v2: renders an emotional_story section with a null imageId (no image) without throwing', () => {
  const plan = {
    ...samplePagePlan,
    sections: [
      sampleHeroSection,
      { type: 'emotional_story', headline: 'A quiet ritual', body: ['Every piece starts as a lump of clay.'], imageId: null },
      sampleFinalCtaSection,
    ],
  };
  assert.doesNotThrow(() => {
    const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: plan, price: '18.00', colors: null, schemaVersion: 2 });
    assert.match(html, /A quiet ritual/);
    assert.match(html, /Every piece starts as a lump of clay\./);
  });
});

test('v2: renders a benefits section with 3+ items', () => {
  const plan = {
    ...samplePagePlan,
    sections: [
      sampleHeroSection,
      { type: 'benefits', headline: 'Why you will love it', items: [
        { heading: 'Keeps drinks warm', body: 'Thick stoneware holds heat.' },
        { heading: 'Dishwasher safe', body: 'No hand-washing required.' },
        { heading: 'Made to order', body: 'Thrown fresh for your order.' },
      ] },
      sampleFinalCtaSection,
    ],
  };
  const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: plan, price: '18.00', colors: null, schemaVersion: 2 });
  assert.match(html, /Keeps drinks warm/);
  assert.match(html, /Dishwasher safe/);
  assert.match(html, /Made to order/);
});

test('v2: renders a lifestyle section, matching each item to its classified image', () => {
  const plan = {
    ...samplePagePlan,
    images: [
      { id: 'Image 1', classification: 'hero', url: 'https://img.etsystatic.com/full.jpg' },
      { id: 'Image 2', classification: 'lifestyle', url: 'https://img.etsystatic.com/lifestyle.jpg' },
    ],
    sections: [
      sampleHeroSection,
      { type: 'lifestyle', headline: 'Right at home', items: [{ caption: 'Morning coffee', imageId: 'Image 2' }] },
      sampleFinalCtaSection,
    ],
  };
  const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: plan, price: '18.00', colors: null, schemaVersion: 2 });
  assert.match(html, /Morning coffee/);
  assert.match(html, /https:\/\/img\.etsystatic\.com\/lifestyle\.jpg/);
});

test('v2: renders product_details as a label/value list, with no AI-supplied headline (fixed heading)', () => {
  const plan = {
    ...samplePagePlan,
    sections: [
      sampleHeroSection,
      { type: 'product_details', items: [{ label: 'Material', value: 'Stoneware' }, { label: 'Capacity', value: '12 oz' }] },
      sampleFinalCtaSection,
    ],
  };
  const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: plan, price: '18.00', colors: null, schemaVersion: 2 });
  assert.match(html, /Material/);
  assert.match(html, /Stoneware/);
  assert.match(html, /Capacity/);
  assert.match(html, /12 oz/);
});

test('v2: renders trust and buyer_intent sections', () => {
  const plan = {
    ...samplePagePlan,
    sections: [
      sampleHeroSection,
      { type: 'trust', headline: 'Handmade with care', body: ['Every mug is thrown by hand.'], supportingFacts: ['Small batch', 'Handmade'] },
      { type: 'buyer_intent', headline: 'A gift they will use daily', occasions: ['Housewarming', 'Birthday'] },
      sampleFinalCtaSection,
    ],
  };
  const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: plan, price: '18.00', colors: null, schemaVersion: 2 });
  assert.match(html, /Handmade with care/);
  assert.match(html, /Small batch/);
  assert.match(html, /A gift they will use daily/);
  assert.match(html, /Housewarming/);
});

test('v2: escapes HTML-significant characters in section copy', () => {
  const plan = {
    ...samplePagePlan,
    sections: [
      { ...sampleHeroSection, headline: '<img src=x onerror=alert(1)>' },
      sampleFinalCtaSection,
    ],
  };
  const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: plan, price: '18.00', colors: null, schemaVersion: 2 });
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
});

test('v2: <title> and og:title/og:description use the hero section, not `copy`', () => {
  const html = renderLandingPageDocument({
    listing: sampleListing, pagePlan: samplePagePlan, price: '18.00', colors: null, schemaVersion: 2,
    pageUrl: 'https://example.com/p/abc-123',
  });
  assert.match(html, /<title>A Mug Worth Waking Up For<\/title>/);
  assert.match(html, /<meta property="og:title" content="A Mug Worth Waking Up For" \/>/);
  assert.match(html, /<meta property="og:description" content="Thrown by hand, one at a time\." \/>/);
});

test('v2: og:image uses the hero section\'s classified image URL', () => {
  const html = renderLandingPageDocument({
    listing: sampleListing, pagePlan: samplePagePlan, price: '18.00', colors: null, schemaVersion: 2,
    pageUrl: 'https://example.com/p/abc-123',
  });
  assert.match(html, /<meta property="og:image" content="https:\/\/img\.etsystatic\.com\/full\.jpg" \/>/);
});

test('v2: includes the same share-link button as v1', () => {
  const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: samplePagePlan, price: '18.00', colors: null, schemaVersion: 2 });
  assert.match(html, /id="lp-share-btn"/);
  assert.match(html, /navigator\.clipboard\.writeText\(window\.location\.href\)/);
});

test('a call with no schemaVersion still renders the original v1 template (backward compatibility)', () => {
  const html = renderLandingPageDocument({ listing: sampleListing, copy: sampleCopy, price: '18.00', colors: null });
  assert.match(html, /A Mug Worth Waking Up For/);
  assert.doesNotMatch(html, /lp-benefits-grid/);
});

test('v2 seam: a page plan that went through the real buildImageContentBlocks -> validatePagePlan pipeline renders real image URLs, never an empty src', () => {
  const rawImages = [{ url_fullxfull: 'https://img.etsystatic.com/real-full.jpg', url_570xN: 'https://img.etsystatic.com/real-570.jpg' }];
  const { manifest } = buildImageContentBlocks(rawImages);

  const rawPlanFromAI = {
    productStory: { primaryAudience: 'x', emotionalAngle: 'x', functionalAngle: 'x', primaryBuyerIntent: 'x' },
    images: [{ id: 'Image 1', classification: 'hero' }],
    sections: [
      { type: 'hero', eyebrow: null, headline: 'A Mug Worth Waking Up For', subheadline: 'Thrown by hand.', imageId: 'Image 1', ctaText: 'Get Yours on Etsy', trustIndicators: [] },
      { type: 'final_cta', headline: 'Ready?', supportingText: 'Ships fast.', ctaText: 'Get Yours on Etsy', imageId: 'Image 1' },
    ],
    socialPosts: [{ platform: 'instagram', title: null, caption: 'x', hashtags: [] }],
  };

  const plan = validatePagePlan(rawPlanFromAI, manifest);
  const html = renderLandingPageDocument({ listing: sampleListing, pagePlan: plan, price: '18.00', colors: null, schemaVersion: 2 });

  assert.doesNotMatch(html, /src=""/);
  assert.match(html, /https:\/\/img\.etsystatic\.com\/real-full\.jpg/);
});
