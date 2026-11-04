import z from '@deepseek-ai/schemastery';
import { ChatGPTAdapter, PROVIDER } from './adapter.js';
import { resolvedLlmVersion, untestedRuntimeWarning } from './compat.js';

export const name = 'chatgpt-subscription';
export const inject = ['llm'];

/**
 * Row configuration. `enabled` is volatile on purpose: the Models settings card
 * flips it at runtime, and a volatile field reaches this apply as a live
 * reference instead of a frozen load-time value.
 */
export const Config = z.object({
  enabled: z.boolean().default(true)
    .description('Register the ChatGPT subscription provider. Disable it when api.openai.com is unreachable so the model picker stops loading it.')
    .volatile(),
  webSearch: z.boolean().default(false)
    .description('Expose the OpenAI hosted web_search tool for this provider.'),
  passphraseFile: z.string().default('')
    .description('Owner-only (0600) file holding the vault passphrase; used by GUI launches.'),
  vaultPath: z.string().default('')
    .description('Absolute path of the encrypted credential vault.'),
  contextWindow: z.number().step(1).min(1)
    .description('Context capacity used when the account catalog does not disclose one.'),
  modelContextWindows: z.dict(z.number().step(1).min(1)).default({})
    .description('Per-model context capacity overrides keyed by model id.'),
});

const capacity = value => Number.isSafeInteger(value) && value > 0;
/** Read a volatile configuration reference or a plain load-time value. */
function valueOf(value, fallback) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    const current = value.get();
    return current === undefined ? fallback : current;
  }
  return value === undefined ? fallback : value;
}
const optionalPath = value => value === undefined || value === '' || typeof value === 'string';

export function apply(ctx, config = {}) {
  const allowed = ['enabled', 'webSearch', 'passphraseFile', 'vaultPath', 'contextWindow', 'modelContextWindows'];
  if (Object.keys(config).some(key => !allowed.includes(key))
    || typeof valueOf(config.enabled, true) !== 'boolean'
    || typeof valueOf(config.webSearch, false) !== 'boolean'
    || ['passphraseFile', 'vaultPath'].some(key => !optionalPath(config[key]))
    || (config.contextWindow !== undefined && !capacity(config.contextWindow))
    || (config.modelContextWindows !== undefined && (!config.modelContextWindows || typeof config.modelContextWindows !== 'object' || Array.isArray(config.modelContextWindows) || Object.values(config.modelContextWindows).some(value => !capacity(value))))) {
    throw new Error('Invalid ChatGPT plugin configuration. Use documented fields; endpoints and tokens cannot be configured.');
  }

  // The manifest gate accepts the verified 0.2.x range; a runtime outside the
  // tested adapter-package versions still activates, but is reported as unverified.
  const warning = untestedRuntimeWarning(resolvedLlmVersion());
  if (warning !== undefined) ctx.logger?.warn?.(warning);

  const features = {
    webSearch: valueOf(config.webSearch, false) === true,
    ...(config.passphraseFile ? { passphraseFile: config.passphraseFile } : {}),
    ...(config.vaultPath ? { vaultPath: config.vaultPath } : {}),
    ...(config.contextWindow !== undefined ? { contextWindow: config.contextWindow } : {}),
    ...(config.modelContextWindows !== undefined ? { modelContextWindows: { ...config.modelContextWindows } } : {}),
    attachments: () => ctx.get('attachments'),
  };
  const enabled = () => valueOf(config.enabled, true) !== false;

  let adapter;
  let registration;
  const sync = () => {
    if (!enabled()) {
      if (registration !== undefined) {
        registration();
        registration = undefined;
        ctx.logger?.info?.('dsh-chatgpt-subscription: disabled; the provider is no longer registered.');
      }
      return;
    }
    if (registration !== undefined) return;
    adapter ??= new ChatGPTAdapter(undefined, undefined, features);
    registration = ctx.llm.registerAdapter([PROVIDER], adapter);
    ctx.logger?.info?.('dsh-chatgpt-subscription: enabled; the provider is registered.');
  };

  sync();
  // The Models settings card writes the volatile `enabled` field; the loader
  // announces the new configuration without restarting this plugin.
  ctx.on('loader/volatile-update', () => {
    try { sync(); } catch (error) {
      ctx.logger?.error?.('dsh-chatgpt-subscription: failed to apply the enabled switch.');
      ctx.logger?.error?.(error);
    }
  });
}
