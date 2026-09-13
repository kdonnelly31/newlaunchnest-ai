import crypto from 'crypto';

const ETSY_TOKEN_ENDPOINT = 'https://api.etsy.com/v3/public/oauth/token';

export function createPkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function isTokenExpiringSoon(expiresAtIso, nowMs = Date.now(), bufferMs = 5 * 60 * 1000) {
  return new Date(expiresAtIso).getTime() - nowMs < bufferMs;
}

// Signs a JSON payload into a single opaque, tamper-evident string, verifiable
// without any server-side storage -- used both for the OAuth `state` param
// (which Etsy echoes back verbatim on the callback) and for the one-time
// admin connect ticket below. Not a JWT: no header, no alg negotiation, just
// base64url(JSON) + an HMAC over it, which is all this needs.
export function signPayload(payload, secret) {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export function verifySignedPayload(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const CONNECT_TICKET_TTL_MS = 2 * 60 * 1000;

// A one-time, 2-minute-lived ticket an already-authenticated admin exchanges
// for the right to trigger /auth/etsy/connect -- that route itself can't
// check a Bearer header (it's reached via a plain browser navigation, not a
// fetch), so this is how it still requires admin auth.
export function createConnectTicket(secret) {
  return signPayload({ exp: Date.now() + CONNECT_TICKET_TTL_MS, nonce: crypto.randomBytes(8).toString('hex') }, secret);
}

export function verifyConnectTicket(ticket, secret) {
  const payload = verifySignedPayload(ticket, secret);
  return !!payload && typeof payload.exp === 'number' && Date.now() <= payload.exp;
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
