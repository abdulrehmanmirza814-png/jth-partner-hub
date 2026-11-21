// Gmail login using Google's official OAuth "desktop app" flow (PKCE). You sign in once in your
// browser; a refresh token is stored on this laptop only (data/secrets/google.json).
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { DATA, readJson } from '../util.js';

export const SCOPE = 'https://www.googleapis.com/auth/gmail.modify'; // read, label, drafts, send - not permanent delete
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SECRET_FILE = () => path.join(DATA, 'secrets', 'google.json');
const b64url = (b) => Buffer.from(b).toString('base64url');

export function newPkce() {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

export function buildAuthUrl({ clientId, redirectUri, challenge, state }) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  const q = { client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state };
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return u.toString();
}

async function tokenCall(params, fetchImpl) {
  const res = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google token error: ${body.error_description || body.error || res.status}`);
  return body;
}

export const exchangeCode = ({ code, verifier, redirectUri, clientId, clientSecret, fetchImpl = fetch }) =>
  tokenCall({ code, code_verifier: verifier, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code' }, fetchImpl);

/** Returns a function that always yields a valid access token, refreshing it when needed. */
export function tokenProvider({ fetchImpl = fetch, clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET } = {}) {
  let cached = null;
  return async () => {
    if (cached && cached.exp > Date.now() + 60000) return cached.token;
    const saved = readJson(SECRET_FILE(), null);
    if (!saved?.refresh_token) throw new Error('Gmail is not connected yet. Run: npm run gmail-auth');
    if (!clientId || !clientSecret) throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
    const t = await tokenCall({ client_id: clientId, client_secret: clientSecret, refresh_token: saved.refresh_token, grant_type: 'refresh_token' }, fetchImpl);
    cached = { token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 };
    return cached.token;
  };
}

export const isConnected = () => !!readJson(SECRET_FILE(), null)?.refresh_token;

/** Interactive: opens a one-time local page that receives Google's redirect. */
export async function authorize({ clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET, print = console.log } = {}) {
  if (!clientId || !clientSecret) throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first (see README, "Gmail").');
  const { verifier, challenge } = newPkce();
  const state = b64url(crypto.randomBytes(12));
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  print(`\nOpen this link in your browser and allow access:\n\n${buildAuthUrl({ clientId, redirectUri, challenge, state })}\n`);
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for Google sign-in (5 minutes).')), 300000);
    server.on('request', (req, res) => {
      const u = new URL(req.url, redirectUri);
      if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) { res.end('Waiting...'); return; }
      res.end('Gmail connected. You can close this tab and return to the terminal.');
      clearTimeout(timer);
      resolve(u.searchParams.get('code'));
    });
  });
  server.close();
  const t = await exchangeCode({ code, verifier, redirectUri, clientId, clientSecret });
  if (!t.refresh_token) throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and try again.');
  fs.mkdirSync(path.dirname(SECRET_FILE()), { recursive: true });
  fs.writeFileSync(SECRET_FILE(), JSON.stringify({ refresh_token: t.refresh_token, saved: new Date().toISOString() }), { mode: 0o600 });
  return true;
}
