import { LlmError, isContextWindowExceededError } from '@deepseek-ai/dsh-llm';
const known = new Set(['context_length_exceeded','context_window_exceeded','invalid_grant','invalid_request_error','invalid_request','invalid_api_key','rate_limit_exceeded','insufficient_quota','subscription_sharing_usage_limit_exceeded','subscription_sharing_usage_unavailable','max_output_tokens','content_filter']);
export function providerError(value, status) {
  const data = value?.error ?? value ?? {};
  const code = known.has(data.code) ? data.code : known.has(data.type) ? data.type : undefined;
  // Inspect provider wording only for classification; never return or log it.
  const detail = [data.code,data.type,data.message].filter(x => typeof x === 'string').join(' ');
  if (isContextWindowExceededError(detail)) return new LlmError('OpenAI rejected the request because its context window was exceeded.', 'CONTEXT_WINDOW_EXCEEDED', status ? { status } : undefined);
  if (['subscription_sharing_usage_limit_exceeded','subscription_sharing_usage_unavailable','insufficient_quota'].includes(code)) return new LlmError(`ChatGPT plan unavailable (${code}). Review https://chatgpt.com/settings/usage; retrying does not reset limits.`, 'QUOTA', status ? { status } : undefined);
  const kind = status === 401 || code === 'invalid_grant' || code === 'invalid_api_key' ? 'AUTH' : status === 403 ? 'FORBIDDEN' : status === 429 || code === 'rate_limit_exceeded' ? 'RATE_LIMIT' : status >= 500 ? 'SERVER' : 'INVALID_REQUEST';
  return new LlmError(`OpenAI request failed${status ? ` (HTTP ${status})` : ''}${code ? ` (${code})` : ''}. No automatic paid fallback is configured.`, kind, status ? { status } : undefined);
}
export async function httpError(response) {
  let data;
  const reader = response.body?.getReader();
  try {
    if (reader) {
      const chunks=[]; let size=0;
      while (true) {
        const item=await reader.read(); if (item.done) break;
        size+=item.value.byteLength; if (size>65536) break;
        chunks.push(Buffer.from(item.value));
      }
      if (size<=65536) try { data=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* do not reflect provider body */ }
    }
  } catch { /* preserve HTTP status without leaking parser details */ }
  finally { if (reader) { await reader.cancel().catch(()=>{}); reader.releaseLock(); } }
  return providerError(data,response.status);
}
export function safeDiagnostic(error, stage) {
  const allowed = new Set(['MISSING_CREDENTIAL','INVALID_CREDENTIAL','INVALID_CONFIG','VAULT_BUSY','AUTH','ABORTED','TIMEOUT','TRANSPORT','QUOTA','CONTEXT_WINDOW_EXCEEDED']);
  const code = allowed.has(error?.code) ? error.code : 'OPERATION_FAILED';
  const hint = code === 'MISSING_CREDENTIAL' ? 'Provide the vault passphrase using the documented environment variable or owner-only file, and sign in if needed.' : code === 'INVALID_CREDENTIAL' ? 'Check the passphrase file path, permissions, format and password.' : code === 'VAULT_BUSY' ? 'Wait for the other operation; never remove a lock while a process is using it.' : code === 'AUTH' ? 'Review account permission or sign in again.' : 'Check the account, local credential configuration and network. No tokens or authorization URLs are printed.';
  return `Operation failed at ${stage} (${code}). ${hint}`;
}
