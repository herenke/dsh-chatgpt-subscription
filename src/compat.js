import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runtime adapter-package versions this plugin has been verified against.
 * The package gate accepts any 0.2.x; a runtime outside this list keeps working
 * when the adapter API resolves, but activation reports it as unverified.
 */
export const TESTED_LLM_VERSIONS = Object.freeze(['0.2.1-rc.5', '0.2.2-alpha.3', '0.2.2-rc.1']);

/**
 * Describe a runtime outside the verified set, or undefined for a verified one.
 * @param version - resolved `@deepseek-ai/dsh-llm` version, or undefined when unknown.
 * @returns log line for an unverified runtime, otherwise undefined.
 */
export function untestedRuntimeWarning(version) {
  if (typeof version !== 'string' || version.length === 0) return undefined;
  if (TESTED_LLM_VERSIONS.includes(version)) return undefined;
  return `dsh-chatgpt-subscription: @deepseek-ai/dsh-llm ${version} is outside the verified set (${TESTED_LLM_VERSIONS.join(', ')}); the adapter API resolved and is used, but behavior on this runtime is unverified.`;
}

/**
 * Read the version of the @deepseek-ai/dsh-llm copy this process resolves,
 * which is the adapter contract the plugin actually loaded.
 * @returns the package version, or undefined when it cannot be read.
 */
export function resolvedLlmVersion() {
  try {
    const entry = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-llm'));
    let dir = dirname(entry);
    for (let depth = 0; depth < 8; depth += 1) {
      try {
        const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        if (manifest.name === '@deepseek-ai/dsh-llm' && typeof manifest.version === 'string') return manifest.version;
      } catch { /* not this directory, keep walking up */ }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* unresolvable package: the static imports report the failure */ }
  return undefined;
}
