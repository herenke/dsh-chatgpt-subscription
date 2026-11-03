#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createVault } from './vault.js';
import { safeDiagnostic } from './errors.js';
import { transaction, callbackListener, authorizationURL, tokenRequest, verifyIdentity, credentials, officialFetch, REVOKE, RESOURCE, PLAN_SCOPE } from './auth.js';

function openBrowser(url) {
  const executable = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: 'ignore', shell: false });
    child.once('error', () => reject(new Error('Could not open system browser. Run on a local desktop with a default browser.')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Could not open system browser.')));
  });
}
let stage = 'arguments';
async function main() {
  const [command, arg] = process.argv.slice(2);
  if (!['login', 'accounts', 'select', 'logout', 'usage'].includes(command)) {
    console.log('dsh-chatgpt login [--new|CLIENT_ID]\ndsh-chatgpt accounts\ndsh-chatgpt select CLIENT_ID\ndsh-chatgpt logout [CLIENT_ID]\ndsh-chatgpt usage\nSet the same DSH_CHATGPT_VAULT_PASSWORD in this CLI and the DSH launch environment.'); return;
  }
  if (command === 'usage') { console.log('Manage usage and credits: https://chatgpt.com/settings/usage'); return; }
  stage = 'vault';
  const vault = await createVault();
  if (command === 'accounts') {
    const data = await vault.snapshot();
    for (const [id, profile] of Object.entries(data.profiles)) console.log(`${data.active === id ? '*' : ' '} ${id}  ${profile.email ?? profile.subject ?? 'registration pending'}  ${profile.accessToken ? profile.scopes.includes(PLAN_SCOPE) ? 'plan permission granted' : 'identity only' : 'signed out'}`);
    return;
  }
  if (command === 'select') {
    await vault.transaction(state => { if (!state.profiles[arg]?.accessToken) throw new Error('Account not signed in.'); state.active = arg; });
    console.log('Active account selected. Refresh the DSH model picker.'); return;
  }
  if (command === 'login') {
    const initial = await vault.transaction(state => ({ hostId: state.hostId, profile: arg === '--new' ? undefined : state.profiles[arg ?? state.active] }));
    if (arg && arg !== '--new' && !initial.profile) throw new Error('Unknown account client ID. Use --new for a new account/workspace.');
    stage = 'authorization callback';
    const attempt = transaction(initial.hostId, initial.profile);
    const controller = new AbortController();
    const interrupted = () => controller.abort(); process.once('SIGINT', interrupted);
    const listener = await callbackListener(attempt, { signal: controller.signal });
    try {
      console.log('Continue with ChatGPT in your browser. Review account, workspace, plan permission and usage limits.');
      await openBrowser(authorizationURL(attempt, listener.redirectUri));
      const result = await listener.result;
      // Retain client registration even when the one-time code later expires.
      await vault.transaction(state => { state.profiles[result.clientId] ??= { clientId: result.clientId }; });
      stage = 'token exchange';
      const data = await tokenRequest({ grant_type: 'authorization_code', client_id: result.clientId, code: result.code, code_verifier: attempt.verifier, redirect_uri: listener.redirectUri, resource: RESOURCE });
      if (typeof data.id_token !== 'string') throw new Error('Missing verifiable OpenAI identity.');
      stage = 'identity validation';
      const identity = await verifyIdentity(data.id_token, result.clientId, attempt.nonce);
      if (attempt.subject && identity.subject !== attempt.subject) throw new Error('Account identity changed; previous credentials remain active.');
      stage = 'saving profile';
      const profile = { ...credentials(data), ...identity, clientId: result.clientId };
      await vault.transaction(state => { state.profiles[result.clientId] = profile; state.active = result.clientId; });
      console.log(`Connected ${identity.email ?? identity.subject} (${result.clientId}). ${profile.scopes.includes(PLAN_SCOPE) ? 'ChatGPT plan permission granted.' : 'Identity only; plan permission was not granted.'}`);
      console.log('Manage limits and credits: https://chatgpt.com/settings/usage');
    } finally { listener.close(); process.removeListener('SIGINT', interrupted); }
    return;
  }
  if (command === 'logout') {
    stage = 'sign-out and revocation';
    let revoked = false;
    const saved = await vault.transaction(state => {
      const id = arg ?? state.active, profile = state.profiles[id];
      if (!profile) throw new Error('Unknown account.');
      const { accessToken, refreshToken, idToken, expiresAt, scopes, ...mapping } = profile;
      state.profiles[id] = mapping; if (state.active === id) state.active = null;
      return { id, refreshToken };
    });
    // Stop new requests locally before remote I/O, without holding the state lock.
    if (saved.refreshToken) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await officialFetch(REVOKE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: saved.refreshToken, token_type_hint: 'refresh_token', client_id: saved.id }) });
          if (response.status === 200) { revoked = true; break; }
          if (response.status < 500) break;
        } catch { /* bounded retry; never log tokens */ }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    console.log(revoked ? 'Signed out; renewable session revoked.' : 'Signed out locally. Remote revocation was not confirmed; disconnect the app in ChatGPT Settings → Security and login.');
  }
}
main().catch(error => { console.error(safeDiagnostic(error, stage)); process.exitCode = 1; });
