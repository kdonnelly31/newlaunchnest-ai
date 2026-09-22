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
// module never renders those elements. The share bar below is a new,
// unrelated addition (a copy-link button), not a revival of .lp-close.
export const LP_STYLES = `
  .lp-share-bar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    justify-content: flex-end;
    padding: .9rem 1.5rem;
    background: var(--lp-paper);
    border-bottom: 1px solid var(--lp-line);
  }
  .lp-share-btn {
    display: inline-flex;
    align-items: center;
    gap: .4rem;
    padding: .5rem 1rem;
    border: 1px solid var(--lp-ink);
    border-radius: 999px;
    background: transparent;
    color: var(--lp-ink);
    font-family: "Inter", sans-serif;
    font-size: .82rem;
    font-weight: 600;
    cursor: pointer;
    transition: background .15s ease, color .15s ease;
  }
  .lp-share-btn:hover { background: var(--lp-ink); color: var(--lp-paper); }
  .lp-share-btn:focus-visible { outline: 2px solid var(--lp-accent); outline-offset: 2px; }

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

// Additional rules for the schemaVersion 2 (conversion-story) section renderers.
// Kept separate from LP_STYLES (rather than appended to it) and only included
// in the <style> block when rendering a v2 page, so that v1 pages' rendered
// HTML — including the <style> tag contents — stays byte-for-byte identical
// to what they rendered before this file gained v2 support.
const LP_STYLES_V2 = `
  .lp-section-headline {
    font-size: clamp(1.5rem, 2.6vw, 2rem);
    font-weight: 500;
    text-align: center;
    margin: 0 0 2rem;
  }

  .lp-emotional-centered {
    max-width: 720px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem;
    text-align: center;
  }
  .lp-emotional-centered .lp-story-body p {
    font-size: 1.05rem;
    line-height: 1.75;
    color: var(--lp-ink-soft);
    margin: 0 0 1.1rem;
  }
  .lp-emotional-split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3rem;
    align-items: center;
    max-width: 1160px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem;
  }
  .lp-emotional-media img {
    width: 100%;
    aspect-ratio: 4 / 5;
    object-fit: cover;
    border-radius: 3px;
    background: #eee7d9;
  }
  .lp-emotional-split .lp-story-body p {
    font-size: 1.02rem;
    line-height: 1.75;
    color: var(--lp-ink-soft);
    margin: 0 0 1.1rem;
  }

  .lp-benefits {
    max-width: 1160px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem;
  }
  .lp-benefits-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1.75rem;
  }
  .lp-benefit-card {
    padding: 1.5rem;
    border: 1px solid var(--lp-line);
    border-radius: 4px;
  }
  .lp-benefit-heading {
    font-size: 1.02rem;
    font-weight: 600;
    margin: 0 0 .5rem;
  }
  .lp-benefit-body {
    font-size: .92rem;
    line-height: 1.5;
    color: var(--lp-ink-soft);
    margin: 0;
  }

  .lp-lifestyle {
    max-width: 1160px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem;
  }
  .lp-lifestyle-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1.5rem;
  }
  .lp-lifestyle-item img {
    width: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
    border-radius: 3px;
    background: #eee7d9;
    margin: 0 0 .6rem;
  }
  .lp-lifestyle-item figcaption {
    font-size: .85rem;
    color: var(--lp-ink-soft);
    text-align: center;
  }

  .lp-details {
    max-width: 720px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem;
  }
  .lp-details-list { margin: 0; }
  .lp-details-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: .75rem 0;
    border-bottom: 1px solid var(--lp-line);
  }
  .lp-details-row dt { font-weight: 600; color: var(--lp-ink); }
  .lp-details-row dd { margin: 0; color: var(--lp-ink-soft); text-align: right; }

  .lp-trust {
    max-width: 720px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem;
    text-align: center;
  }
  .lp-trust-body {
    font-size: 1.02rem;
    line-height: 1.65;
    color: var(--lp-ink-soft);
    margin: 0 0 1.4rem;
  }
  .lp-trust-facts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: .6rem;
  }
  .lp-trust-facts li {
    font-family: "JetBrains Mono", monospace;
    font-size: .78rem;
    border: 1px solid var(--lp-accent);
    color: var(--lp-accent);
    border-radius: 999px;
    padding: .35rem .9rem;
  }

  .lp-buyer-intent {
    max-width: 860px;
    margin: 0 auto;
    padding: 3.5rem 1.75rem;
    text-align: center;
  }
  .lp-occasion-chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: .6rem;
  }
  .lp-occasion-chips li {
    font-size: .88rem;
    background: var(--lp-line);
    color: var(--lp-ink);
    border-radius: 999px;
    padding: .45rem 1.1rem;
  }

  .lp-trust-indicators {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: .5rem 1.2rem;
    margin: 1.2rem 0 0;
    padding: 0;
  }
  .lp-trust-indicators li {
    font-size: .82rem;
    color: var(--lp-ink-soft);
    padding-left: 1.1rem;
    position: relative;
  }
  .lp-trust-indicators li::before {
    content: "✓";
    position: absolute;
    left: 0;
    color: var(--lp-accent);
    font-weight: 600;
  }

  .lp-final-cta-image {
    width: 160px;
    height: 160px;
    object-fit: cover;
    border-radius: 3px;
    margin: 0 auto 1.5rem;
    display: block;
    background: #eee7d9;
  }
  .lp-final-cta-support {
    color: var(--lp-ink-soft);
    max-width: 46ch;
    margin: 0 auto 1.8rem;
  }

  @media (max-width: 760px) {
    .lp-emotional-split { grid-template-columns: 1fr; gap: 1.75rem; }
    .lp-details-row { flex-direction: column; gap: .2rem; }
    .lp-details-row dd { text-align: left; }
  }
`;

function getHeroImage(listing) {
  return listing.images?.[0]?.url_fullxfull || listing.images?.[0]?.url_570xN || '';
}

function renderLandingPageBody({ listing, copy, price }) {
  const heroImage = getHeroImage(listing);
  const galleryImages = (listing.images || []).slice(1);
  const shop = listing.shop;

  return `
    <div class="lp-root">
      <div class="lp-share-bar">
        <button type="button" id="lp-share-btn" class="lp-share-btn">Copy link</button>
      </div>

      <section class="lp-hero">
        <div class="lp-hero-media">
          ${heroImage ? `<img src="${escapeHtml(heroImage)}" alt="${escapeHtml(listing.title)}" />` : ''}
          ${price ? `<div class="lp-price-tag lp-mono">$${price}<span class="lp-currency">${escapeHtml(listing.price.currency_code)}</span></div>` : ''}
        </div>
        <div class="lp-hero-content">
          <span class="lp-eyebrow">${escapeHtml(copy.eyebrow)}</span>
          <h1 class="lp-headline lp-display">${escapeHtml(copy.headline)}</h1>
          <p class="lp-subheadline">${escapeHtml(copy.subheadline)}</p>
          <a class="lp-cta" href="${escapeHtml(listing.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(copy.cta)} →</a>
          <p class="lp-stock">${listing.quantity} in stock${shop ? ` · Designed by ${escapeHtml(shop.shop_name)}` : ''}</p>
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

      ${galleryImages.length ? `
        <div class="lp-gallery">
          ${galleryImages.map(img => `<img src="${escapeHtml(img.url_570xN || img.url_fullxfull)}" alt="" loading="lazy" />`).join('')}
        </div>
      ` : ''}

      <section class="lp-final-cta">
        <h2 class="lp-display">Ready to make it yours?</h2>
        <a class="lp-cta" href="${escapeHtml(listing.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(copy.cta)} →</a>
      </section>

      <footer class="lp-footer">
        Designed by <a href="${escapeHtml(shop?.url || listing.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shop?.shop_name || 'the seller')}</a> on Etsy
      </footer>
    </div>
  `;
}

function renderHeroSection(section, imagesById, listing, price) {
  const image = imagesById.get(section.imageId);
  return `
    <section class="lp-hero">
      <div class="lp-hero-media">
        ${image ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(listing.title)}" />` : ''}
        ${price ? `<div class="lp-price-tag lp-mono">$${price}<span class="lp-currency">${escapeHtml(listing.price?.currency_code ?? '')}</span></div>` : ''}
      </div>
      <div class="lp-hero-content">
        ${section.eyebrow ? `<span class="lp-eyebrow">${escapeHtml(section.eyebrow)}</span>` : ''}
        <h1 class="lp-headline lp-display">${escapeHtml(section.headline)}</h1>
        <p class="lp-subheadline">${escapeHtml(section.subheadline)}</p>
        <a class="lp-cta" href="${escapeHtml(listing.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(section.ctaText)} →</a>
        ${section.trustIndicators.length ? `
          <ul class="lp-trust-indicators">
            ${section.trustIndicators.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
          </ul>
        ` : ''}
      </div>
    </section>
  `;
}

function renderEmotionalStorySection(section, imagesById) {
  const image = section.imageId ? imagesById.get(section.imageId) : null;
  const bodyHtml = section.body.map(p => `<p>${escapeHtml(p)}</p>`).join('');
  if (image) {
    return `
      <section class="lp-emotional-split">
        <div class="lp-emotional-media"><img src="${escapeHtml(image.url)}" alt="" loading="lazy" /></div>
        <div>
          <h2 class="lp-section-headline lp-display">${escapeHtml(section.headline)}</h2>
          <div class="lp-story-body">${bodyHtml}</div>
        </div>
      </section>
    `;
  }
  return `
    <section class="lp-emotional-centered">
      <h2 class="lp-section-headline lp-display">${escapeHtml(section.headline)}</h2>
      <div class="lp-story-body">${bodyHtml}</div>
    </section>
  `;
}

function renderBenefitsSection(section) {
  return `
    <section class="lp-benefits">
      <h2 class="lp-section-headline lp-display">${escapeHtml(section.headline)}</h2>
      <div class="lp-benefits-grid">
        ${section.items.map(item => `
          <div class="lp-benefit-card">
            <h3 class="lp-benefit-heading">${escapeHtml(item.heading)}</h3>
            <p class="lp-benefit-body">${escapeHtml(item.body)}</p>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderLifestyleSection(section, imagesById) {
  const items = section.items
    .map(item => ({ ...item, image: imagesById.get(item.imageId) }))
    .filter(item => item.image);
  if (!items.length) return '';
  return `
    <section class="lp-lifestyle">
      <h2 class="lp-section-headline lp-display">${escapeHtml(section.headline)}</h2>
      <div class="lp-lifestyle-grid">
        ${items.map(item => `
          <figure class="lp-lifestyle-item">
            <img src="${escapeHtml(item.image.url)}" alt="" loading="lazy" />
            <figcaption>${escapeHtml(item.caption)}</figcaption>
          </figure>
        `).join('')}
      </div>
    </section>
  `;
}

function renderProductDetailsSection(section) {
  return `
    <section class="lp-details">
      <h2 class="lp-section-headline lp-display">Product Details</h2>
      <dl class="lp-details-list">
        ${section.items.map(item => `
          <div class="lp-details-row">
            <dt>${escapeHtml(item.label)}</dt>
            <dd>${escapeHtml(item.value)}</dd>
          </div>
        `).join('')}
      </dl>
    </section>
  `;
}

function renderTrustSection(section) {
  return `
    <section class="lp-trust">
      <h2 class="lp-section-headline lp-display">${escapeHtml(section.headline)}</h2>
      <p class="lp-trust-body">${section.body.map(p => escapeHtml(p)).join(' ')}</p>
      <ul class="lp-trust-facts">
        ${section.supportingFacts.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
      </ul>
    </section>
  `;
}

function renderBuyerIntentSection(section) {
  return `
    <section class="lp-buyer-intent">
      <h2 class="lp-section-headline lp-display">${escapeHtml(section.headline)}</h2>
      <ul class="lp-occasion-chips">
        ${section.occasions.map(o => `<li>${escapeHtml(o)}</li>`).join('')}
      </ul>
    </section>
  `;
}

function renderFinalCtaSection(section, imagesById, listing) {
  const image = section.imageId ? imagesById.get(section.imageId) : null;
  return `
    <section class="lp-final-cta">
      ${image ? `<img class="lp-final-cta-image" src="${escapeHtml(image.url)}" alt="" loading="lazy" />` : ''}
      <h2 class="lp-display">${escapeHtml(section.headline)}</h2>
      <p class="lp-final-cta-support">${escapeHtml(section.supportingText)}</p>
      <a class="lp-cta" href="${escapeHtml(listing.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(section.ctaText)} →</a>
    </section>
  `;
}

const SECTION_RENDERERS = {
  hero: renderHeroSection,
  emotional_story: renderEmotionalStorySection,
  benefits: renderBenefitsSection,
  lifestyle: renderLifestyleSection,
  product_details: renderProductDetailsSection,
  trust: renderTrustSection,
  buyer_intent: renderBuyerIntentSection,
  final_cta: renderFinalCtaSection,
};

function renderLandingPageBodyV2({ listing, pagePlan, price }) {
  const imagesById = new Map(pagePlan.images.map(img => [img.id, img]));
  const shop = listing.shop;
  const sectionsHtml = pagePlan.sections
    .map(section => SECTION_RENDERERS[section.type](section, imagesById, listing, price))
    .join('');

  return `
    <div class="lp-root">
      <div class="lp-share-bar">
        <button type="button" id="lp-share-btn" class="lp-share-btn">Copy link</button>
      </div>
      ${sectionsHtml}
      <footer class="lp-footer">
        Designed by <a href="${escapeHtml(shop?.url || listing.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shop?.shop_name || 'the seller')}</a> on Etsy
      </footer>
    </div>
  `;
}

export function renderLandingPageDocument({ listing, copy, pagePlan, price, colors, pageUrl, schemaVersion }) {
  let styles = LP_STYLES;
  if (colors?.accent && colors?.accentWarm) {
    styles = styles
      .replace(/--lp-accent:\s*#[0-9a-fA-F]{6};/, `--lp-accent: ${colors.accent};`)
      .replace(/--lp-accent-warm:\s*#[0-9a-fA-F]{6};/, `--lp-accent-warm: ${colors.accentWarm};`);
  }

  const isV2 = schemaVersion === 2;
  if (isV2) {
    styles += LP_STYLES_V2;
  }
  const bodyHtml = isV2
    ? renderLandingPageBodyV2({ listing, pagePlan, price })
    : renderLandingPageBody({ listing, copy, price });

  const heroSection = isV2 ? pagePlan.sections[0] : null;
  const ogTitle = isV2 ? heroSection.headline : copy.headline;
  const ogDescription = isV2 ? heroSection.subheadline : copy.subheadline;
  const heroImage = isV2
    ? (pagePlan.images.find(img => img.id === heroSection.imageId)?.url || getHeroImage(listing))
    : getHeroImage(listing);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(ogTitle)}</title>
<meta property="og:type" content="website" />
<meta property="og:title" content="${escapeHtml(ogTitle)}" />
<meta property="og:description" content="${escapeHtml(ogDescription)}" />
${heroImage ? `<meta property="og:image" content="${escapeHtml(heroImage)}" />` : ''}
${pageUrl ? `<meta property="og:url" content="${escapeHtml(pageUrl)}" />` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet" />
<style>${styles}</style>
</head>
<body>
${bodyHtml}
<script>
document.getElementById('lp-share-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('lp-share-btn');
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(window.location.href);
    btn.textContent = 'Copied!';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => { btn.textContent = original; }, 1500);
});
<\/script>
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
