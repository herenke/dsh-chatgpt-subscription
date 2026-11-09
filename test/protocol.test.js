import test from 'node:test';
import assert from 'node:assert/strict';
import { requestBody, sseEvents, responseChunks, listModels, infer, cacheSessionId } from '../src/protocol.js';
const collect = async source => { const result = []; for await (const item of source) result.push(item); return result; };
async function* events(items) { yield* items; }
const completed = { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 10, output_tokens: 3, input_tokens_details: { cached_tokens: 4 } } } };
const textEvents = [{ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '你好' }, { type: 'response.output_text.done', output_index: 0, content_index: 0, text: '你好' }, completed];
test('request maps system, developer, tool calls and results without mutating history', () => {
  const options = { model: 'account-model', system: 'system', maxTokens: 42, messages: [{ role: 'developer', content: [{ type: 'text', text: 'instructions' }] }, { role: 'assistant', content: [{ type: 'text', text: 'before' }, { type: 'tool-call', id: 'call_1', name: 'read', arguments: '{"a":1}' }] }, { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: 'result' }] }], tools: [{ name: 'read', description: 'read file', parameters: { type: 'object' } }] };
  const original = JSON.stringify(options), body = requestBody(options);
  assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.max_output_tokens, undefined); assert.equal(body.input[0].role, 'developer'); assert.equal(body.input[3].type, 'function_call'); assert.equal(body.input[4].call_id, 'call_1'); assert.equal(body.tools[0].tools[0].strict, false); assert.equal(JSON.stringify(options), original);
});
test('unsupported input/options fail explicitly', () => {
  for (const options of [{ stop: ['x'] }, { temperature: 0 }, { messages: [{ role: 'user', content: [{ type: 'image' }] }] }]) assert.throws(() => requestBody({ model: 'm', messages: [], ...options }));
});
test('model catalog is account-specific, ordered, uses slug and visibility', async () => {
  const models = await listModels({ accessToken: 'synthetic' }, { 'user-agent': 'test' }, undefined, async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/models'); assert.equal(init.headers.Authorization, 'Bearer synthetic'); assert.equal(init.headers['user-agent'], 'test');
    return new Response(JSON.stringify({ models: [{ slug: 'b', display_name: 'B', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }, { slug: 'a', visibility: 'list' }] }));
  }); assert.deepEqual(models.map(m => m.id), ['b', 'a']);
});
test('SSE handles split UTF-8, split CRLF, comment and multiline data', async () => {
  const raw = ': comment\r\ndata: {"type":\r\ndata: "你好"}\r\n\r\n'; const bytes = new TextEncoder().encode(raw);
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  assert.deepEqual(await collect(sseEvents(body)), [{ type: '你好' }]);
});
test('SSE rejects malformed JSON and unfinished final frame', async () => {
  for (const raw of ['data: {oops}\n\n', 'data: {"type":"x"}']) await assert.rejects(collect(sseEvents(new Response(raw).body)));
});
test('text streaming emits DSH blocks, disjoint usage and exactly one finish', async () => {
  const chunks = await collect(responseChunks(events(textEvents))); assert.deepEqual(chunks.map(c => c.type), ['block-start', 'text-delta', 'block-end', 'usage', 'finish']);
  assert.deepEqual(chunks[2].block, { type: 'text', text: '你好' }); assert.equal(chunks[3].usage.inputTokens, 6); assert.equal(chunks[3].usage.cacheReadTokens, 4); assert.equal(chunks.at(-1).reason.kind, 'stop');
});
test('parallel function calls preserve call IDs, raw JSON arguments and block indices', async () => {
  const chunks = await collect(responseChunks(events([
    { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'call_a', name: 'a' } },
    { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', call_id: 'call_b', name: 'b' } },
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"b":2}' },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{}' },
    { type: 'response.function_call_arguments.done', output_index: 0, arguments: '{}' },
    { type: 'response.function_call_arguments.done', output_index: 1, arguments: '{"b":2}' }, completed,
  ]))); assert.equal(chunks.at(-1).reason.kind, 'tool-calls'); const ends = chunks.filter(c => c.type === 'block-end'); assert.equal(ends[0].block.id, 'call_a'); assert.equal(ends[1].index, 1); assert.equal(ends[1].block.arguments, '{"b":2}');
});
test('post-delta quota failure, incomplete and disconnect never finish successfully', async () => {
  for (const terminal of [[], [{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'secret should not reflect' } } }], [{ type: 'response.incomplete' }], [completed]]) {
    const chunks = []; await assert.rejects(async () => { for await (const c of responseChunks(events([textEvents[0], ...terminal]))) chunks.push(c); }); assert.ok(!chunks.some(c => c.type === 'finish'));
  }
});
test('mismatched tool completion and unsupported output fail closed', async () => {
  await assert.rejects(collect(responseChunks(events([{ type: 'response.function_call_arguments.done', output_index: 0, arguments: '{}' }]))));
  await assert.rejects(collect(responseChunks(events([{ type: 'response.output_item.added', item: { type: 'web_search_call' } }]))));
});
test('tool arguments delivered only in the done event still complete', async () => {
  // Observed gateway stream: the added item carries empty arguments, no
  // argument deltas arrive, and the done event holds the complete payload.
  const chunks = await collect(responseChunks(events([
    { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'call_a', name: 'bash', namespace: 'dsh', arguments: '' } },
    { type: 'response.function_call_arguments.done', output_index: 0, arguments: '{"command":"pwd"}' },
    completed,
  ])));
  const deltas = chunks.filter(c => c.type === 'tool-call-delta').map(c => c.argumentsDelta).join('');
  const end = chunks.find(c => c.type === 'block-end');
  assert.equal(end.block.arguments, '{"command":"pwd"}'); assert.equal(deltas, end.block.arguments);
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls'); assert.equal(chunks.at(-1).failure, undefined);
});
test('tool arguments already present on the added item are not duplicated', async () => {
  const chunks = await collect(responseChunks(events([
    { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'call_a', name: 'bash', namespace: 'dsh', arguments: '{"command":"pwd"}' } },
    { type: 'response.function_call_arguments.done', output_index: 0, arguments: '{"command":"pwd"}' },
    completed,
  ])));
  assert.equal(chunks.filter(c => c.type === 'tool-call-delta').map(c => c.argumentsDelta).join(''), '{"command":"pwd"}');
  assert.equal(chunks.find(c => c.type === 'block-end').block.arguments, '{"command":"pwd"}');
});
test('text delivered only in the done event starts and ends its block', async () => {
  const chunks = await collect(responseChunks(events([{ type: 'response.output_text.done', output_index: 0, content_index: 0, text: 'hello' }, completed])));
  assert.deepEqual(chunks.map(c => c.type), ['block-start', 'text-delta', 'block-end', 'usage', 'finish']);
  assert.equal(chunks[1].text, 'hello');
  assert.deepEqual(chunks[2].block, { type: 'text', text: 'hello' });
});
test('a done payload that does not extend the streamed block still fails', async () => {
  // Truncated payload, divergent payload and a repeated completion must not be
  // silently accepted as a successful turn.
  for (const terminal of [
    [{ type: 'response.output_text.done', output_index: 0, content_index: 0, text: 'hel' }, completed],
    [{ type: 'response.output_text.done', output_index: 0, content_index: 0, text: 'HELLO' }, completed],
    [{ type: 'response.output_text.done', output_index: 0, content_index: 0, text: 'hello' }, { type: 'response.output_text.done', output_index: 0, content_index: 0, text: 'hello' }, completed],
  ]) {
    const chunks = [];
    await assert.rejects(async () => { for await (const c of responseChunks(events([{ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'hello' }, ...terminal]))) chunks.push(c); });
    assert.ok(!chunks.some(c => c.type === 'finish'));
  }
});
test('cache session identity is opaque, deterministic and unique per purpose', () => {
  const id = cacheSessionId('dsh-session-1');
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(id, cacheSessionId('dsh-session-1'));
  assert.notEqual(id, cacheSessionId('dsh-session-2'));
  assert.notEqual(id, cacheSessionId('dsh-session-1', 'compaction'));
  assert.notEqual(cacheSessionId('dsh-session-1'), cacheSessionId('dsh-session-1', 'session-title'));
  assert.ok(!id.includes('dsh-session-1'));
});
test('inference sends the session identity header and omits it without one', async () => {
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push(init.headers.session_id);
    return new Response(textEvents.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  };
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }];
  await collect(infer({ accessToken: 'test-token' }, { model: 'm', messages, sessionId: 'session-a' }, { 'user-agent': 'dsh-test' }, fetcher));
  await collect(infer({ accessToken: 'test-token' }, { model: 'm', messages, sessionId: 'session-a' }, {}, fetcher));
  await collect(infer({ accessToken: 'test-token' }, { model: 'm', messages, sessionId: 'session-b' }, {}, fetcher));
  await collect(infer({ accessToken: 'test-token' }, { model: 'm', messages, sessionId: 'session-a', purpose: 'session-title' }, {}, fetcher));
  await collect(infer({ accessToken: 'test-token' }, { model: 'm', messages }, {}, fetcher));
  assert.equal(seen[0], cacheSessionId('session-a')); assert.equal(seen[1], cacheSessionId('session-a'));
  assert.equal(seen[2], cacheSessionId('session-b')); assert.equal(seen[3], cacheSessionId('session-a', 'session-title'));
  assert.equal(seen[4], undefined);
});
test('mock wire inference uses public endpoint, bearer, attribution and required flags', async () => {
  const response = textEvents.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''); let count = 0;
  const chunks = await collect(infer({ accessToken: 'test-token' }, { model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] }, { 'user-agent': 'dsh-test' }, async (url, init) => {
    count++; assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init.headers.Authorization, 'Bearer test-token'); assert.equal(init.headers['user-agent'], 'dsh-test'); const body = JSON.parse(init.body); assert.equal(body.stream, true); assert.equal(body.store, false); assert.equal(init.redirect, 'error');
    return new Response(response, { headers: { 'content-type': 'text/event-stream' } });
  })); assert.equal(chunks.at(-1).reason.kind, 'stop'); assert.equal(count, 1);
});
test('HTTP errors do not echo response bodies or retry/fallback', async () => {
  let count = 0; await assert.rejects(collect(infer({ accessToken: 'test-token' }, { model: 'm', messages: [] }, {}, async () => { count++; return new Response('secret-token', { status: 429 }); })), error => !error.message.includes('secret-token') && /429/.test(error.message)); assert.equal(count, 1);
});
