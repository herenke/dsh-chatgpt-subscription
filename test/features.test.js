import test from 'node:test';
import assert from 'node:assert/strict';
import LlmRuntime, { BlockAssembler } from '@deepseek-ai/dsh-llm';
import { Context } from '@deepseek-ai/cordis';
import { prepareImages, imageTarget, IMAGE_LIMITS } from '../src/images.js';
import { requestBody, responseChunks, infer, listModels } from '../src/protocol.js';
import { saveReplay, readReplay } from '../src/replay.js';
import { TESTED_LLM_VERSIONS, untestedRuntimeWarning, resolvedLlmVersion } from '../src/compat.js';
import { ChatGPTAdapter, PROVIDER } from '../src/adapter.js';
const collect = async source => { const out=[]; for await(const x of source) out.push(x); return out; };
async function* events(items) { yield* items; }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvX8AAAAASUVORK5CYII=', 'base64');
const ref = { attachmentId:`sha256:${'a'.repeat(64)}`,mediaType:'image/png',bytes:png.length,width:1,height:1,name:'sample.png' };
const image = {type:'image',attachment:ref};
const opts = messages => ({provider:PROVIDER,model:'test-model',messages});
const version = {attachment:ref,variantId:'test',data:png,bytes:png.length,width:1,height:1,mediaType:'image/png',depth:'uchar',space:'srgb',hasAlpha:true};
const attachments = {readImageRequest:async()=>version};
const session = {clientId:'oaiapp_test',subject:'subject',accessToken:'synthetic'};
const context = {session,model:'test-model',provider:PROVIDER};
const output = [
  {type:'reasoning',id:'rs_test',summary:[],encrypted_content:'synthetic-encrypted-state'},
  {type:'message',id:'msg_test',role:'assistant',status:'completed',content:[{type:'output_text',text:'answer',annotations:[]}]},
];
const visible = [{type:'text',text:'answer'}];
const completion = native => ({type:'response.completed',response:{status:'completed',output:native}});
const textEvents = text => [{type:'response.output_text.delta',output_index:1,content_index:0,delta:text},{type:'response.output_text.done',output_index:1,content_index:0,text}];

test('image target preserves aspect ratio and caps request dimensions',()=>{
  assert.deepEqual(imageTarget({...ref,width:8000,height:2000}),{width:4096,height:1024,maxBytes:IMAGE_LIMITS.maxImageBytes});
});
test('user images retain text-image-text order and never mutate source history',async()=>{
  const options=opts([{role:'user',content:[{type:'text',text:'before'},image,{type:'text',text:'after'}]}]); const original=JSON.stringify(options);
  const versions=await prepareImages(options,attachments), body=requestBody(options,versions);
  assert.deepEqual(body.input[0].content.map(c=>c.type),['input_text','input_text','input_image','input_text']);
  assert.equal(body.input[0].content[2].image_url,`data:image/png;base64,${png.toString('base64')}`); assert.equal(JSON.stringify(options),original);
});
test('function tool result can carry an image and its call identity',async()=>{
  const options=opts([{role:'tool',toolCallId:'call_test',content:[{type:'text',text:'screenshot'},image]}]);
  const body=requestBody(options,await prepareImages(options,attachments)); assert.equal(body.input[0].call_id,'call_test'); assert.equal(body.input[0].output[2].type,'input_image');
});
test('duplicate attachment reads are deduplicated while occurrences remain in request',async()=>{
  let reads=0; const options=opts([{role:'user',content:[image,image]}]); const versions=await prepareImages(options,{readImageRequest:async()=>{reads++;return version;}});
  assert.equal(reads,1); assert.equal(requestBody(options,versions).input[0].content.filter(c=>c.type==='input_image').length,2);
});
test('offloaded images become explicit placeholders without reading bytes',async()=>{
  const options=opts([{role:'user',content:[{...image,offloaded:true}]}]); const versions=await prepareImages(options,{readImageRequest:()=>assert.fail('do not read')});
  const content=requestBody(options,versions).input[0].content; assert.equal(content.length,1); assert.match(content[0].text,/omitted/);
});
test('image inputs reject remote URLs, filesystem paths, corrupt bytes and unsupported roles',async()=>{
  for(const block of [{...image,attachment:{...ref,attachmentId:'https://evil.test/a.png'}},{...image,attachment:{...ref,attachmentId:'/etc/passwd'}},{...image,attachment:{...ref,mediaType:'image/svg+xml'}}]) await assert.rejects(prepareImages(opts([{role:'user',content:[block]}]),attachments),/Invalid/);
  await assert.rejects(prepareImages(opts([{role:'assistant',content:[image]}]),attachments),/only/);
  await assert.rejects(prepareImages(opts([{role:'user',content:[image]}]),{readImageRequest:async()=>({...version,data:Buffer.alloc(png.length)})}),/invalid normalized/);
});
test('image requests fail clearly without attachment service or after cancellation',async()=>{
  const options=opts([{role:'user',content:[image]}]); await assert.rejects(prepareImages(options),/attachment service/);
  const controller=new AbortController();controller.abort();await assert.rejects(prepareImages({...options,signal:controller.signal},attachments));
});
test('repeated image count is enforced through host offload protocol',async()=>{
  await assert.rejects(prepareImages(opts([{role:'user',content:Array.from({length:17},()=>image)}]),attachments),error=>error.code==='IMAGE_OFFLOAD_REQUIRED'&&error.failure.offloadImages===1);
});
test('aggregate base64 budget triggers oldest-image offloading',async()=>{
  const data=Buffer.alloc(IMAGE_LIMITS.maxImageBytes);png.copy(data);
  await assert.rejects(prepareImages(opts([{role:'user',content:[image,image]}]),{readImageRequest:async()=>({...version,data,bytes:data.length})}),error=>error.code==='IMAGE_OFFLOAD_REQUIRED');
});
test('conflicting references sharing one attachment ID are rejected',async()=>{
  await assert.rejects(prepareImages(opts([{role:'user',content:[image,{...image,attachment:{...ref,width:2}}]}]),attachments),/Conflicting/);
});
test('catalog preserves explicit model image capability and leaves unknown capability unset',async()=>{
  const models=await listModels(session,{},undefined,async()=>new Response(JSON.stringify({models:[{slug:'vision',visibility:'list',input_modalities:['text','image']},{slug:'text',visibility:'list',input_modalities:['text']},{slug:'unknown',visibility:'list'}]})));
  assert.deepEqual(models[0].inputModalities,['text','image']);assert.deepEqual(models[1].inputModalities,['text']);assert.equal(models[2].inputModalities,undefined);
});
test('subscription requests use developer messages and namespaced local tools',()=>{
  const body=requestBody({...opts([{role:'system',content:[{type:'text',text:'system'}]}]),system:'initial',maxTokens:100,tools:[{name:'read',parameters:{type:'object'},description:'Read'}]});
  assert.ok(body.input.every(i=>i.role==='developer'));assert.equal(body.max_output_tokens,undefined);assert.equal(body.tools[0].type,'namespace');assert.equal(body.tools[0].name,'dsh');assert.equal(body.tools[0].tools[0].name,'read');
});
test('temperature and stop are rejected before image reads or inference',async()=>{
  for(const settings of [{temperature:0.5},{stop:['END']}]) await assert.rejects(collect(infer(session,{...opts([{role:'user',content:[image]}]),...settings},{},()=>assert.fail('no network'),{attachments:{readImageRequest:()=>assert.fail('no image reads')}})));
});
test('reasoning replay preserves native encrypted output for the same model/account/content',()=>{
  const replayState=saveReplay(output,visible,context); const message={role:'assistant',content:visible,source:{kind:'model',provider:PROVIDER,model:'test-model',replayState}};
  assert.deepEqual(readReplay(message,context),output);
  assert.deepEqual(requestBody(opts([message]),new Map(),{replay:context}).input,output);
  assert.ok(!JSON.stringify(replayState).includes('synthetic"')); // No bearer token persisted in replay.
});
test('replay refuses different accounts, models, providers and edited visible content',()=>{
  const replayState=saveReplay(output,visible,context);const message={role:'assistant',content:visible,source:{provider:PROVIDER,model:'test-model',replayState}};
  for(const changed of [{...context,session:{...session,clientId:'oaiapp_other'}},{...context,session:{...session,subject:'other'}},{...context,model:'other'},{...context,provider:'other'}]) assert.equal(readReplay(message,changed),undefined);
  assert.equal(readReplay({...message,content:[{type:'text',text:'edited'}]},context),undefined);
  assert.equal(saveReplay(output,[{type:'text',text:'different'}],context),undefined);
});
test('successful stream stores replay through the real DSH block assembler',async()=>{
  const chunks=await collect(responseChunks(events([...textEvents('answer'),completion(output)]),{replay:context}));
  const assembler=new BlockAssembler(); for(const c of chunks) assembler.push(c);
  assert.ok(assembler.replayState); assert.deepEqual(assembler.blocks(),visible); assert.deepEqual(assembler.replayState.response.output,output);
});
test('failed response never commits native reasoning replay',async()=>{
  const chunks=[];await assert.rejects(async()=>{for await(const c of responseChunks(events([{type:'response.output_item.done',output_index:0,item:output[0]},...textEvents('answer'),{type:'response.failed'}]),{replay:context}))chunks.push(c);});assert.ok(!chunks.some(c=>c.replayState));
});
test('web search is opt-in and unsupported hosted tools are not enabled',()=>{
  assert.equal(requestBody(opts([])).tools,undefined);
  assert.deepEqual(requestBody(opts([]),new Map(),{webSearch:true}).tools,[{type:'web_search'}]);
});
test('web search returns safe source links without dispatching hosted calls as local tools',async()=>{
  const native=[{type:'web_search_call',id:'ws_test',status:'completed',action:{type:'search',query:'test'}},{...output[1],content:[{type:'output_text',text:'answer',annotations:[{type:'url_citation',url:'https://example.com/a(b)',title:'Source [1]'},{type:'url_citation',url:'javascript:alert(1)',title:'bad'}]}]}];
  const chunks=await collect(responseChunks(events([{type:'response.output_item.added',output_index:0,item:native[0]},...textEvents('answer'),completion(native)]),{webSearch:true,replay:context}));
  const sources=chunks.filter(c=>c.type==='block-end').at(-1).block.text;assert.match(sources,/https:\/\/example.com\/a%28b%29/);assert.ok(!sources.includes('javascript:'));assert.equal(chunks.at(-1).reason.kind,'stop');assert.ok(chunks.at(-1).replayState);
});
test('image inference sends only inline data through the fixed Responses endpoint',async()=>{
  let requests=0; const chunks=await collect(infer(session,opts([{role:'user',content:[image]}]),{},async(url,init)=>{
    requests++;assert.equal(url,'https://api.openai.com/v1/responses');assert.match(JSON.parse(init.body).input[0].content[1].image_url,/^data:image\/png;base64,/);
    return new Response([...textEvents('answer'),completion(output)].map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
  },{attachments}));assert.equal(requests,1);assert.equal(chunks.at(-1).reason.kind,'stop');
});


test('real DSH runtime retains images for an account model with unknown modality metadata',async()=>{
  const ctx=new Context();await ctx.plugin(LlmRuntime);
  const state={active:session.clientId,profiles:{[session.clientId]:{...session,scopes:['chatgpt.tokens.use.direct'],expiresAt:Date.now()+3600000}}};
  let sentImage=false;
  const adapter=new ChatGPTAdapter({transaction:async fn=>fn(state)},async(url,init)=>{
    if(url.endsWith('/models'))return new Response(JSON.stringify({models:[{slug:'test-model',visibility:'list'}]}));
    sentImage=JSON.parse(init.body).input[0].content.some(c=>c.type==='input_image');
    return new Response([...textEvents('answer'),completion(output)].map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
  },{attachments});
  try {ctx.llm.registerAdapter([PROVIDER],adapter);const chunks=await collect(ctx.llm.stream(opts([{role:'user',content:[image]}])));assert.equal(chunks.at(-1).reason.kind,'stop');assert.equal(sentImage,true);} finally{await ctx.fiber.dispose();}
});
test('real DSH runtime projects images explicitly for a catalog-declared text-only model',async()=>{
  const ctx=new Context();await ctx.plugin(LlmRuntime);
  const state={active:session.clientId,profiles:{[session.clientId]:{...session,scopes:['chatgpt.tokens.use.direct'],expiresAt:Date.now()+3600000}}};
  const adapter=new ChatGPTAdapter({transaction:async fn=>fn(state)},async(url,init)=>{
    if(url.endsWith('/models'))return new Response(JSON.stringify({models:[{slug:'test-model',visibility:'list',input_modalities:['text']}]}));
    assert.match(JSON.parse(init.body).input[0].content,/text only/);
    return new Response([...textEvents('answer'),completion(output)].map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
  },{attachments:{readImageRequest:()=>assert.fail('must not read a projected image')}});
  try {ctx.llm.registerAdapter([PROVIDER],adapter);const chunks=await collect(ctx.llm.stream(opts([{role:'user',content:[image]}])));assert.equal(chunks.at(-1).reason.kind,'stop');} finally{await ctx.fiber.dispose();}
});

test('inference accepts an SSE stream with no Content-Type header (real gateway behavior)',async()=>{
  const sse=[...textEvents('ok'),completion(output)].map(e=>`data: ${JSON.stringify(e)}\n\n`).join('');
  // Bytes, not a string: a string body would synthesize text/plain.
  const response=()=>new Response(new TextEncoder().encode(sse));
  assert.equal(response().headers.get('content-type'),null);
  const chunks=await collect(infer(session,opts([{role:'user',content:[{type:'text',text:'hi'}]}]),{},async()=>response()));
  assert.equal(chunks.filter(c=>c.type==='text-delta').map(c=>c.text).join(''),'ok');
  assert.equal(chunks.at(-1).reason.kind,'stop');
});
test('inference still rejects an explicitly non-SSE response',async()=>{
  await assert.rejects(collect(infer(session,opts([{role:'user',content:[{type:'text',text:'hi'}]}]),{},async()=>new Response('{}',{headers:{'content-type':'application/json'}}))),/Expected an OpenAI event stream/);
});

test('web search citations are collected from annotation events when completed.output is empty',async()=>{
  const eventsList=[
    {type:'response.output_item.done',output_index:0,item:{type:'web_search_call',id:'ws_test',status:'completed'}},
    ...textEvents('answer'),
    {type:'response.output_text.annotation.added',output_index:1,content_index:0,annotation:{type:'url_citation',url:'https://example.com/harness',title:'Harness [docs]'}},
    {type:'response.output_text.annotation.added',output_index:1,content_index:0,annotation:{type:'url_citation',url:'javascript:alert(1)',title:'bad'}},
    {type:'response.completed',response:{status:'completed',output:[]}},
  ];
  const chunks=await collect(responseChunks(events(eventsList),{webSearch:true,replay:context}));
  const sources=chunks.filter(c=>c.type==='block-end').at(-1).block.text;
  assert.match(sources,/Sources:/);
  assert.match(sources,/https:\/\/example\.com\/harness/);
  assert.match(sources,/Harness/);
  assert.ok(!sources.includes('javascript:'));
  assert.equal(chunks.at(-1).reason.kind,'stop');
});

test('catalog reasoning levels become selectable efforts, filtered to wire-valid values',async()=>{
  const models=await listModels(session,{},undefined,async()=>new Response(JSON.stringify({models:[{slug:'m',visibility:'list',supported_reasoning_levels:[{effort:'low',description:'Fast responses'},{effort:'high',description:'Deep reasoning'},{effort:'ultra',description:'Not accepted by the route'},{effort:'low',description:'duplicate'}],default_reasoning_level:'high'}]})));
  assert.deepEqual(models[0].reasoning,{efforts:[{id:'low',name:'Low',description:'Fast responses'},{id:'high',name:'High',description:'Deep reasoning'}],defaultEffort:'high'});
});
test('models with no wire-valid reasoning level expose no effort metadata',async()=>{
  const models=await listModels(session,{},undefined,async()=>new Response(JSON.stringify({models:[{slug:'m',visibility:'list',supported_reasoning_levels:[{effort:'ultra'}]},{slug:'n',visibility:'list'}]})));
  assert.equal(models[0].reasoning,undefined);assert.equal(models[1].reasoning,undefined);
});
test('real DSH runtime offers catalog efforts and rejects an unsupported effort before dispatch',async()=>{
  const ctx=new Context();await ctx.plugin(LlmRuntime);
  const state={active:session.clientId,profiles:{[session.clientId]:{...session,scopes:['chatgpt.tokens.use.direct'],expiresAt:Date.now()+3600000}}};
  let wire,responses=0;
  const adapter=new ChatGPTAdapter({transaction:async fn=>fn(state)},async(url,init)=>{
    if(url.endsWith('/models'))return new Response(JSON.stringify({models:[{slug:'test-model',visibility:'list',supported_reasoning_levels:[{effort:'low'},{effort:'high'}],default_reasoning_level:'high'}]}));
    responses++;wire=JSON.parse(init.body);
    return new Response([...textEvents('answer'),completion(output)].map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
  });
  try{
    ctx.llm.registerAdapter([PROVIDER],adapter);
    const info=await ctx.llm.resolveModelInfo(PROVIDER,'test-model');
    assert.deepEqual(info.reasoning.efforts.map(e=>e.id),['low','high']);assert.equal(info.reasoning.defaultEffort,'high');
    const chunks=await collect(ctx.llm.stream({provider:PROVIDER,model:'test-model',reasoningEffort:'low',messages:[]}));
    assert.equal(chunks.at(-1).reason.kind,'stop');assert.deepEqual(wire.reasoning,{effort:'low'});
    const before=responses;
    const rejected=await collect(ctx.llm.stream({provider:PROVIDER,model:'test-model',reasoningEffort:'ultra',messages:[]}));
    assert.equal(rejected.at(-1).reason.kind,'error');
    assert.equal(rejected.at(-1).reason.failure.code,'UNSUPPORTED_REASONING_EFFORT');
    assert.equal(responses,before);
  }finally{await ctx.fiber.dispose();}
});

test('verified adapter versions stay silent and other 0.2.x runtimes warn',()=>{
  for(const version of TESTED_LLM_VERSIONS) assert.equal(untestedRuntimeWarning(version),undefined);
  assert.match(untestedRuntimeWarning('0.2.3-alpha.1'),/outside the verified set/);
  assert.match(untestedRuntimeWarning('9.9.9'),/outside the verified set/);
  assert.equal(untestedRuntimeWarning(undefined),undefined);
  assert.equal(untestedRuntimeWarning(''),undefined);
});
test('the adapter package version is resolved from the installed copy',()=>{
  const version=resolvedLlmVersion();
  assert.equal(typeof version,'string');assert.match(version,/^\d+\.\d+\.\d+/);
});
