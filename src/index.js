import { ChatGPTAdapter, PROVIDER } from './adapter.js';
export const name = 'chatgpt-subscription';
export const inject = ['llm'];
export function apply(ctx, config = {}) {
  if (Object.keys(config).some(key => key !== 'webSearch') || (config.webSearch !== undefined && typeof config.webSearch !== 'boolean')) throw new Error('Only webSearch (boolean) is configurable. Endpoints cannot be overridden.');
  const adapter = new ChatGPTAdapter(undefined, undefined, { attachments: () => ctx.get('attachments'), webSearch: config.webSearch === true });
  ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], adapter));
}
