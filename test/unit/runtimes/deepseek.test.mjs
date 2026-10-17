import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {PassThrough} from 'node:stream';import {configureDeepSeek,runDeepSeekCLI} from '../../../src/features/runtimes/deepseek-runtime.mjs';

test('DeepSeek vision sends official content blocks, preserves full history and refuses unsupported models',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-vision-'));
 try{
  await configureDeepSeek(directory,{apiKey:'fixture-key'},async()=>({data:[{id:'deepseek-flash'},{id:'deepseek-v4-pro'}]}));
  const dataURL='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN3sAAAAASUVORK5CYII=';
  let body,options;const request=async(_proxy,_key,route,value,o)=>{assert.equal(route,'/chat/completions');body=value;options=o;return {choices:[{message:{content:'图片回复'},finish_reason:'stop'}],usage:{total_tokens:9}};};
  const sessionId='12345678-1234-1234-1234-123456789012';
  const value=await runDeepSeekCLI('chat',{sessionId,model:'deepseek-flash',prompt:{text:'描述图片',images:[{dataURL,name:'fixture.png'}],thinking:'disabled'}},{directory,request});
  assert.deepEqual(body.messages[0].content,[{type:'text',text:'描述图片'},{type:'image_url',image_url:{url:dataURL,detail:'auto'}}]);assert.equal(body.thinking.type,'disabled');assert.equal(body.stream_options.include_usage,true);assert.equal(value.usage.total_tokens,9);assert.equal(options.direct,false);
  await assert.rejects(runDeepSeekCLI('chat',{sessionId,model:'deepseek-v4-pro',prompt:'追问'},{directory,request}),/deepseek-flash/);
  await runDeepSeekCLI('chat',{sessionId,model:'deepseek-flash',prompt:'追问'},{directory,request});assert.equal(body.messages.length,3);assert.equal(body.messages[0].content[1].image_url.url,dataURL);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('DeepSeek validates images and does not silently truncate a long conversation',async()=>{
 const {normalizeDeepSeekInput}=await import('../../../src/features/runtimes/deepseek-runtime.mjs');
 assert.throws(()=>normalizeDeepSeekInput({text:'',images:[{dataURL:'data:image/png;base64,YmFk'}]}),/格式不符/);
 assert.throws(()=>normalizeDeepSeekInput({text:'hi',images:[{url:'file:///secret'}]}),/链接无效/);
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-history-'));
 try{await configureDeepSeek(directory,{apiKey:'fixture-key'},async()=>({data:[{id:'deepseek-flash'}]}));const sessionId='12345678-1234-1234-1234-123456789012';const {writeFile}=await import('node:fs/promises');const history=Array.from({length:44},(_,i)=>({role:i%2?'assistant':'user',content:'turn '+i}));await writeFile(path.join(directory,sessionId+'.json'),JSON.stringify(history));await runDeepSeekCLI('chat',{sessionId,prompt:'next'},{directory,request:async(_p,_k,_r,b)=>{assert.equal(b.messages.length,45);return {choices:[{message:{content:'next answer'}}]};}});}finally{await rm(directory,{recursive:true,force:true});}
});

test('DeepSeek streams reasoning separately and final usage/finish reasons are respected',async()=>{
 const {readDeepSeekStream}=await import('../../../src/features/runtimes/deepseek-runtime.mjs');const response=new PassThrough(),text=[],reasoning=[];const result=readDeepSeekStream(response,t=>text.push(t),t=>reasoning.push(t));response.end('data: {"choices":[{"delta":{"reasoning_content":"分析"}}]}\n\ndata: {"choices":[{"delta":{"content":"答案"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"total_tokens":12}}\n\ndata: [DONE]\n\n');const value=await result;assert.deepEqual(text,['答案']);assert.deepEqual(reasoning,['分析']);assert.equal(value.usage.total_tokens,12);assert.equal(value.choices[0].finish_reason,'length');
 const bad=new PassThrough(),failure=readDeepSeekStream(bad);bad.end('data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n\n');await assert.rejects(failure,/过滤/);
});

test('oversize inline images use Files API with the same proxy route and cleanup',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-large-image-'));
 try{await configureDeepSeek(directory,{apiKey:'fixture-key'},async()=>({data:[{id:'deepseek-flash'}]}));const image=Buffer.alloc(33*1024*1024);Buffer.from([137,80,78,71,13,10,26,10]).copy(image);const dataURL='data:image/png;base64,'+image.toString('base64');const calls=[];
 await runDeepSeekCLI('chat',{sessionId:'12345678-1234-1234-1234-123456789012',prompt:{text:'大图',images:[{dataURL}]}},{directory,request:async(proxy,key,route,body,options)=>{calls.push(route);assert.equal(options.direct,false);if(route==='/files'){assert.ok(Buffer.isBuffer(options.rawBody));assert.match(options.contentType,/multipart/);assert.ok(options.rawBody.includes(Buffer.from('expires_after[seconds]')));return {id:'file-api-fixture'};}if(route==='/chat/completions'){assert.deepEqual(body.messages[0].content[1],{type:'file',file_id:'file-api-fixture'});return {choices:[{message:{content:'大图回复'}}]};}assert.equal(body,null);return {};}});assert.deepEqual(calls,['/models','/files','/chat/completions','/files/file-api-fixture']);
 }finally{await rm(directory,{recursive:true,force:true});}
});
