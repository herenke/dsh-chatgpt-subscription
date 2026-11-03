import { ChatGPTAdapter, PROVIDER } from './adapter.js';
export const name = 'chatgpt-subscription';
export const inject = ['llm'];
export function apply(ctx, config = {}) {
  const allowed = ['webSearch', 'passphraseFile', 'vaultPath', 'contextWindow', 'modelContextWindows'];
  const capacity = value => Number.isSafeInteger(value) && value > 0;
  if (Object.keys(config).some(key => !allowed.includes(key))
    || (config.webSearch !== undefined && typeof config.webSearch !== 'boolean')
    || ['passphraseFile','vaultPath'].some(key => config[key] !== undefined && (typeof config[key] !== 'string' || !config[key]))
    || (config.contextWindow !== undefined && !capacity(config.contextWindow))
    || (config.modelContextWindows !== undefined && (!config.modelContextWindows || typeof config.modelContextWindows !== 'object' || Array.isArray(config.modelContextWindows) || Object.values(config.modelContextWindows).some(value => !capacity(value))))) throw new Error('Invalid ChatGPT plugin configuration. Use documented fields; endpoints and tokens cannot be configured.');
  const adapter = new ChatGPTAdapter(undefined, undefined, { ...config, attachments: () => ctx.get('attachments'), webSearch: config.webSearch === true });
  ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], adapter));
}
