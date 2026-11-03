import { officialFetch, RESOURCE } from './auth.js';
import { prepareImages, imageContent } from './images.js';
import { saveReplay, readReplay } from './replay.js';
import { LlmError } from '@deepseek-ai/dsh-llm';
import { httpError, providerError } from './errors.js';

export async function listModels(session, headers = {}, signal, fetcher) {
  const response = await officialFetch(`${RESOURCE}/models`, { headers: { ...headers, Authorization: `Bearer ${session.accessToken}` }, signal }, fetcher);
  if (!response.ok) throw await httpError(response);
  const body = await response.json();
  if (!Array.isArray(body.models)) throw new Error('Unexpected ChatGPT model catalog.');
  return body.models.filter(m => m.visibility === 'list' && typeof m.slug === 'string' && m.slug.length > 0).map(m => ({ id: m.slug, name: typeof m.display_name === 'string' ? m.display_name : m.slug, ...(Number.isSafeInteger(m.context_window) && m.context_window > 0 ? { contextWindow: m.context_window } : {}), ...(Array.isArray(m.input_modalities) && m.input_modalities.includes('text') ? { inputModalities: ['text', ...(m.input_modalities.includes('image') ? ['image'] : [])] } : {}) }));
}
export function requestBody(options, versions = new Map(), features = {}) {
  if (options.stop?.length) throw new Error('Stop sequences are not supported by this Responses adapter.');
  if (options.temperature !== undefined) throw new Error('ChatGPT plan usage does not support temperature. Remove the setting.');
  const input = [];
  if (options.system) input.push({ role: 'developer', content: options.system });
  for (const message of options.messages) {
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
    if (!Array.isArray(blocks)) throw new Error('Unsupported message content.');
    if (message.role === 'tool') {
      if (blocks.some(b => !['text','image'].includes(b.type))) throw new Error('Unsupported tool result content.');
      const output = blocks.some(b => b.type === 'image') ? blocks.flatMap(b => b.type === 'image' ? imageContent(b, versions) : [{ type: 'input_text', text: b.text }]) : blocks.map(b => b.text).join('\n');
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output });
      continue;
    }
    if (message.role === 'assistant') { const replay = readReplay(message, features.replay); if (replay) { input.push(...replay); continue; } }
    if (message.role === 'user' && blocks.some(b => b.type === 'image')) {
      if (blocks.some(b => !['text','image'].includes(b.type))) throw new Error('Unsupported multimodal user content.');
      input.push({ role: 'user', content: blocks.flatMap(b => b.type === 'image' ? imageContent(b, versions) : [{ type: 'input_text', text: b.text }]) });
      continue;
    }
    if (!['system', 'developer', 'user', 'assistant'].includes(message.role)) throw new Error('Unsupported message role.');
    // Preserve interleaved text/tool order. Hidden reasoning is deliberately not fabricated or replayed.
    for (const block of blocks) {
      if (block.type === 'text') input.push({ role: message.role === 'system' ? 'developer' : message.role, content: block.text });
      else if (block.type === 'tool-call' && message.role === 'assistant') input.push({ type: 'function_call', call_id: block.id, namespace: 'dsh', name: block.name, arguments: block.arguments });
      else if (block.type === 'reasoning' && message.role === 'assistant') continue;
      else throw new Error(`Unsupported content block: ${block.type}. This adapter supports text, DSH image attachments and function tools.`);
    }
  }
  return {
    model: options.model, input, stream: true, store: false,
    ...((options.tools?.length || features.webSearch) ? { tools: [
      ...(options.tools?.length ? [{ type: 'namespace', name: 'dsh', description: 'Tools executed locally by DeepSeek Harness under its authorization controls.', tools: options.tools.filter(t => !t.deferLoading).map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false })) }].filter(ns => ns.tools.length) : []),
      ...(features.webSearch ? [{ type: 'web_search' }] : []),
    ] } : {}),
    // This subscription route rejects max_output_tokens; the host's proposal is
    // deliberately omitted rather than falsely presented as an enforced cap.
    ...(options.reasoningEffort === undefined ? {} : { reasoning: { effort: options.reasoningEffort } }),
  };
}
export async function* sseEvents(body) {
  if (!body) throw new Error('Missing OpenAI response stream.');
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Do not replace trailing CR until the next byte arrives (CRLF can be split).
      buffer = buffer.replace(/\r\n/g, '\n');
      if (buffer.length > 4 * 1024 * 1024) throw new Error('OpenAI event exceeds size limit.');
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (data && data !== '[DONE]') { let event; try { event = JSON.parse(data); } catch { throw new Error('Malformed OpenAI stream event.'); } yield event; }
      }
      if (done) { if (buffer.trim()) throw new Error('Truncated OpenAI stream event.'); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function* responseChunks(events, features = {}) {
  const blocks = new Map(); let nextIndex = 0, tools = false, completed = false;
  const emitted = [];
  const nativeItems = new Map();
  const keyOf = e => `${e.output_index}:${e.content_index ?? 0}`;
  for await (const e of events) {
    if (e.type === 'response.output_item.done') {
      if (!['message','function_call','reasoning', ...(features.webSearch ? ['web_search_call'] : [])].includes(e.item?.type)) throw new Error('Unsupported OpenAI output item.');
      nativeItems.set(e.output_index, e.item);
    }
    if (e.type === 'response.output_item.added' && e.item?.type === 'function_call') {
      const key = `${e.output_index}:tool`;
      if (blocks.has(key) || !e.item.call_id || !e.item.name || (e.item.namespace && e.item.namespace !== 'dsh')) throw new Error('Invalid OpenAI tool event.');
      tools = true;
      const b = { index: nextIndex++, type: 'tool-call', id: e.item.call_id, name: e.item.name, arguments: '', ended: false }; blocks.set(key, b);
      yield { type: 'block-start', index: b.index, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: b.index, id: b.id, name: b.name, argumentsDelta: '' };
    } else if (e.type === 'response.function_call_arguments.delta') {
      const b = blocks.get(`${e.output_index}:tool`); if (!b || b.ended || typeof e.delta !== 'string') throw new Error('Invalid OpenAI tool delta.');
      b.arguments += e.delta;
      yield { type: 'tool-call-delta', index: b.index, id: b.id, argumentsDelta: e.delta };
    } else if (e.type === 'response.output_text.delta') {
      const key = keyOf(e); let b = blocks.get(key);
      if (!b) { b = { index: nextIndex++, type: 'text', text: '', ended: false }; blocks.set(key, b); yield { type: 'block-start', index: b.index, blockType: 'text' }; }
      if (b.ended || typeof e.delta !== 'string') throw new Error('Invalid OpenAI text delta.');
      b.text += e.delta; yield { type: 'text-delta', index: b.index, text: e.delta };
    } else if (e.type === 'response.function_call_arguments.done' || e.type === 'response.output_text.done') {
      const isTool = e.type === 'response.function_call_arguments.done';
      const key = isTool ? `${e.output_index}:tool` : keyOf(e);
      let b = blocks.get(key);
      // Text can finish empty without any delta.
      if (!b && !isTool && e.text === '') { b = { index: nextIndex++, type: 'text', text: '', ended: false }; blocks.set(key, b); yield { type: 'block-start', index: b.index, blockType: 'text' }; }
      if (!b || b.ended || (isTool ? e.arguments !== b.arguments : e.text !== b.text)) throw new Error('OpenAI block completion mismatch.');
      b.ended = true;
      const { index, ended, ...block } = b; emitted.push({ index, block }); yield { type: 'block-end', index, block };
    } else if (e.type === 'response.completed') {
      if (e.response?.status !== 'completed' || [...blocks.values()].some(b => !b.ended)) throw new Error('Incomplete OpenAI output.');
      const output = e.response.output ?? [...nativeItems].sort(([a],[b]) => a-b).map(([,item]) => item);
      const streamedBlocks = emitted.slice().sort((a,b)=>a.index-b.index).map(e=>e.block);
      if (features.webSearch) {
        const links = new Map();
        for (const item of output) for (const content of item.content ?? []) for (const a of content.annotations ?? []) {
          if (a.type !== 'url_citation' || typeof a.url !== 'string') continue;
          let url; try { url = new URL(a.url); } catch { continue; }
          if (!['https:','http:'].includes(url.protocol)) continue;
          links.set(url.href, typeof a.title === 'string' ? a.title.replace(/[\[\]\r\n]/g,' ') : url.hostname);
        }
        if (links.size) {
          const block = { type: 'text', text: '\n\nSources:\n' + [...links].map(([url,title]) => `- [${title}](${url.replace(/\(/g,'%28').replace(/\)/g,'%29')})`).join('\n') };
          const index = nextIndex++; emitted.push({index,block});
          yield {type:'block-start',index,blockType:'text'}; yield {type:'text-delta',index,text:block.text}; yield {type:'block-end',index,block};
        }
      }
      const replayState = saveReplay(output, emitted.sort((a,b)=>a.index-b.index).map(e=>e.block), features.replay, streamedBlocks);
      const usage = e.response.usage;
      if (usage) {
        const cached = usage.input_tokens_details?.cached_tokens ?? 0;
        if (![usage.input_tokens, usage.output_tokens, cached].every(n => Number.isInteger(n) && n >= 0) || cached > usage.input_tokens) throw new Error('Invalid OpenAI token usage.');
        yield { type: 'usage', usage: { inputTokens: usage.input_tokens - cached, outputTokens: usage.output_tokens, cacheReadTokens: cached, totalTokens: usage.input_tokens + usage.output_tokens, ...(Number.isInteger(usage.output_tokens_details?.reasoning_tokens) ? { reasoningTokens: usage.output_tokens_details.reasoning_tokens } : {}) } };
      }
      completed = true; yield { type: 'finish', reason: { kind: tools ? 'tool-calls' : 'stop' }, ...(replayState ? { replayState } : {}) }; return;
    } else if (e.type === 'response.failed' || e.type === 'error') {
      throw providerError(e.response?.error ?? e);
    } else if (e.type === 'response.incomplete') {
      const reason = e.response?.incomplete_details?.reason;
      throw new LlmError(`OpenAI response incomplete${['max_output_tokens','content_filter'].includes(reason) ? ` (${reason})` : ''}; partial output must not be treated as success.`, 'INCOMPLETE_RESPONSE');
    } else if (e.type === 'response.output_item.added' && !['message', 'reasoning', ...(features.webSearch ? ['web_search_call'] : [])].includes(e.item?.type)) {
      throw new Error('Unsupported OpenAI output item.');
    } else if (e.type === 'response.refusal.delta' || e.type === 'response.refusal.done') {
      throw new Error('OpenAI refused this response.');
    }
  }
  if (!completed) throw new Error('OpenAI stream ended before response.completed.');
}
export async function* infer(session, options, headers = {}, fetcher, features = {}) {
  if (options.temperature !== undefined || options.stop?.length) requestBody(options);
  const versions = await prepareImages(options, typeof features.attachments === 'function' ? features.attachments() : features.attachments);
  const replay = { session, model: options.model, provider: options.provider };
  const body = requestBody(options, versions, { ...features, replay });
  const response = await officialFetch(`${RESOURCE}/responses`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: options.signal }, fetcher);
  if (!response.ok) throw await httpError(response);
  if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Expected an OpenAI event stream.');
  yield* responseChunks(sseEvents(response.body), { ...features, replay });
}
