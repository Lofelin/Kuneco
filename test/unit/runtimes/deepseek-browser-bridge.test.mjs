import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {readDeepSeekInput} from '../../../src/features/runtimes/deepseek-runtime.mjs';
import {runDeepSeek} from '../../../src/features/runtimes/deepseek-runner.mjs';
const definition={name:'KunecoBrowser',description:'Browser',inputSchema:{type:'object'}};
const write=(stream,value)=>stream.write(JSON.stringify(value)+'\n');
test('NDJSON init resolves before EOF and requests receive success/errors',async()=>{
 const stream=new PassThrough(),sent=[];const bridge=readDeepSeekInput(stream,{send:event=>sent.push(event)});write(stream,{browserTool:{definition}});
 const {browserTool}=await bridge.input;assert.equal(stream.writableEnded,false);
 const first=browserTool.execute({action:'tabs'});assert.deepEqual(sent[0],{type:'browser-tool-request',id:'1',input:{action:'tabs'}});
 write(stream,{type:'browser-tool-result',id:'1',result:{tabs:[]}});assert.deepEqual(await first,{tabs:[]});
 const second=browserTool.execute({action:'history'});write(stream,{type:'browser-tool-result',id:'2',error:'denied'});await assert.rejects(second,/denied/);bridge.close();stream.destroy();
});
test('legacy whole JSON and pretty JSON are accepted on EOF',async()=>{
 for(const text of ['{"prompt":"old"}','{\n "prompt": "old"\n}']){const stream=new PassThrough(),bridge=readDeepSeekInput(stream);stream.end(text);const value=await bridge.input;assert.equal(value.input.prompt,'old');assert.equal(value.browserTool,undefined);}
});
test('each invocation has isolated pending requests and cancellation closes them',async()=>{
 const streams=[new PassThrough(),new PassThrough()],controller=new AbortController();const bridges=streams.map((stream,i)=>readDeepSeekInput(stream,{signal:i===0?controller.signal:undefined}));streams.forEach(s=>write(s,{browserTool:{definition}}));
 const tools=await Promise.all(bridges.map(b=>b.input));const a=tools[0].browserTool.execute({}),b=tools[1].browserTool.execute({});controller.abort();await assert.rejects(a,/取消/);
 write(streams[1],{type:'browser-tool-result',id:'1',result:'other'});assert.equal(await b,'other');bridges.forEach(b=>b.close());streams.forEach(s=>s.destroy());
});
function childFixture(){const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>queueMicrotask(()=>child.emit('close',1));return child;}
test('host bridge sends results and ends stdin on done',async()=>{
 const child=childFixture(),received=[];child.stdin.on('data',chunk=>received.push(JSON.parse(String(chunk))));
 const task=runDeepSeek({spawnProcess:()=>child,onText:()=>{},browserTool:{definition,execute:async input=>({action:input.action})}});
 assert.deepEqual(received[0].browserTool,{definition});assert.equal(child.stdin.writableEnded,false);
 write(child.stdout,{type:'browser-tool-request',id:'1',input:{action:'tabs'}});await new Promise(r=>setImmediate(r));
 assert.deepEqual(received[1],{type:'browser-tool-result',id:'1',result:{action:'tabs'}});
 write(child.stdout,{type:'done',usage:{total_tokens:1}});child.emit('close',0);assert.deepEqual(await task,{total_tokens:1});assert.equal(child.stdin.writableEnded,true);
});
test('host cancellation drops pending results and legacy host input still ends',async()=>{
 const child=childFixture(),controller=new AbortController(),received=[];let finish;child.stdin.on('data',c=>received.push(JSON.parse(String(c))));
 const task=runDeepSeek({spawnProcess:()=>child,signal:controller.signal,onText:()=>{},browserTool:{definition,execute:()=>new Promise(r=>{finish=r;})}});
 write(child.stdout,{type:'browser-tool-request',id:'1',input:{}});controller.abort();await assert.rejects(task,/取消/);finish('late');await new Promise(r=>setImmediate(r));assert.equal(received.length,1);
 const legacy=childFixture();const old=runDeepSeek({spawnProcess:()=>legacy,onText:()=>{}});assert.equal(legacy.stdin.writableEnded,true);write(legacy.stdout,{type:'done'});legacy.emit('close',0);await old;
});

test('browser definition is advertised and dispatched through the real tool executor',async()=>{
 const {createDeepSeekTools}=await import('../../../src/features/runtimes/deepseek-tools.mjs');
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const cwd=await mkdtemp(join(tmpdir(),'kuneco-browser-tools-'));
 try{let received;const tools=await createDeepSeekTools({cwd,home:cwd,browserTool:{definition,execute:async args=>{received=args;return {tabs:[{id:'one'}]};}}});
 assert.deepEqual(tools.definitions.find(d=>d.function.name==='KunecoBrowser').function,{name:definition.name,description:definition.description,parameters:definition.inputSchema});
 const result=JSON.parse(await tools.execute({id:'b',function:{name:'KunecoBrowser',arguments:'{"action":"tabs"}'}}));assert.deepEqual(result,{tabs:[{id:'one'}]});assert.deepEqual(received,{action:'tabs'});
 }finally{await rm(cwd,{recursive:true,force:true});}
});
