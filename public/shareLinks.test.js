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
  assert.match(url, /^https:\/\/www\.pinterest\.com\/pin\/create\/button\/\?/);
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
