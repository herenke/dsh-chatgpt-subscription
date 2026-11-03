import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, writeFile, readFile, mkdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import * as plugin from '../src/index.js';
import { ChatGPTAdapter, PROVIDER, DEFAULT_CONTEXT_WINDOW } from '../src/adapter.js';
import { Vault, createVault } from '../src/vault.js';
import { accessSession, officialFetch, RESOURCE } from '../src/auth.js';
import { infer, responseChunks } from '../src/protocol.js';
import { safeDiagnostic } from '../src/errors.js';
const pass='synthetic-review-passphrase-123';
const collect=async source=>{const out=[];for await(const item of source)out.push(item);return out;};
async function* events(values){yield* values;}
async function fixture(t, expired=false){
  const root=await mkdtemp(join(tmpdir(),'dsh-usability-'));await chmod(root,0o700);t.after(()=>rm(root,{recursive:true,force:true}));
  const vault=new Vault(join(root,'accounts.vault'),pass,{lockWaitMs:10000,pollMs:5});
  await vault.transaction(state=>{state.active='oaiapp_test';state.profiles[state.active]={clientId:state.active,subject:'test-subject',sessionId:'login-1',accessToken:'synthetic-old',refreshToken:'synthetic-refresh',scopes:['chatgpt.tokens.use.direct'],expiresAt:expired?0:Date.now()+3600000};});
  return {root,vault};
}
const tokens=()=>new Response(JSON.stringify({access_token:'synthetic-new',refresh_token:'synthetic-rotated',token_type:'Bearer',expires_in:3600}));

test('plugin activation without a passphrase still registers the provider',async()=>{
  const old=process.env.DSH_CHATGPT_VAULT_PASSWORD;delete process.env.DSH_CHATGPT_VAULT_PASSWORD;
  const ctx=new Context();await ctx.plugin(LlmRuntime);
  try {await ctx.plugin(plugin,{});assert.ok(ctx.llm.listProviders().some(p=>p.id===PROVIDER));}
  finally{await ctx.fiber.dispose();if(old!==undefined)process.env.DSH_CHATGPT_VAULT_PASSWORD=old;}
});
test('20 simultaneous sessions read a fresh vault without lock failures or writes',async t=>{
  const {vault}=await fixture(t);const before=await readFile(vault.path);const sessions=await Promise.all(Array.from({length:20},()=>accessSession(vault)));
  assert.ok(sessions.every(s=>s.accessToken==='synthetic-old'));assert.deepEqual(await readFile(vault.path),before);
});
test('20 simultaneous expired sessions consume the rotating token only once',async t=>{
  const {vault}=await fixture(t,true);let refreshes=0;
  const sessions=await Promise.all(Array.from({length:20},()=>accessSession(vault,undefined,async()=>{refreshes++;await delay(20);return tokens();})));
  assert.equal(refreshes,1);assert.ok(sessions.every(s=>s.accessToken==='synthetic-new'));
});
test('read-only transactions preserve ciphertext and mtime',async t=>{
  const {vault}=await fixture(t);const before=await readFile(vault.path),time=(await stat(vault.path)).mtimeMs;
  await vault.transaction(s=>s.active);await vault.snapshot();assert.deepEqual(await readFile(vault.path),before);assert.equal((await stat(vault.path)).mtimeMs,time);
});
test('refresh network does not hold the state lock, and cannot reactivate a logged-out account',async t=>{
  const {vault}=await fixture(t,true);let release,started;const calls=[];const start=new Promise(r=>started=r),gate=new Promise(r=>release=r);
  const result=accessSession(vault,undefined,async(url,init)=>{calls.push({url,body:init.body});if(url.endsWith('/revoke'))return new Response(null,{status:200});started();await gate;return tokens();});await start;
  await vault.transaction(s=>{s.profiles[s.active]={clientId:'oaiapp_test',subject:'test-subject'};s.active=null;});release();
  await assert.rejects(result,/changed or signed out/);const final=await vault.snapshot();assert.equal(final.active,null);assert.equal(final.profiles.oaiapp_test.accessToken,undefined);
  assert.equal(calls.length,2);assert.ok(calls[1].url.endsWith('/revoke'));assert.equal(calls[1].body.get('token'),'synthetic-rotated');
});
test('lock waiting respects cancellation and never steals an existing lock',async t=>{
  const {vault}=await fixture(t);await mkdir(`${vault.path}.lock`);const controller=new AbortController();
  const result=vault.transaction(()=>assert.fail('must not execute'),{signal:controller.signal});controller.abort();await assert.rejects(result);assert.ok((await stat(`${vault.path}.lock`)).isDirectory());
});
test('separate Node processes serialize rotating refresh tokens',async t=>{
  const {root,vault}=await fixture(t,true);const count=join(root,'refresh-count');
  const script=`const {Vault}=await import(${JSON.stringify(new URL('../src/vault.js',import.meta.url).href)});const {accessSession}=await import(${JSON.stringify(new URL('../src/auth.js',import.meta.url).href)});const {appendFile}=await import('node:fs/promises');const {setTimeout}=await import('node:timers/promises');await accessSession(new Vault(process.argv[1],process.argv[2],{lockWaitMs:10000,pollMs:10}),undefined,async()=>{await appendFile(process.argv[3],'refresh\\n');await setTimeout(50);return new Response(JSON.stringify({access_token:'synthetic-new',refresh_token:'synthetic-rotated',token_type:'Bearer',expires_in:3600}));});`;
  await Promise.all(Array.from({length:4},()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',script,vault.path,pass,count],{stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',x=>error+=x);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(error)));
  })));
  assert.equal((await readFile(count,'utf8')).trim().split('\n').length,1);
});
test('owner-only passphrase file supports GUI launch and explicit path precedence',async t=>{
  const {root}=await fixture(t);const file=join(root,'passphrase');await writeFile(file,pass+'\n',{mode:0o600});
  const vault=await createVault({passphraseFile:file,vaultPath:join(root,'separate.vault')});assert.equal(vault.passphrase,pass);assert.equal(vault.path,join(root,'separate.vault'));
  await chmod(file,0o644);await assert.rejects(createVault({passphraseFile:file}),e=>e.code==='INVALID_CREDENTIAL');
});
test('passphrase reader rejects symlinks and missing files without leaking paths',async t=>{
  const {root}=await fixture(t);const source=join(root,'private-secret');await writeFile(source,pass,{mode:0o600});const link=join(root,'link');await symlink(source,link);
  for(const path of [link,join(root,'missing-private-name')])await assert.rejects(createVault({passphraseFile:path}),e=>e.code==='INVALID_CREDENTIAL'&&!e.message.includes(root));
});
test('inference is not cut off by the administrative HTTP deadline',async()=>{
  const response=await officialFetch(`${RESOURCE}/responses`,{},async(_url,init)=>{
    assert.equal(init.signal,undefined);
    return new Response(new ReadableStream({start(controller){setTimeout(()=>{controller.enqueue(new TextEncoder().encode('still streaming'));controller.close();},25);}}));
  },{timeoutMs:1});assert.equal(await response.text(),'still streaming');
});
test('model discovery retains a bounded deadline and caller cancellation',async()=>{
  await assert.rejects(officialFetch(`${RESOURCE}/models`,{},async(_url,init)=>{
    await delay(30,undefined,{signal:init.signal});return new Response('{}');
  },{timeoutMs:5}),e=>e.code==='TIMEOUT');
  const controller=new AbortController();controller.abort();await assert.rejects(officialFetch(`${RESOURCE}/responses`,{signal:controller.signal},async(_url,init)=>{init.signal.throwIfAborted();}),e=>e.code==='ABORTED');
});
test('context capacity uses model override, configured default, catalog, then conservative fallback',async()=>{
  const profile={clientId:'oaiapp_test',subject:'test',accessToken:'synthetic',scopes:['chatgpt.tokens.use.direct'],expiresAt:Date.now()+3600000};const state={active:profile.clientId,profiles:{[profile.clientId]:profile}};
  for(const [features,catalog,expected] of [[{modelContextWindows:{m:64000},contextWindow:32000},16000,64000],[{contextWindow:32000},16000,32000],[{},16000,16000],[{},undefined,DEFAULT_CONTEXT_WINDOW]]){
    const adapter=new ChatGPTAdapter({transaction:async fn=>fn(state)},async()=>new Response(JSON.stringify({models:[{slug:'m',visibility:'list',context_window:catalog}]})),features);
    assert.equal((await adapter.resolveModel(PROVIDER,'m')).context.contextWindow,expected);assert.equal((await adapter.prepareCall(PROVIDER,'m')).model.context.contextWindow,expected);
  }
});
test('catalog inflight work is shared and token changes invalidate it',async t=>{
  const {vault}=await fixture(t);let requests=0;const adapter=new ChatGPTAdapter(vault,async()=>{requests++;await delay(10);return new Response(JSON.stringify({models:[{slug:'m',visibility:'list'}]}));});
  await Promise.all(Array.from({length:20},()=>adapter.prepareCall(PROVIDER,'m')));assert.equal(requests,1);
  await vault.transaction(s=>{s.profiles[s.active].accessToken='synthetic-rotated';});await adapter.resolveModel(PROVIDER,'m');assert.equal(requests,2);
});
test('prepared call accepts a normal token rotation but rejects a fresh login session',async t=>{
  const {vault}=await fixture(t);let bearer;
  const adapter=new ChatGPTAdapter(vault,async(url,init)=>{
    if(url.endsWith('/models'))return new Response(JSON.stringify({models:[{slug:'m',visibility:'list'}]}));bearer=init.headers.Authorization;
    return new Response('data: {"type":"response.completed","response":{"status":"completed"}}\n\n',{headers:{'content-type':'text/event-stream'}});
  });const prepared=await adapter.prepareCall(PROVIDER,'m');
  await vault.transaction(s=>{s.profiles[s.active].accessToken='synthetic-rotated';});await collect(prepared.stream({provider:PROVIDER,model:'m',messages:[]}));assert.equal(bearer,'Bearer synthetic-rotated');
  await vault.transaction(s=>{s.profiles[s.active].sessionId='login-2';});await assert.rejects(collect(prepared.stream({provider:PROVIDER,model:'m',messages:[]})),/changed or signed out/);
});
test('retry policy returns exactly the host-resolved shape',()=>{
  const adapter=new ChatGPTAdapter({});assert.deepEqual(adapter.providerRetryPolicy(),resolveRetryPolicy({mode:'normal',maxRetries:0,retryableCodes:['SERVER'],backoff:{initialDelayMs:500,maxDelayMs:1000,jitterRatio:0}},'test'));
});
test('HTTP context overflow and quota errors preserve host codes without echoing body text',async()=>{
  for(const [body,status,code] of [[{error:{code:'context_length_exceeded',message:'private prompt'}},400,'CONTEXT_WINDOW_EXCEEDED'],[{error:{code:'subscription_sharing_usage_limit_exceeded',message:'private token'}},429,'QUOTA']]){
    await assert.rejects(collect(infer({accessToken:'synthetic'},{model:'m',messages:[]},{},async()=>new Response(JSON.stringify(body),{status}))),e=>e.code===code&&!e.message.includes('private'));
  }
});
test('in-band overflow and incomplete responses are diagnostic and never successful',async()=>{
  await assert.rejects(collect(responseChunks(events([{type:'response.failed',response:{error:{code:'context_window_exceeded'}}}]))),e=>e.code==='CONTEXT_WINDOW_EXCEEDED');
  await assert.rejects(collect(responseChunks(events([{type:'response.incomplete',response:{incomplete_details:{reason:'max_output_tokens'}}}]))),e=>e.code==='INCOMPLETE_RESPONSE'&&e.message.includes('max_output_tokens'));
});
test('CLI diagnostic includes stage and safe code, never raw error secrets',()=>{
  assert.match(safeDiagnostic({code:'AUTH',message:'private-token'},'token exchange'),/token exchange \(AUTH\)/);
  assert.ok(!safeDiagnostic({code:'private-token',message:'private-token'},'vault').includes('private-token'));
});


test('cancellation after a successful exchange still persists the rotated token',async t=>{
  const {vault}=await fixture(t,true);const controller=new AbortController();
  await assert.rejects(accessSession(vault,controller.signal,async()=>{controller.abort();return tokens();}));
  assert.equal((await vault.snapshot()).profiles.oaiapp_test.refreshToken,'synthetic-rotated');
});
