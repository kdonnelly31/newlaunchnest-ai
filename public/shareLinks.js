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
  // Only build the "headline — subheadline" fallback caption when both
  // pieces are actually present -- otherwise fall back to an empty string
  // rather than let a malformed legacy row render the literal text
  // "undefined — undefined" in a caption textarea.
  const caption = (copy.headline && copy.subheadline) ? `${copy.headline} — ${copy.subheadline}` : '';
  return { platform, title: null, caption, hashtags: [] };
}
