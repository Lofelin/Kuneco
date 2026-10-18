import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {runCodexStream} from '../../../src/features/runtimes/codex-stream.mjs';
const definition={name:'browser',description:'Browse',inputSchema:{type:'object'}};
function harness({execute,sessionId,controller=new AbortController(),afterCall}={}){
 const child=new EventEmitter(),messages=[];child.stdout=new PassThrough();child.kill=()=>{};
 const send=value=>child.stdout.write(JSON.stringify(value)+'\n');
 child.stdin=new Writable({write(data,_enc,cb){const m=JSON.parse(data);messages.push(m);cb();queueMicrotask(()=>{
  if(m.method && m.id){send({id:m.id,result:m.method.startsWith('thread/')?{thread:{id:'t'}}:m.method==='turn/start'?{turn:{id:'turn'}}:{}});
   if(m.method==='turn/start'){send({id:'tool-call',method:'item/tool/call',params:{threadId:'t',turnId:'turn',callId:'call',tool:'browser',arguments:{action:'tabs'}}});afterCall?.();}}
  else if(m.id==='tool-call')send({method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}});
 });}});
 const promise=runCodexStream({executable:'fixture',project:'/tmp',model:'fixture',prompt:'test',sessionId,signal:controller.signal,gateway:{status:{mode:'direct'}},onEvent:()=>{},spawnProcess:()=>child,browserTool:{definition,execute}});
 return {promise,messages};
}
test('registers a schema-valid dynamic tool and returns tool results',async()=>{
 let received;const h=harness({execute:async args=>{received=args;return {tabs:[]};}});await h.promise;
 assert.deepEqual(received,{action:'tabs'});
 assert.equal(h.messages.find(m=>m.method==='initialize').params.capabilities.experimentalApi,true);
 assert.deepEqual(h.messages.find(m=>m.method==='thread/start').params.dynamicTools,[{...definition,type:'function'}]);
 assert.deepEqual(h.messages.find(m=>m.id==='tool-call').result,{contentItems:[{type:'inputText',text:'{"tabs":[]}'}],success:true});
});
test('resumed threads service existing tools and tool errors do not fail the turn',async()=>{
 const h=harness({sessionId:'t',execute:async()=>{throw Error('权限已撤销');}});await h.promise;
 // Codex 0.142.5 ThreadResumeParams has no dynamicTools; definitions persist from thread/start.
 assert.equal('dynamicTools' in h.messages.find(m=>m.method==='thread/resume').params,false);
 assert.deepEqual(h.messages.find(m=>m.id==='tool-call').result,{contentItems:[{type:'inputText',text:'权限已撤销'}],success:false});
});
test('abort suppresses an in-flight tool response',async()=>{
 const controller=new AbortController();let complete;const h=harness({controller,execute:()=>new Promise(resolve=>{complete=resolve;}),afterCall:()=>controller.abort()});
 await assert.rejects(h.promise,/取消/);complete({tabs:[]});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.messages.some(m=>m.id==='tool-call'),false);
});
