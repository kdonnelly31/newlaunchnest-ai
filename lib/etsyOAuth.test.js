import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPkcePair, isTokenExpiringSoon } from './etsyOAuth.js';

test('createPkcePair returns a verifier and a matching S256 challenge', () => {
  const { codeVerifier, codeChallenge } = createPkcePair();
  assert.match(codeVerifier, /^[A-Za-z0-9._~-]{43,128}$/);
  assert.match(codeChallenge, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(codeVerifier, codeChallenge);
});

test('createPkcePair returns a different pair each call', () => {
  const a = createPkcePair();
  const b = createPkcePair();
  assert.notEqual(a.codeVerifier, b.codeVerifier);
});

test('isTokenExpiringSoon is true when expiry is within the buffer window', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const expiresAt = new Date(now + 2 * 60 * 1000).toISOString(); // 2 min from now
  assert.equal(isTokenExpiringSoon(expiresAt, now, 5 * 60 * 1000), true);
});

test('isTokenExpiringSoon is false when expiry is well outside the buffer window', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const expiresAt = new Date(now + 30 * 60 * 1000).toISOString(); // 30 min from now
  assert.equal(isTokenExpiringSoon(expiresAt, now, 5 * 60 * 1000), false);
});

test('isTokenExpiringSoon is true for an already-expired token', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const expiresAt = new Date(now - 1000).toISOString();
  assert.equal(isTokenExpiringSoon(expiresAt, now, 5 * 60 * 1000), true);
});
