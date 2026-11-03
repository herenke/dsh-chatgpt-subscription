import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, readFile, stat, mkdir, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault, seal, unseal } from '../src/vault.js';
import { transaction, authorizationURL, validateCallback, callbackListener, officialFetch, verifyIdentity, credentials, accessSession, PLAN_SCOPE, TOKEN, RESOURCE } from '../src/auth.js';
const passphrase = 'test-only-private-passphrase-123';
const fakeJSON = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('vault ciphertext conceals tokens; wrong password and tampering fail', () => {
  const data = { accessToken: 'test-access-secret', refreshToken: 'test-refresh-secret' };
  const raw = seal(data, passphrase); assert.ok(!raw.includes('test-access-secret')); assert.deepEqual(unseal(raw, passphrase), data);
  assert.throws(() => unseal(raw, 'wrong'));
  const tampered = JSON.parse(raw); tampered.tag = Buffer.alloc(16).toString('base64'); assert.throws(() => unseal(JSON.stringify(tampered), passphrase));
});
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-chatgpt-test-')); await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true })); return new Vault(join(root, 'accounts.vault'), passphrase, {lockWaitMs:100,pollMs:5});
}
test('vault atomic writes retain host ID and use owner-only modes', async t => {
  const vault = await fixture(t); const host = await vault.transaction(s => s.hostId);
  await vault.transaction(s => { s.active = 'test'; }); assert.equal((await vault.read()).hostId, host);
  assert.equal((await stat(vault.path)).mode & 0o777, 0o600);
  assert.ok(!(await readFile(vault.path, 'utf8')).includes('urn:uuid:'));
});
test('vault does not overwrite after failed transaction', async t => {
  const vault = await fixture(t); await vault.transaction(s => { s.active = 'before'; });
  await assert.rejects(vault.transaction(s => { s.active = 'after'; throw new Error('failure'); })); assert.equal((await vault.read()).active, 'before');
});
test('cross-process lock refuses competing refresh/update', async t => {
  const vault = await fixture(t); await vault.transaction(() => {}); await mkdir(`${vault.path}.lock`);
  await assert.rejects(vault.transaction(() => {}), /Vault busy/);
});
test('vault refuses symlink and permissive paths', async t => {
  const vault = await fixture(t); await symlink(join(tmpdir(), 'nonexistent-target'), vault.path);
  await assert.rejects(vault.transaction(() => {}), /Unsafe/); await rm(vault.path);
  await chmod(join(vault.path, '..'), 0o755); await assert.rejects(vault.transaction(() => {}), /owner-only/);
});
test('PKCE, state, nonce fresh per attempt and official authorization parameters', () => {
  const a = transaction('urn:uuid:test'), b = transaction('urn:uuid:test'); assert.notEqual(a.state, b.state); assert.notEqual(a.nonce, b.nonce); assert.notEqual(a.verifier, b.verifier);
  const url = new URL(authorizationURL(a, 'http://127.0.0.1:1234/auth/callback'));
  assert.equal(url.origin, 'https://auth.openai.com'); assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client'); assert.equal(url.searchParams.get('resource'), RESOURCE); assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.ok(!url.href.includes(a.verifier));
});
test('reauthorization reuses exact client and host without a new agent name', () => {
  const a = transaction('host', { clientId: 'oaiapp_test', idToken: 'test-hint', subject: 'sub' }); const url = new URL(authorizationURL(a, 'http://127.0.0.1:9999/auth/callback'));
  assert.equal(url.searchParams.get('client_id'), 'oaiapp_test'); assert.equal(url.searchParams.get('agent_name_hint'), null); assert.equal(url.searchParams.get('id_token_hint'), 'test-hint');
});
test('callback rejects wrong state, duplicate parameters, missing/different client, missing code', () => {
  const a = transaction('host');
  for (const query of ['state=wrong&error=<script>', `state=${a.state}&state=${a.state}`, `state=${a.state}&code=x`, `state=${a.state}&code=x&client_id=dynamic_agent_client`, `state=${a.state}&client_id=oaiapp_test`]) assert.throws(() => validateCallback(`/?${query}`, a));
  assert.throws(() => validateCallback(`/?state=${a.state}&code=x&client_id=oaiapp_other`, { ...a, clientId: 'oaiapp_test' }));
  assert.equal(validateCallback(`/?state=${a.state}&code=x`, { ...a, clientId: 'oaiapp_test' }).clientId, 'oaiapp_test');
});
test('invalid/error injection callback leaves listener alive and returns plain text', async () => {
  const a = transaction('host'), listener = await callbackListener(a, { timeoutMs: 5000 });
  try {
    const invalid = await fetch(`${listener.redirectUri}?state=wrong&error=${encodeURIComponent('<script>alert(1)</script>')}`);
    assert.equal(invalid.status, 400); assert.match(invalid.headers.get('content-type'), /text\/plain/); assert.ok(!(await invalid.text()).includes('<script>'));
    const good = await fetch(`${listener.redirectUri}?state=${a.state}&code=synthetic-code&client_id=oaiapp_test`); assert.equal(good.status, 200); assert.equal((await listener.result).code, 'synthetic-code');
  } finally { listener.close(); }
});
test('valid-state OAuth denial closes attempt without reflecting error input', async () => {
  const a = transaction('host'), listener = await callbackListener(a, { timeoutMs: 5000 });
  const response = await fetch(`${listener.redirectUri}?state=${a.state}&error=${encodeURIComponent('<script>')}`);
  assert.ok(!(await response.text()).includes('<script>')); await assert.rejects(listener.result, /declined/);
});
test('callback cancellation and timeout settle and close', async () => {
  const controller = new AbortController(); const listener = await callbackListener(transaction('host'), { signal: controller.signal }); controller.abort(); await assert.rejects(listener.result, /cancelled/);
  const timed = await callbackListener(transaction('host'), { timeoutMs: 10 }); await assert.rejects(timed.result, /timed out/);
});
test('network allowlist rejects custom hosts, HTTP and URL tricks; redirects disabled', async () => {
  for (const url of ['http://api.openai.com/v1/responses', 'https://evil.test', 'https://api.openai.com.evil.test/v1/models', 'https://api.openai.com/v1/models?x=1']) await assert.rejects(officialFetch(url, {}, () => assert.fail('must not fetch')), /Untrusted/);
  await officialFetch(TOKEN, { redirect: 'follow' }, async (_, init) => { assert.equal(init.redirect, 'error'); return fakeJSON({}); });
});
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
function jwt(changes = {}, headerChanges = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', ...headerChanges })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: 'oaiapp_test', sub: 'test-subject', exp: Date.now() / 1000 + 300, iat: Math.floor(Date.now() / 1000), nonce: 'test-nonce', ...changes })).toString('base64url');
  return `${header}.${claims}.${sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey).toString('base64url')}`;
}
const keysFetch = async () => fakeJSON({ keys: [jwk] });
test('ID token requires signature, issuer, audience, expiry and nonce', async () => {
  assert.equal((await verifyIdentity(jwt(), 'oaiapp_test', 'test-nonce', keysFetch)).subject, 'test-subject');
  for (const changes of [{ iss: 'evil' }, { aud: 'other' }, { exp: 1 }, { nonce: 'wrong' }, { sub: '' }, { aud: ['oaiapp_test', 'other'] }]) await assert.rejects(verifyIdentity(jwt(changes), 'oaiapp_test', 'test-nonce', keysFetch), /validation failed/);
  await assert.rejects(verifyIdentity(jwt({}, { alg: 'none' }), 'oaiapp_test', 'test-nonce', keysFetch));
  const broken = jwt().split('.'); broken[2] = Buffer.alloc(256).toString('base64url'); await assert.rejects(verifyIdentity(broken.join('.'), 'oaiapp_test', 'test-nonce', keysFetch));
});
test('initial missing granted scope is never inferred from requested scope', () => { assert.deepEqual(credentials({ access_token: 'fake', expires_in: 100 }).scopes, []); });
test('refresh rotates tokens together and retains grant when scope omitted', async t => {
  const vault = await fixture(t);
  await vault.transaction(s => { s.active = 'oaiapp_test'; s.profiles[s.active] = { clientId: s.active, subject: 'test-subject', accessToken: 'old', refreshToken: 'old-refresh', scopes: [PLAN_SCOPE], expiresAt: 0 }; });
  const session = await accessSession(vault, undefined, async (url, init) => {
    assert.equal(url, TOKEN); assert.equal(init.body.get('client_id'), 'oaiapp_test'); assert.equal(init.body.get('refresh_token'), 'old-refresh'); assert.equal(init.body.has('scope'), false);
    return fakeJSON({ access_token: 'new', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600 });
  });
  assert.equal(session.refreshToken, 'new-refresh'); assert.equal((await vault.read()).profiles.oaiapp_test.accessToken, 'new');
});
test('scope reduction still persists rotated refresh token, then refuses inference', async t => {
  const vault = await fixture(t); await vault.transaction(s => { s.active = 'oaiapp_test'; s.profiles[s.active] = { clientId: s.active, accessToken: 'old', refreshToken: 'old-refresh', scopes: [PLAN_SCOPE], expiresAt: 0 }; });
  await assert.rejects(accessSession(vault, undefined, async () => fakeJSON({ access_token: 'new', refresh_token: 'rotated', token_type: 'Bearer', expires_in: 300, scope: 'openid' })), /unavailable/);
  assert.equal((await vault.read()).profiles.oaiapp_test.refreshToken, 'rotated');
});
test('identity-only session refuses inference before any network request', async t => {
  const vault = await fixture(t); await vault.transaction(s => { s.active = 'test'; s.profiles.test = { accessToken: 'fake', scopes: [], expiresAt: 0 }; });
  await assert.rejects(accessSession(vault, undefined, () => assert.fail('must not fetch')), /not granted/);
});

test('malformed token response never exposes token endpoint body in errors', async () => {
  const { tokenRequest } = await import('../src/auth.js');
  await assert.rejects(tokenRequest({}, undefined, async () => new Response('{"access_token":"synthetic-private-secret", broken')), error => !error.message.includes('synthetic-private-secret') && /token response/.test(error.message));
});
