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
          ${heroImage ? `<img src="${escapeHtml(heroImage)}" alt="${escapeHtml(listing.title)}" />` : ''}
          ${price ? `<div class="lp-price-tag lp-mono">$${price}<span class="lp-currency">${escapeHtml(listing.price.currency_code)}</span></div>` : ''}
        </div>
        <div class="lp-hero-content">
          <span class="lp-eyebrow">${escapeHtml(copy.eyebrow)}</span>
          <h1 class="lp-headline lp-display">${escapeHtml(copy.headline)}</h1>
          <p class="lp-subheadline">${escapeHtml(copy.subheadline)}</p>
          <a class="lp-cta" href="${escapeHtml(listing.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(copy.cta)} →</a>
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
          ${galleryImages.map(img => `<img src="${escapeHtml(img.url_570xN || img.url_fullxfull)}" alt="" loading="lazy" />`).join('')}
        </div>
      ` : ''}

      <section class="lp-final-cta">
        <h2 class="lp-display">Ready to make it yours?</h2>
        <a class="lp-cta" href="${escapeHtml(listing.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(copy.cta)} →</a>
      </section>

      <footer class="lp-footer">
        Handcrafted by <a href="${escapeHtml(shop?.url || listing.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shop?.shop_name || 'the seller')}</a> on Etsy
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
