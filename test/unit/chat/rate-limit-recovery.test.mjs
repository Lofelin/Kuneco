import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryPresentation} from '../../../src/features/chat/chat-recovery.mjs';
import {deepSeekHTTPError} from '../../../src/features/runtimes/deepseek-runtime.mjs';
import {runDeepSeek} from '../../../src/features/runtimes/deepseek-runner.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';

test('HTTP metadata parses actual Retry-After seconds/date, rejects invalid delay and classifies errors',()=>{
 const now=Date.UTC(2026,0,1);
 for(const header of ['30',new Date(now+30000).toUTCString()]){const error=deepSeekHTTPError(429,{'retry-after':header},now);assert.equal(error.recovery.retryAt,now+30000);assert.equal(error.recovery.automaticRetry,false);assert.equal(error.recovery.manualRetry,true);}
 for(const header of ['invalid','-1','Infinity'])assert.equal(deepSeekHTTPError(429,{'retry-after':header},now).recovery.retryAt,null);
 for(const [status,kind] of [[401,'authentication'],[402,'balance'],[403,'permission'],[400,'invalid-request'],[503,'unavailable']])assert.equal(deepSeekHTTPError(status).recovery.kind,kind);
 assert.equal(deepSeekHTTPError(402).recovery.manualRetry,false);
});
test('countdown ends at server deadline without enabling uncertain execution or automatic sends',()=>{
 const recovery=deepSeekHTTPError(429,{'retry-after':'2'},1000).recovery;
 assert.equal(recoveryPresentation(recovery,1001).waiting,2);assert.equal(recoveryPresentation(recovery,1001).disabled,true);
 assert.equal(recoveryPresentation(recovery,3000).disabled,false);
 assert.equal(recoveryPresentation({...recovery,executionUnknown:true},3000).disabled,true);
 assert.match(recoveryPresentation({...recovery,retryAt:null},3000).detail,/未提供/);
});
test('runner preserves metadata from fragmented structured failure without sending another request',async()=>{
 const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){}});let spawned=0;
 const pending=runDeepSeek({spawnProcess:()=>{spawned++;return child;},prompt:'test',onText(){assert.fail('must not emit response');}});
 const error=deepSeekHTTPError(503,{'retry-after':'10'}),wire=JSON.stringify({type:'error',message:error.message,recovery:error.recovery});
 child.stdout.write(wire.slice(0,20));child.stdout.write(wire.slice(20));child.stderr.write(error.message);child.emit('close',1);
 await assert.rejects(pending,value=>value.recovery.httpStatus===503&&value.recovery.retryAt===error.recovery.retryAt);assert.equal(spawned,1);
});
test('a later HTTP rejection never offers replay of a turn that already executed a tool',async()=>{
 const {mkdtemp,rm,readFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {configureDeepSeek,runDeepSeekCLI}=await import('../../../src/features/runtimes/deepseek-runtime.mjs');
 const directory=await mkdtemp(path.join(tmpdir(),'kuneco-limit-'));let calls=0;
 try{
  await configureDeepSeek(directory,{apiKey:'fixture-key'},async()=>({data:[{id:'deepseek-flash'}]}));
  await assert.rejects(runDeepSeekCLI('chat',{sessionId:'1ba862d2-06b1-4779-9820-cc9061e94594',prompt:'write once',project:directory},{directory,request:async(_proxy,_key,route)=>{
   if(route==='/models')return {data:[]};if(calls++)throw deepSeekHTTPError(429,{'retry-after':'1'});
   return {choices:[{message:{tool_calls:[{id:'once',type:'function',function:{name:'Bash',arguments:JSON.stringify({command:'printf once >> marker'})}}]},finish_reason:'tool_calls'}]};
  }}),error=>error.recovery.manualRetry===false&&error.recovery.executionUnknown===true);
  assert.equal(calls,2);assert.equal(await readFile(path.join(directory,'marker'),'utf8'),'once');
 }finally{await rm(directory,{recursive:true,force:true});}
});
