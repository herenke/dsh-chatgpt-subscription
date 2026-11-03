import { createHash } from 'node:crypto';
import { LlmAdapter, LlmError, attributionHeaders, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { createVault } from './vault.js';
import { accessSession, sameSession } from './auth.js';
import { listModels, infer } from './protocol.js';
import { imageTarget } from './images.js';

export const PROVIDER = 'chatgpt-subscription';
export const DEFAULT_CONTEXT_WINDOW = 32768;
function cancellable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(new LlmError('Request cancelled.', 'ABORTED'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export class ChatGPTAdapter extends LlmAdapter {
  constructor(vault, fetcher = fetch, features = {}) { super(); this.vault = vault; this.fetcher = fetcher; this.features = features; }
  async getVault() {
    if (this.vault) return this.vault;
    this.vaultPromise ??= createVault(this.features).catch(error => { this.vaultPromise = undefined; throw error; });
    return this.vaultPromise;
  }
  imageRequestTarget(_provider, _model, image) { return imageTarget(image); }
  providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0, retryableCodes: ['SERVER'], backoff: { initialDelayMs: 500, maxDelayMs: 1000, jitterRatio: 0 } }, 'chatgpt-subscription.retryPolicy'); }
  providerInfo(provider) { return { id: provider, name: 'ChatGPT subscription' }; }
  async catalog(session, signal) {
    const key = createHash('sha256').update(JSON.stringify([session.clientId, session.subject, session.sessionId, session.accessToken])).digest('hex');
    if (!this.catalogCache || this.catalogCache.key !== key || this.catalogCache.expiresAt <= Date.now()) {
      const entry = { key, expiresAt: Date.now() + 60000 };
      entry.promise = listModels(session, attributionHeaders(), undefined, this.fetcher).catch(error => { if (this.catalogCache === entry) this.catalogCache = undefined; throw error; });
      this.catalogCache = entry;
    }
    return cancellable(this.catalogCache.promise, signal);
  }
  modelInfo(provider, model) {
    const override = this.features.modelContextWindows?.[model.id] ?? this.features.contextWindow;
    const capacity = override ?? model.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    const origin = override !== undefined ? 'configured' : model.contextWindow !== undefined ? 'catalog' : 'conservative fallback; configure for this model';
    return { ...model, provider, context: { contextWindow: capacity }, description: `Context window: ${capacity} tokens (${origin}).` };
  }
  async listModels(provider) {
    const session = await accessSession(await this.getVault(), undefined, this.fetcher);
    const models = await this.catalog(session);
    return models.map(model => ({ ...this.modelInfo(provider, model), description: `ChatGPT account: ${session.email ?? session.subject} (${session.clientId}). ${this.modelInfo(provider, model).description} Manage usage: https://chatgpt.com/settings/usage` }));
  }
  async resolveModel(provider, model, signal) {
    const session = await accessSession(await this.getVault(), signal, this.fetcher);
    const found = (await this.catalog(session, signal)).find(m => m.id === model);
    if (!found) throw new LlmError('Choose a model available to the active ChatGPT account.', 'INVALID_REQUEST');
    return this.modelInfo(provider, found);
  }
  async prepareCall(provider, model, signal) {
    const vault = await this.getVault();
    const session = await accessSession(vault, signal, this.fetcher);
    const found = (await this.catalog(session, signal)).find(m => m.id === model);
    if (!found) throw new LlmError('Choose a model available to the active ChatGPT account.', 'INVALID_REQUEST');
    const fetcher = this.fetcher, features = this.features;
    return { model: this.modelInfo(provider, found), stream: async function* (options) {
      const current = await accessSession(vault, options.signal, fetcher);
      if (!sameSession(session, current)) throw new LlmError('ChatGPT account changed or signed out; prepare a new request.', 'AUTH');
      yield* infer(current, options, attributionHeaders(), fetcher, features);
    } };
  }
  async *stream(options) {
    const prepared = await this.prepareCall(options.provider, options.model, options.signal);
    yield* prepared.stream(options);
  }
}
