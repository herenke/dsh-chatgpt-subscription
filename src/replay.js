import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scope = session => hash([session.clientId, session.subject]);
export function canonicalBlocks(blocks) {
  return blocks.filter(b => b.type === 'tool-call' || (b.type === 'text' && b.text.trim())).map(b => b.type === 'text' ? { type: b.type, text: b.text } : { type: b.type, id: b.id, name: b.name, arguments: b.arguments });
}
function nativeOutput(output) {
  if (!Array.isArray(output)) return undefined;
  for (const item of output) {
    if (!item || !['message','function_call','reasoning','web_search_call'].includes(item.type)) return undefined;
    if (item.type === 'message' && (item.role !== 'assistant' || !Array.isArray(item.content) || item.content.some(c => c.type !== 'output_text' || typeof c.text !== 'string'))) return undefined;
    if (item.type === 'function_call' && !['name','arguments','call_id'].every(k => typeof item[k] === 'string' && item[k])) return undefined;
    if (item.type === 'reasoning' && (typeof item.encrypted_content !== 'string' || !item.encrypted_content)) return undefined;
  }
  return JSON.parse(JSON.stringify(output));
}
export function saveReplay(output, blocks, context, streamedBlocks = blocks) {
  if (!context?.session || !context.model) return undefined;
  const items = nativeOutput(output);
  if (!items?.length) return undefined;
  const visible = items.flatMap(item => item.type === 'message' ? item.content.map(c => ({ type: 'text', text: c.text })) : item.type === 'function_call' ? [{ type: 'tool-call', id: item.call_id, name: item.name, arguments: item.arguments }] : []);
  if (hash(canonicalBlocks(visible)) !== hash(canonicalBlocks(streamedBlocks))) return undefined;
  return { response: { kind: 'dsh-chatgpt-responses', version: 1, account: scope(context.session), provider: context.provider, model: context.model, contentHash: hash(canonicalBlocks(blocks)), output: items } };
}
export function readReplay(message, context) {
  const state = message.source?.replayState?.response;
  if (!state || state.kind !== 'dsh-chatgpt-responses' || state.version !== 1 || !context?.session) return undefined;
  if (message.source.provider !== context.provider || message.source.model !== context.model || state.provider !== context.provider || state.model !== context.model || state.account !== scope(context.session) || state.contentHash !== hash(canonicalBlocks(message.content))) return undefined;
  // After compaction, edits, account/model/provider switches, replay the visible
  // content normally instead of combining incompatible encrypted reasoning.
  return nativeOutput(state.output);
}
