import { ChatGPTAdapter, PROVIDER } from './adapter.js';
export const name = 'chatgpt-subscription';
export const inject = ['llm'];
export function apply(ctx, config = {}) {
  if (Object.keys(config).length) throw new Error('This plugin accepts no configuration fields. Endpoints cannot be overridden.');
  const adapter = new ChatGPTAdapter();
  ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], adapter));
}
