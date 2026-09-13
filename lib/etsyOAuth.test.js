import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPkcePair,
  isTokenExpiringSoon,
  signPayload,
  verifySignedPayload,
  createConnectTicket,
  verifyConnectTicket,
} from './etsyOAuth.js';

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

test('signPayload/verifySignedPayload round-trips a payload', () => {
  const token = signPayload({ hello: 'world' }, 'secret');
  assert.deepEqual(verifySignedPayload(token, 'secret'), { hello: 'world' });
});

test('verifySignedPayload rejects a tampered payload', () => {
  const token = signPayload({ hello: 'world' }, 'secret');
  const [b64, sig] = token.split('.');
  const tampered = `${Buffer.from(JSON.stringify({ hello: 'tampered' })).toString('base64url')}.${sig}`;
  assert.equal(verifySignedPayload(tampered, 'secret'), null);
});

test('verifySignedPayload rejects a token signed with a different secret', () => {
  const token = signPayload({ hello: 'world' }, 'secret-a');
  assert.equal(verifySignedPayload(token, 'secret-b'), null);
});

test('verifySignedPayload rejects garbage input', () => {
  assert.equal(verifySignedPayload('not-a-valid-token', 'secret'), null);
  assert.equal(verifySignedPayload(undefined, 'secret'), null);
});

test('createConnectTicket produces a ticket verifyConnectTicket accepts immediately', () => {
  const ticket = createConnectTicket('secret');
  assert.equal(verifyConnectTicket(ticket, 'secret'), true);
});

test('verifyConnectTicket rejects an expired ticket', () => {
  const expiredPayload = { exp: Date.now() - 1000, nonce: 'x' };
  const ticket = signPayload(expiredPayload, 'secret');
  assert.equal(verifyConnectTicket(ticket, 'secret'), false);
});

test('verifyConnectTicket rejects a ticket signed with the wrong secret', () => {
  const ticket = createConnectTicket('secret-a');
  assert.equal(verifyConnectTicket(ticket, 'secret-b'), false);
});
