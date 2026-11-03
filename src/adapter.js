import { LlmAdapter, attributionHeaders } from '@deepseek-ai/dsh-llm';
import { Vault } from './vault.js';
import { accessSession } from './auth.js';
import { listModels, infer } from './protocol.js';
import { imageTarget } from './images.js';

export const PROVIDER = 'chatgpt-subscription';
export class ChatGPTAdapter extends LlmAdapter {
  constructor(vault = new Vault(), fetcher = fetch, features = {}) { super(); this.vault = vault; this.fetcher = fetcher; this.features = features; }
  imageRequestTarget(_provider, _model, image) { return imageTarget(image); }
  providerRetryPolicy() { return { mode: 'normal', maxRetries: 0, retryableCodes: ['SERVER'], initialDelayMs: 500, maxDelayMs: 1000, jitterRatio: 0 }; }
  providerInfo(provider) { return { id: provider, name: 'ChatGPT subscription' }; }
  async listModels(provider) {
    const session = await accessSession(this.vault, undefined, this.fetcher);
    const models = await listModels(session, attributionHeaders(), undefined, this.fetcher);
    return models.map(m => ({ ...m, provider, description: `ChatGPT account: ${session.email ?? session.subject} (${session.clientId}). Manage usage: https://chatgpt.com/settings/usage` }));
  }
  async resolveModel(provider, model, signal) {
    const session = await accessSession(this.vault, signal, this.fetcher);
    const found = (await listModels(session, attributionHeaders(), signal, this.fetcher)).find(m => m.id === model);
    if (!found) throw new Error('Choose a model available to the active ChatGPT account.');
    return { ...found, provider };
  }
  async prepareCall(provider, model, signal) {
    // Capture the selected account for preparation and dispatch. Account switches
    // cannot combine one account's catalog with another account's credentials.
    const session = await accessSession(this.vault, signal, this.fetcher);
    const found = (await listModels(session, attributionHeaders(), signal, this.fetcher)).find(m => m.id === model);
    if (!found) throw new Error('Choose a model available to the active ChatGPT account.');
    const vault = this.vault, fetcher = this.fetcher, features = this.features;
    return { model: { ...found, provider }, stream: async function* (options) {
      const stillActive = await vault.transaction(state => state.active === session.clientId && state.profiles[state.active]?.accessToken === session.accessToken);
      if (!stillActive) throw new Error('ChatGPT account changed or signed out; prepare a new request.');
      yield* infer(session, options, attributionHeaders(), fetcher, features);
    } };
  }
  async *stream(options) {
    const prepared = await this.prepareCall(options.provider, options.model, options.signal);
    yield* prepared.stream(options);
  }
}
