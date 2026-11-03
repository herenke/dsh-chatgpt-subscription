import { randomBytes, randomUUID, createHash, timingSafeEqual, createPublicKey, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { LlmError } from '@deepseek-ai/dsh-llm';
import { httpError } from './errors.js';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
export const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
export const REVOKE = `${ISSUER}/api/accounts/oauth/revoke`;
const JWKS = `${ISSUER}/.well-known/jwks.json`;
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const scopes = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
const random = () => randomBytes(32).toString('base64url');
export function transaction(hostId, profile) {
  const verifier = random();
  return { state: random(), nonce: random(), verifier, challenge: createHash('sha256').update(verifier).digest('base64url'), hostId, clientId: profile?.clientId, subject: profile?.subject, idToken: profile?.idToken };
}
export function authorizationURL(attempt, redirectUri) {
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({ client_id: attempt.clientId ?? 'dynamic_agent_client', ext_agent_host_id: attempt.hostId, response_type: 'code', redirect_uri: redirectUri, scope: scopes, resource: RESOURCE, state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: attempt.challenge }).toString();
  if (!attempt.clientId) url.searchParams.set('agent_name_hint', 'DSH ChatGPT subscription');
  if (attempt.idToken) url.searchParams.set('id_token_hint', attempt.idToken);
  return url.href;
}
export function validateCallback(raw, attempt) {
  const p = new URL(raw, 'http://127.0.0.1').searchParams;
  for (const key of ['state', 'code', 'error', 'client_id']) if (p.getAll(key).length > 1) throw new Error('Invalid callback.');
  const state = Buffer.from(p.get('state') ?? ''), expected = Buffer.from(attempt.state);
  if (state.length !== expected.length || !timingSafeEqual(state, expected)) throw new Error('Invalid callback state.');
  if (p.has('error')) return { error: 'Authorization was declined or failed.' };
  const clientId = p.get('client_id') ?? attempt.clientId;
  if (!clientId || !/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId) || (attempt.clientId && clientId !== attempt.clientId)) throw new Error('Invalid callback client ID.');
  const code = p.get('code');
  if (!code || code.length > 8192) throw new Error('Invalid authorization code.');
  return { code, clientId };
}
export async function callbackListener(attempt, { timeoutMs = 180000, signal } = {}) {
  let resolve, reject, settled = false;
  const result = new Promise((yes, no) => { resolve = yes; reject = no; });
  // Attach now so a browser-open failure cannot produce an unhandled rejection.
  result.catch(() => {});
  let timer;
  const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted); server.close(); error ? reject(error) : resolve(value); };
  const aborted = () => finish(new Error('Sign-in cancelled.'));
  const server = createServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Connection': 'close' }); res.end(body); };
    if (req.method !== 'GET' || req.url?.length > 16384 || req.headers.host !== `127.0.0.1:${server.address().port}` || req.url?.split('?')[0] !== '/auth/callback') return reply(404, 'Not found.');
    let value;
    try { value = validateCallback(req.url, attempt); } catch { return reply(400, 'Invalid callback. Continue sign-in in the original browser window.'); }
    reply(value.error ? 400 : 200, value.error ?? 'Authorization received. Return to the terminal.');
    finish(value.error ? new Error(value.error) : null, value);
  });
  server.headersTimeout = 5000; server.requestTimeout = 10000;
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
  timer = setTimeout(() => finish(new Error('Sign-in timed out.')), timeoutMs);
  signal?.addEventListener('abort', aborted, { once: true });
  if (signal?.aborted) aborted();
  return { redirectUri, result, close: aborted };
}
export async function officialFetch(url, init = {}, fetcher = fetch, { timeoutMs } = {}) {
  if (![TOKEN, REVOKE, JWKS, `${RESOURCE}/models`, `${RESOURCE}/responses`].includes(url)) throw new Error('Untrusted OpenAI endpoint.');
  // Streaming inference has no total deadline. The caller's AbortSignal remains
  // attached to fetch/body; administrative endpoints retain bounded deadlines.
  const streaming = url === `${RESOURCE}/responses`;
  const deadline = timeoutMs ?? (url.endsWith('/models') ? 30000 : 120000);
  const signal = streaming ? init.signal : init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(deadline)]) : AbortSignal.timeout(deadline);
  try { return await fetcher(url, { ...init, redirect: 'error', signal }); }
  catch { throw new LlmError(init.signal?.aborted ? 'Request cancelled.' : 'OpenAI network request failed.', init.signal?.aborted ? 'ABORTED' : signal?.aborted ? 'TIMEOUT' : 'TRANSPORT'); }
}
export async function tokenRequest(fields, signal, fetcher) {
  const response = await officialFetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), signal }, fetcher);
  if (!response.ok) throw await httpError(response);
  let data;
  try { data = await response.json(); } catch { throw new Error('Invalid OpenAI token response.'); }
  if (!data || typeof data !== 'object' || (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || !data.refresh_token)) || (data.scope !== undefined && typeof data.scope !== 'string')) throw new Error('Invalid token response.');
  if (typeof data.access_token !== 'string' || !data.access_token || data.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('Invalid token response.');
  return data;
}
export async function verifyIdentity(jwt, clientId, nonce, fetcher) {
  try {
    const parts = jwt.split('.'); if (parts.length !== 3) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url')), claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit !== undefined) throw new Error();
    const response = await officialFetch(JWKS, {}, fetcher); if (!response.ok) throw new Error();
    const { keys } = await response.json();
    const matches = keys.filter(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256'));
    if (matches.length !== 1) throw new Error();
    const key = createPublicKey({ key: matches[0], format: 'jwk' });
    if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) throw new Error();
    const now = Date.now() / 1000;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== ISSUER || !aud.includes(clientId) || (aud.length > 1 && claims.azp !== clientId) || (claims.azp && claims.azp !== clientId) || !Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat) || claims.iat > now + 60 || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + 60)) || !claims.sub || typeof claims.sub !== 'string' || (nonce !== undefined && claims.nonce !== nonce)) throw new Error();
    return { subject: claims.sub, email: typeof claims.email === 'string' ? claims.email : undefined };
  } catch { throw new Error('OpenAI identity validation failed. No credentials were activated.'); }
}
export function credentials(data, previous = {}) {
  const granted = typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : previous.scopes ?? [];
  return { ...previous, sessionId: previous.sessionId ?? (previous.accessToken ? undefined : randomUUID()), accessToken: data.access_token, refreshToken: data.refresh_token ?? previous.refreshToken, idToken: data.id_token ?? previous.idToken, scopes: granted, expiresAt: Date.now() + data.expires_in * 1000 };
}
export async function vaultSnapshot(vault) {
  return vault.snapshot ? vault.snapshot() : vault.transaction(state => structuredClone(state));
}
function activeProfile(state) {
  const profile = state.profiles[state.active];
  if (!profile?.accessToken) throw new LlmError('Sign in first using the dsh-chatgpt CLI.', 'MISSING_CREDENTIAL');
  if (!profile.scopes?.includes(PLAN_SCOPE)) throw new LlmError('ChatGPT plan usage was not granted. Reauthorize and review the plan permission.', 'AUTH');
  return profile;
}
export function sameSession(a, b) {
  return !!a?.accessToken && !!b?.accessToken && a.clientId === b.clientId && a.subject === b.subject && a.sessionId === b.sessionId;
}
export async function accessSession(vault, signal, fetcher) {
  signal?.throwIfAborted();
  const first = activeProfile(await vaultSnapshot(vault));
  if (first.expiresAt > Date.now() + 60000) return { ...first };
  const refresh = async () => {
    const state = await vaultSnapshot(vault), profile = activeProfile(state), id = state.active;
    if (!sameSession(first, profile)) throw new LlmError('ChatGPT account changed; prepare a new request.', 'AUTH');
    if (profile.expiresAt > Date.now() + 60000) return { ...profile };
    if (!profile.refreshToken) throw new LlmError('Session expired; sign in again.', 'AUTH');
    const data = await tokenRequest({ grant_type: 'refresh_token', client_id: profile.clientId, refresh_token: profile.refreshToken, resource: RESOURCE }, signal, fetcher);
    if (data.id_token) { const identity = await verifyIdentity(data.id_token, profile.clientId, undefined, fetcher); if (identity.subject !== profile.subject) throw new LlmError('Refreshed identity changed.', 'AUTH'); }
    const next = credentials(data, profile);
    const committed = await vault.transaction(current => {
      const saved = current.profiles[id];
      if (!sameSession(profile, saved) || saved.refreshToken !== profile.refreshToken) return { saved: false, active: false };
      current.profiles[id] = next;
      return { saved: true, active: current.active === id };
    });
    if (!committed.saved && next.refreshToken) {
      // A concurrent logout/re-login must not leave the discarded renewable
      // session usable. Never revoke an inactive account that we did save.
      try { await officialFetch(REVOKE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: next.refreshToken, token_type_hint: 'refresh_token', client_id: profile.clientId }) }, fetcher); } catch { /* local credentials remain cleared; never log tokens */ }
    }
    // Persist a known rotated token even if this caller cancelled after exchange.
    // Cancellation must not strand the renewable session on its consumed token.
    signal?.throwIfAborted();
    if (!committed.active) throw new LlmError('ChatGPT account changed or signed out during refresh.', 'AUTH');
    if (!next.scopes.includes(PLAN_SCOPE)) throw new LlmError('ChatGPT plan usage is unavailable.', 'AUTH');
    return { ...next };
  };
  // A separate cross-process refresh mutex prevents simultaneous consumption of
  // a rotating token. Normal snapshots/state updates never wait for its network.
  return vault.exclusive ? vault.exclusive('refresh', refresh, { signal }) : refresh();
}
