import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickAccentColor, lightenHex } from './brandColor.js';

test('pickAccentColor picks the most common saturated color, ignoring neutrals', () => {
  const counts = [
    { r: 240, g: 240, b: 240, count: 500 }, // pale gray background, very common
    { r: 20, g: 20, b: 20, count: 200 },    // near-black text, common
    { r: 11, g: 52, b: 54, count: 80 },     // dark teal accent, less common but saturated
    { r: 187, g: 151, b: 99, count: 40 },   // gold accent, even less common
  ];
  assert.equal(pickAccentColor(counts), '#0b3436');
});

test('pickAccentColor returns null when every color is neutral (grayscale image)', () => {
  const counts = [
    { r: 240, g: 240, b: 240, count: 500 },
    { r: 128, g: 128, b: 128, count: 300 },
    { r: 20, g: 20, b: 20, count: 100 },
  ];
  assert.equal(pickAccentColor(counts), null);
});

test('pickAccentColor returns null for no input', () => {
  assert.equal(pickAccentColor([]), null);
});

test('pickAccentColor ignores a saturated color that is too dark or too light to read well', () => {
  const counts = [
    { r: 10, g: 40, b: 5, count: 900 },     // very dark green, saturated but too dark
    { r: 250, g: 253, b: 245, count: 900 }, // near-white with a faint green tint, too light
    { r: 178, g: 96, b: 40, count: 50 },    // mid-tone burnt orange, the only usable candidate
  ];
  assert.equal(pickAccentColor(counts), '#b26028');
});

test('lightenHex leaves the color unchanged at amount 0', () => {
  assert.equal(lightenHex('#0b3436', 0), '#0b3436');
});

test('lightenHex blends a color halfway toward white', () => {
  // r: (11+255)/2=133=0x85, g: (52+255)/2=153.5->154=0x9a, b: (54+255)/2=154.5->155=0x9b
  assert.equal(lightenHex('#0b3436', 0.5), '#859a9b');
});

test('lightenHex reaches pure white at amount 1', () => {
  assert.equal(lightenHex('#0b3436', 1), '#ffffff');
});
