import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIpAddress, isAllowedContentType, importAsset } from './assetImporter.js';

// --- isBlockedIpAddress ---

test('isBlockedIpAddress: blocks common private/loopback IPv4 ranges', () => {
  assert.equal(isBlockedIpAddress('127.0.0.1'), true);
  assert.equal(isBlockedIpAddress('10.1.2.3'), true);
  assert.equal(isBlockedIpAddress('172.16.5.1'), true);
  assert.equal(isBlockedIpAddress('192.168.1.1'), true);
  assert.equal(isBlockedIpAddress('169.254.1.1'), true);
});

test('isBlockedIpAddress: allows an ordinary public IPv4 address', () => {
  assert.equal(isBlockedIpAddress('93.184.216.34'), false);
});

test('isBlockedIpAddress: blocks IPv6 loopback and link-local', () => {
  assert.equal(isBlockedIpAddress('::1'), true);
  assert.equal(isBlockedIpAddress('fe80::1'), true);
});

test('isBlockedIpAddress: blocks an IPv4-mapped IPv6 private address', () => {
  assert.equal(isBlockedIpAddress('::ffff:10.0.0.5'), true);
});

// --- isAllowedContentType ---

test('isAllowedContentType: allows the supported image types', () => {
  assert.equal(isAllowedContentType('image/jpeg'), true);
  assert.equal(isAllowedContentType('image/png'), true);
  assert.equal(isAllowedContentType('image/webp'), true);
  assert.equal(isAllowedContentType('image/gif'), true);
});

test('isAllowedContentType: ignores a charset suffix', () => {
  assert.equal(isAllowedContentType('image/png; charset=binary'), true);
});

test('isAllowedContentType: rejects SVG explicitly (active content risk)', () => {
  assert.equal(isAllowedContentType('image/svg+xml'), false);
});

test('isAllowedContentType: rejects non-image types and missing values', () => {
  assert.equal(isAllowedContentType('text/html'), false);
  assert.equal(isAllowedContentType(null), false);
  assert.equal(isAllowedContentType(undefined), false);
});

// --- importAsset ---

function fakeResponse({ status = 200, headers = {}, body = 'x' } = {}) {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headerMap.get(name.toLowerCase()) ?? null },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

test('importAsset: rejects a non-https URL', async () => {
  const result = await importAsset('http://example.com/photo.jpg');
  assert.deepEqual(result, { ok: false, failureReason: 'disallowed_scheme' });
});

test('importAsset: rejects when the host resolves to a blocked IP', async () => {
  const result = await importAsset('https://internal.example.com/photo.jpg', {
    resolveIp: async () => '10.0.0.5',
    fetchImpl: async () => { throw new Error('should not be called'); },
  });
  assert.deepEqual(result, { ok: false, failureReason: 'blocked_host' });
});

test('importAsset: rejects a disallowed content type', async () => {
  const result = await importAsset('https://cdn.example.com/file.html', {
    resolveIp: async () => '93.184.216.34',
    fetchImpl: async () => fakeResponse({ headers: { 'content-type': 'text/html' } }),
  });
  assert.deepEqual(result, { ok: false, failureReason: 'disallowed_content_type' });
});

test('importAsset: rejects a response over the byte cap via Content-Length', async () => {
  const result = await importAsset('https://cdn.example.com/huge.png', {
    resolveIp: async () => '93.184.216.34',
    fetchImpl: async () => fakeResponse({ headers: { 'content-type': 'image/png', 'content-length': '999999999' } }),
    maxBytes: 1000,
  });
  assert.deepEqual(result, { ok: false, failureReason: 'too_large' });
});

test('importAsset: follows a redirect within the cap and re-validates the new host', async () => {
  let call = 0;
  const result = await importAsset('https://cdn.example.com/redirect.png', {
    resolveIp: async () => '93.184.216.34',
    fetchImpl: async () => {
      call += 1;
      if (call === 1) return fakeResponse({ status: 302, headers: { location: 'https://cdn2.example.com/final.png' } });
      return fakeResponse({ headers: { 'content-type': 'image/png' }, body: 'imagebytes' });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.contentType, 'image/png');
  assert.equal(call, 2);
});

test('importAsset: fails after exceeding the redirect cap', async () => {
  const result = await importAsset('https://cdn.example.com/loop.png', {
    resolveIp: async () => '93.184.216.34',
    fetchImpl: async () => fakeResponse({ status: 302, headers: { location: 'https://cdn.example.com/loop.png' } }),
    maxRedirects: 2,
  });
  assert.deepEqual(result, { ok: false, failureReason: 'too_many_redirects' });
});

test('importAsset: succeeds for a valid small image', async () => {
  const result = await importAsset('https://cdn.example.com/photo.jpg', {
    resolveIp: async () => '93.184.216.34',
    fetchImpl: async () => fakeResponse({ headers: { 'content-type': 'image/jpeg' }, body: 'jpegbytes' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.contentType, 'image/jpeg');
  assert.equal(result.byteSize, Buffer.byteLength('jpegbytes'));
  assert.ok(Buffer.isBuffer(result.buffer));
});

test('importAsset: rejects an unparseable URL without throwing', async () => {
  const result = await importAsset('not a url');
  assert.deepEqual(result, { ok: false, failureReason: 'invalid_url' });
});

test('importAsset: returns network_error when resolveIp rejects', async () => {
  const result = await importAsset('https://cdn.example.com/photo.jpg', {
    resolveIp: async () => { throw new Error('DNS lookup failed'); },
    fetchImpl: async () => { throw new Error('should not be called'); },
  });
  assert.deepEqual(result, { ok: false, failureReason: 'network_error' });
});

test('importAsset: returns network_error when fetchImpl rejects', async () => {
  const result = await importAsset('https://cdn.example.com/photo.jpg', {
    resolveIp: async () => '93.184.216.34',
    fetchImpl: async () => { throw new Error('Network request failed'); },
  });
  assert.deepEqual(result, { ok: false, failureReason: 'network_error' });
});

test('importAsset: returns network_error when arrayBuffer rejects', async () => {
  const result = await importAsset('https://cdn.example.com/photo.jpg', {
    resolveIp: async () => '93.184.216.34',
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'image/jpeg' : null },
      arrayBuffer: async () => { throw new Error('Failed to read response body'); },
    }),
  });
  assert.deepEqual(result, { ok: false, failureReason: 'network_error' });
});
