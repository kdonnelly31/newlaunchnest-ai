import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ETSY_TOKEN_ENDPOINT = 'https://api.etsy.com/v3/public/oauth/token';

export function createPkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function isTokenExpiringSoon(expiresAtIso, nowMs = Date.now(), bufferMs = 5 * 60 * 1000) {
  return new Date(expiresAtIso).getTime() - nowMs < bufferMs;
}

// PKCE state has to survive the round trip to Etsy and back. Stashed in a tmp
// file rather than a cookie or in-memory variable, matching the existing
// TIKTOK_TOKEN_FILE pattern in server.js: os.tmpdir() is writable on Vercel,
// the project directory isn't.
const ETSY_OAUTH_STATE_FILE = path.join(os.tmpdir(), 'etsy-shop-viewer-etsy-oauth-state.json');

export function writeEtsyOAuthState(state) {
  fs.writeFileSync(ETSY_OAUTH_STATE_FILE, JSON.stringify(state));
}

export function readEtsyOAuthState() {
  try {
    return JSON.parse(fs.readFileSync(ETSY_OAUTH_STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function requestToken(body) {
  const res = await fetch(ETSY_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parsed.error_description || parsed.error || `Etsy OAuth token request failed (${res.status})`);
  }
  return parsed;
}

export async function exchangeCodeForToken({ code, codeVerifier, clientId, redirectUri }) {
  return requestToken({
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
    code_verifier: codeVerifier,
  });
}

export async function refreshEtsyToken({ refreshToken, clientId }) {
  return requestToken({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });
}

// Returns the current connection's access token, refreshing it first (and
// persisting the refreshed pair, since Etsy rotates the refresh token on
// every use) if it's within 5 minutes of expiring. Returns null if no
// Etsy account has been connected yet.
export async function getValidEtsyToken(supabaseAdmin, clientId) {
  const { data: connection, error } = await supabaseAdmin
    .from('etsy_seller_connection')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!connection) return null;

  if (!isTokenExpiringSoon(connection.expires_at)) {
    return { accessToken: connection.access_token, shopId: connection.shop_id };
  }

  const refreshed = await refreshEtsyToken({ refreshToken: connection.refresh_token, clientId });
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  const { error: updateError } = await supabaseAdmin
    .from('etsy_seller_connection')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
  if (updateError) throw new Error(updateError.message);

  return { accessToken: refreshed.access_token, shopId: connection.shop_id };
}
