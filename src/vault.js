import { randomBytes, randomUUID, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, lstat, readFile, rename, rm, open } from 'node:fs/promises';
import { dirname, join, isAbsolute } from 'node:path';
import { constants } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { LlmError } from '@deepseek-ai/dsh-llm';
import { homedir } from 'node:os';

export function vaultPath() { return join(homedir(), '.config', 'dsh-chatgpt-subscription', 'accounts.vault'); }
export function password() {
  const value = process.env.DSH_CHATGPT_VAULT_PASSWORD;
  if (!value || value.length < 16) throw new LlmError('Set DSH_CHATGPT_VAULT_PASSWORD (16+ characters), or configure an owner-only passphraseFile for GUI launches.', 'MISSING_CREDENTIAL');
  return value;
}
export function seal(data, passphrase) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
    return JSON.stringify({ version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
  } finally { key.fill(0); }
}
export function unseal(raw, passphrase) {
  const record = JSON.parse(raw);
  if (record.version !== 1) throw new Error('Unsupported vault version.');
  const salt = Buffer.from(record.salt, 'base64'), iv = Buffer.from(record.iv, 'base64'), tag = Buffer.from(record.tag, 'base64');
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted vault.');
  const key = scryptSync(passphrase, salt, 32);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString());
  } catch { throw new Error('Cannot unlock vault: incorrect passphrase or damaged file.'); }
  finally { key.fill(0); }
}
async function privatePath(path, directory = false) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error('Unsafe vault path.');
  if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())) throw new Error('Vault path must be owner-only (directory 0700, file 0600).');
}
export class Vault {
  constructor(path = vaultPath(), passphrase = password(), options = {}) { this.path = path; this.passphrase = passphrase; this.lockWaitMs = options.lockWaitMs ?? 130000; this.pollMs = options.pollMs ?? 25; }
  async read() {
    try { await privatePath(dirname(this.path), true); await privatePath(this.path); return unseal(await readFile(this.path, 'utf8'), this.passphrase); }
    catch (error) { if (error.code === 'ENOENT') return { hostId: `urn:uuid:${randomUUID()}`, profiles: {}, active: null }; throw error; }
  }
  async snapshot() { return this.read(); }
  async exclusive(scope, operation, { signal } = {}) {
    if (!['state', 'refresh'].includes(scope)) throw new Error('Invalid vault lock scope.');
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await privatePath(dirname(this.path), true);
    const lock = scope === 'state' ? `${this.path}.lock` : `${this.path}.refresh.lock`;
    const deadline = Date.now() + this.lockWaitMs;
    while (true) {
      signal?.throwIfAborted();
      try { await mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw new LlmError('Vault busy after bounded waiting. Remove a stale lock only after confirming no plugin/CLI process is running.', 'VAULT_BUSY');
        await delay(this.pollMs, undefined, { signal });
      }
    }
    try { return await operation(); }
    finally { await rm(lock, { recursive: true }); }
  }
  async transaction(update, options = {}) {
    return this.exclusive('state', async () => {
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try {
        let exists = true; try { await lstat(this.path); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
        const data = await this.read(), before = JSON.stringify(data);
        const result = await update(data);
        if (exists && JSON.stringify(data) === before) return result;
        const file = await open(temp, 'wx', 0o600);
        try { await file.writeFile(seal(data, this.passphrase)); await file.sync(); } finally { await file.close(); }
        await rename(temp, this.path);
        return result;
      } finally { await rm(temp, { force: true }); }
    }, options);
  }
}
function localPath(value) {
  if (typeof value !== 'string') throw new LlmError('Configure an absolute local credential path.', 'INVALID_CONFIG');
  const path = value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  if (!isAbsolute(path)) throw new LlmError('Credential paths must be absolute (or start with ~/).', 'INVALID_CONFIG');
  return path;
}
async function passwordFromFile(path) {
  const handle = await open(localPath(path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 65536 || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()))) throw new LlmError('Passphrase file must be a regular owner-only file (0600).', 'INVALID_CREDENTIAL');
    const value = (await handle.readFile('utf8')).replace(/\r?\n$/, '');
    if (value.length < 16 || /[\r\n]/.test(value)) throw new LlmError('Passphrase file must contain one private passphrase of at least 16 characters.', 'INVALID_CREDENTIAL');
    return value;
  } finally { await handle.close(); }
}
export async function createVault(config = {}) {
  let passphrase;
  try {
    if (config.passphraseFile) passphrase = await passwordFromFile(config.passphraseFile);
    else if (process.env.DSH_CHATGPT_VAULT_PASSWORD) passphrase = password();
    else if (process.env.DSH_CHATGPT_VAULT_PASSWORD_FILE) passphrase = await passwordFromFile(process.env.DSH_CHATGPT_VAULT_PASSWORD_FILE);
    else {
      try { passphrase = await passwordFromFile(join(dirname(vaultPath()), 'passphrase')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; passphrase = password(); }
    }
  } catch (error) {
    if (error instanceof LlmError) throw error;
    throw new LlmError('Cannot read the passphrase file. Check its path, owner-only permissions and symlink status.', 'INVALID_CREDENTIAL');
  }
  const selectedPath = config.vaultPath ?? process.env.DSH_CHATGPT_VAULT_PATH;
  return new Vault(selectedPath ? localPath(selectedPath) : vaultPath(), passphrase);
}
