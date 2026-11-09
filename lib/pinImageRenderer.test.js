// lib/pinImageRenderer.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPinImage, PIN_WIDTH, PIN_HEIGHT } from './pinImageRenderer.js';

// A minimal, valid 1x1 transparent PNG -- lets the renderer run end-to-end
// (it still fetches and decodes an image) without a network dependency in
// the test.
const TEST_PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function assertIsPng(buffer) {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(Buffer.isBuffer(buffer), 'renderPinImage must resolve to a Buffer');
  assert.ok(buffer.length > 1000, 'rendered PNG should not be suspiciously tiny');
  assert.deepEqual(buffer.subarray(0, 8), PNG_SIGNATURE, 'output must start with the PNG file signature');
}

test('renderPinImage produces a real PNG for the default (minimal) visual style', async () => {
  const buffer = await renderPinImage({
    photoUrl: TEST_PHOTO,
    headline: 'Handmade Stoneware Mugs',
    brandKit: { primaryColor: '#2E4636', accentColor: '#C97B3D', headlineFont: 'inter', visualStyle: 'minimal' },
  });
  assertIsPng(buffer);
});

test('renderPinImage produces a real PNG for an overlay visual style (lifestyle/photo_first)', async () => {
  const buffer = await renderPinImage({
    photoUrl: TEST_PHOTO,
    headline: 'A Gift They Will Actually Use',
    brandKit: { primaryColor: '#2E4636', accentColor: '#C97B3D', headlineFont: 'fraunces', visualStyle: 'lifestyle' },
  });
  assertIsPng(buffer);
});

test('renderPinImage throws a clear error without a photoUrl', async () => {
  await assert.rejects(
    () => renderPinImage({ headline: 'Missing photo', brandKit: {} }),
    /requires a photoUrl/,
  );
});

test('renderPinImage throws a clear error without a headline', async () => {
  await assert.rejects(
    () => renderPinImage({ photoUrl: TEST_PHOTO, brandKit: {} }),
    /requires a headline/,
  );
});

test('PIN_WIDTH and PIN_HEIGHT are the Pinterest-standard 2:3 pin ratio', () => {
  assert.equal(PIN_WIDTH, 1000);
  assert.equal(PIN_HEIGHT, 1500);
});
