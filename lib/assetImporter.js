import { Resolver } from 'node:dns/promises';

const IPV4_BLOCKED_RANGES = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isBlockedIpv4(ip) {
  const value = ipv4ToInt(ip);
  return IPV4_BLOCKED_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

function isBlockedIpv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local, fc00::/7
  if (normalized.startsWith('::ffff:')) return isBlockedIpv4(normalized.slice('::ffff:'.length));
  return false;
}

// Basic SSRF guard: blocks the common private/loopback/link-local ranges.
// Not an exhaustive IANA reservation list -- sufficient for "don't let a
// buyer-supplied URL reach this server's internal network," which is the
// actual risk here.
export function isBlockedIpAddress(ip) {
  return ip.includes(':') ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function isAllowedContentType(contentType) {
  if (!contentType) return false;
  const base = contentType.split(';')[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.has(base);
}

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function defaultResolveIp(hostname) {
  const resolver = new Resolver();
  try {
    const addresses = await resolver.resolve4(hostname);
    return addresses[0] ?? null;
  } catch {
    try {
      const addresses = await resolver.resolve6(hostname);
      return addresses[0] ?? null;
    } catch {
      return null;
    }
  }
}

// Downloads a buyer-supplied URL (an Etsy personalization file-upload
// answer) only after validating scheme, resolved IP, content type, and
// size -- re-checked on every redirect hop, since a first hop passing
// validation says nothing about where a redirect sends the request next.
export async function importAsset(url, { fetchImpl = fetch, resolveIp = defaultResolveIp, maxBytes = MAX_BYTES, maxRedirects = MAX_REDIRECTS } = {}) {
  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, failureReason: 'invalid_url' };
    }
    if (parsed.protocol !== 'https:') {
      return { ok: false, failureReason: 'disallowed_scheme' };
    }

    try {
      const ip = await resolveIp(parsed.hostname);
      if (!ip || isBlockedIpAddress(ip)) {
        return { ok: false, failureReason: 'blocked_host' };
      }

      const res = await fetchImpl(currentUrl, { redirect: 'manual' });

      if (REDIRECT_STATUSES.has(res.status)) {
        const location = res.headers.get('location');
        if (!location || hop === maxRedirects) {
          return { ok: false, failureReason: 'too_many_redirects' };
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!res.ok) {
        return { ok: false, failureReason: `http_${res.status}` };
      }

      const contentType = res.headers.get('content-type');
      if (!isAllowedContentType(contentType)) {
        return { ok: false, failureReason: 'disallowed_content_type' };
      }

      const contentLength = Number(res.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        return { ok: false, failureReason: 'too_large' };
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength > maxBytes) {
        return { ok: false, failureReason: 'too_large' };
      }

      return { ok: true, buffer, contentType: contentType.split(';')[0].trim().toLowerCase(), byteSize: buffer.byteLength };
    } catch {
      return { ok: false, failureReason: 'network_error' };
    }
  }

  return { ok: false, failureReason: 'too_many_redirects' };
}
