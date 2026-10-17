import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {readFileSync} from 'node:fs';
import {runCodexStream,codexStreamArguments} from '../../../src/features/runtimes/codex-stream.mjs';
test('streams before completion, resumes thread, deduplicates final message and preserves proxy controls',async()=>{
 const events=[],requests=[];let killed=false;
 const child=new EventEmitter();child.stdout=new PassThrough();child.kill=()=>{killed=true;};
 const emit=(method,params)=>child.stdout.write(JSON.stringify({method,params})+'\n');
 child.stdin=new Writable({write(data,enc,cb){const m=JSON.parse(data.toString());requests.push(m);
 if(m.id)queueMicrotask(()=>{
  child.stdout.write(JSON.stringify({id:m.id,result:m.method==='thread/resume'?{thread:{id:'thread1'}}:m.method==='turn/start'?{turn:{id:'turn1'}}:{}})+'\n');
  if(m.method==='turn/start'){
   emit('item/started',{threadId:'thread1',item:{type:'userMessage'}});
   emit('item/started',{threadId:'thread1',item:{type:'reasoning'}});
   emit('item/started',{threadId:'thread1',item:{type:'webSearch'}});
   emit('item/agentMessage/delta',{threadId:'thread1',itemId:'a',delta:'hello '});assert.deepEqual(events.at(-1),['text','hello ']);
   emit('item/agentMessage/delta',{threadId:'thread1',itemId:'a',delta:'world'});
   emit('item/completed',{threadId:'thread1',item:{id:'a',type:'agentMessage',text:'hello world'}});
   emit('turn/completed',{threadId:'thread1',turn:{status:'completed'}});
  }
 });cb();}});
 await runCodexStream({executable:'fixture',project:'/workspace',prompt:'test',images:[{dataURL:'data:image/png;base64,fixture'}],sessionId:'thread1',model:'testmodel',gateway:{url:'http://127.0.0.1:1234',port:1234,status:{}},onEvent:(...args)=>events.push(args),spawnProcess:options=>{assert.equal(options.env.HTTPS_PROXY,'http://127.0.0.1:1234');assert.equal(options.env.LANG,'C.UTF-8');assert.equal(options.env.LC_ALL,'C.UTF-8');return child;}});
 assert.deepEqual(events.filter(x=>x[0]==='activity').map(x=>x[1].type),['web_search']);
 assert.deepEqual(requests.find(x=>x.method==='initialize').params.clientInfo,{name:'kuneco',title:'Kuneco',version:JSON.parse(readFileSync(new URL('../../../package.json',import.meta.url),'utf8')).version});
 assert.equal(events.filter(x=>x[0]==='text').map(x=>x[1]).join(''),'hello world\n\n');assert.ok(killed);
 assert.ok(requests.some(x=>x.method==='thread/resume' && x.params.sandbox==='danger-full-access'));assert.ok(!codexStreamArguments().includes('--disable'));assert.ok(!codexStreamArguments().includes('mcp_servers={}'));assert.equal(requests.find(x=>x.method==='turn/start').params.input[0].text,'test');assert.deepEqual(requests.find(x=>x.method==='turn/start').params.input[1],{type:'image',url:'data:image/png;base64,fixture'});assert.equal(requests.find(x=>x.method==='thread/resume').params.baseInstructions,'');
});
test('abort rejects and kills app-server',async()=>{
 const controller=new AbortController();const child=new EventEmitter();child.stdout=new PassThrough();child.stdin=new PassThrough();let killed=false;child.kill=()=>{killed=true;};
 const promise=runCodexStream({executable:'fixture',project:'/tmp',prompt:'test',model:'x',signal:controller.signal,gateway:{port:1,url:'http://127.0.0.1:1'},onEvent:()=>{},spawnProcess:()=>child});controller.abort();await assert.rejects(promise,/取消/);assert.ok(killed);
});

test('Shell output is delivered while the activity is running before the completion event',async()=>{
 const child=new EventEmitter();child.stdout=new PassThrough();child.kill=()=>{};const events=[];
 const notify=(method,params)=>child.stdout.write(JSON.stringify({method,params:{threadId:'t',...params}})+'\n');
 child.stdin=new Writable({write(data,_encoding,cb){const m=JSON.parse(data.toString());if(m.id)queueMicrotask(()=>{child.stdout.write(JSON.stringify({id:m.id,result:m.method==='thread/start'?{thread:{id:'t'}}:m.method==='turn/start'?{turn:{id:'turn'}}:{}})+'\n');if(m.method==='turn/start'){
 notify('item/started',{item:{id:'cmd',type:'commandExecution',command:'echo 中文; sleep 8',status:'inProgress'}});notify('item/commandExecution/outputDelta',{itemId:'cmd',delta:'中文\n'});assert.equal(events.at(-1)[1].status,'in_progress');assert.equal(events.at(-1)[1].detail,'中文\n');notify('item/completed',{item:{id:'cmd',type:'commandExecution',command:'echo 中文; sleep 8',status:'completed',aggregatedOutput:'中文\n',exitCode:0}});notify('turn/completed',{turn:{status:'completed'}});
 }});cb();}});
 await runCodexStream({executable:'fixture',project:'/workspace',prompt:'test',model:'fixture',gateway:{status:{mode:'direct'}},spawnProcess:()=>child,onEvent:(...e)=>events.push(e)});assert.deepEqual(events.filter(e=>e[0]==='activity').map(e=>e[1].status),['in_progress','in_progress','completed']);
});
