import { randomBytes, randomUUID, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile, rename, rm, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export function vaultPath() { return join(homedir(), '.config', 'dsh-chatgpt-subscription', 'accounts.vault'); }
export function password() {
  const value = process.env.DSH_CHATGPT_VAULT_PASSWORD;
  if (!value || value.length < 16) throw new Error('Set DSH_CHATGPT_VAULT_PASSWORD to a private passphrase of at least 16 characters in the CLI and DSH launch environment.');
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
  constructor(path = vaultPath(), passphrase = password()) { this.path = path; this.passphrase = passphrase; }
  async read() {
    await privatePath(dirname(this.path), true);
    try { await privatePath(this.path); return unseal(await readFile(this.path, 'utf8'), this.passphrase); }
    catch (error) { if (error.code === 'ENOENT') return { hostId: `urn:uuid:${randomUUID()}`, profiles: {}, active: null }; throw error; }
  }
  async transaction(update) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await privatePath(dirname(this.path), true);
    const lock = `${this.path}.lock`;
    // Fail closed; never automatically steal a lock from another running process.
    try { await mkdir(lock, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Vault busy. Retry after the other operation completes; remove a stale lock only after checking no plugin/CLI process is running.'); throw error; }
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try {
      const data = await this.read();
      const result = await update(data);
      const file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(seal(data, this.passphrase)); await file.sync(); } finally { await file.close(); }
      await rename(temp, this.path);
      return result;
    } finally { await rm(temp, { force: true }); await rm(lock, { recursive: true }); }
  }
}
