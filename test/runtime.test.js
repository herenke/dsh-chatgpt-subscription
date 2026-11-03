import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { ChatGPTAdapter, PROVIDER } from '../src/adapter.js';

const collect = async source => { const result = []; for await (const item of source) result.push(item); return result; };
function fixture() {
  const profile = { clientId: 'oaiapp_test', subject: 'test-subject', email: 'synthetic@example.test', accessToken: 'synthetic', scopes: ['chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3600000 };
  const state = { active: profile.clientId, profiles: { [profile.clientId]: profile } };
  const vault = { transaction: async fn => fn(state) };
  const wire = [
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'works' },
    { type: 'response.output_text.done', output_index: 0, content_index: 0, text: 'works' },
    { type: 'response.completed', response: { status: 'completed' } },
  ];
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    assert.match(init.headers['user-agent'], /^deepseek-harness\//);
    if (url.endsWith('/models')) return new Response(JSON.stringify({ models: [{ slug: 'test-model', display_name: 'Test', visibility: 'list' }] }));
    return new Response(wire.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  return { adapter: new ChatGPTAdapter(vault, fetcher), state, requests };
}
test('real DSH LLM runtime accepts adapter, discovers and streams', async () => {
  const ctx = new Context(); await ctx.plugin(LlmRuntime);
  try {
    const { adapter } = fixture(); assert.ok(adapter instanceof LlmAdapter);
    const dispose = ctx.llm.registerAdapter([PROVIDER], adapter);
    const models = await ctx.llm.listModels(PROVIDER); assert.ok(models.some(m => m.provider === PROVIDER && m.id === 'test-model'));
    const chunks = await collect(ctx.llm.stream({ provider: PROVIDER, model: 'test-model', messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }] }));
    assert.equal(chunks.at(-1).reason.kind, 'stop'); assert.equal(chunks.find(c => c.type === 'block-end').block.text, 'works');
    dispose(); assert.ok(!ctx.llm.listProviders().some(p => p.id === PROVIDER));
  } finally { await ctx.fiber.dispose(); }
});
test('prepared request refuses account switch or local logout before dispatch', async () => {
  const { adapter, state, requests } = fixture(); const prepared = await adapter.prepareCall(PROVIDER, 'test-model'); state.active = null;
  await assert.rejects(collect(prepared.stream({ model: 'test-model', messages: [] })), /changed or signed out|Sign in first/);
  assert.equal(requests.filter(r => r.url.endsWith('/responses')).length, 0);
});
test('runtime reports stream failures as terminal error and no retry policy', async () => {
  const ctx = new Context(); await ctx.plugin(LlmRuntime);
  try {
    const { adapter } = fixture(); adapter.fetcher = async () => new Response(JSON.stringify({ models: [] })); ctx.llm.registerAdapter([PROVIDER], adapter);
    const chunks = await collect(ctx.llm.stream({ provider: PROVIDER, model: 'missing', messages: [] }));
    assert.equal(chunks.at(-1).reason.kind, 'error'); assert.equal(adapter.providerRetryPolicy().maxRetries, 0);
  } finally { await ctx.fiber.dispose(); }
});

test('plugin namespace activates and disposes its provider using real Cordis effects', async () => {
  const plugin = await import('../src/index.js');
  assert.deepEqual(Object.keys(plugin).sort(), ['apply', 'inject', 'name']);
  const before = process.env.DSH_CHATGPT_VAULT_PASSWORD;
  process.env.DSH_CHATGPT_VAULT_PASSWORD = 'synthetic-test-password-only';
  const ctx = new Context(); await ctx.plugin(LlmRuntime);
  try {
    const fiber = await ctx.plugin(plugin, {});
    assert.ok(ctx.llm.listProviders().some(p => p.id === PROVIDER));
    await fiber.dispose();
    assert.ok(!ctx.llm.listProviders().some(p => p.id === PROVIDER));
  } finally {
    await ctx.fiber.dispose();
    if (before === undefined) delete process.env.DSH_CHATGPT_VAULT_PASSWORD; else process.env.DSH_CHATGPT_VAULT_PASSWORD = before;
  }
});
