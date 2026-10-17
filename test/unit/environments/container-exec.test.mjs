import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const wrapper=fileURLToPath(new URL('../../../docker/runtime/exec.mjs',import.meta.url));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(25);}throw new Error('timed out waiting for child');}
function run(t,args,{id=randomUUID()}={}){
  const pidFile='/tmp/dingtu-'+id;
  const child=spawn(process.execPath,[wrapper,id,...args],{stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',()=>{});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');});
  return {child,pidFile,exited,output:()=>output};
}
async function removed(path){await assert.rejects(stat(path),{code:'ENOENT'});}
async function dead(pid){await waitFor(()=>{try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}});}
test('container exec preserves normal exit status and removes its cancellation file',{timeout:10000},async t=>{
  const runState=run(t,[process.execPath,'-e','process.exit(7)']);
  assert.equal((await runState.exited).code,7);await removed(runState.pidFile);
});
test('container exec spawn failure leaves no cancellation file',{timeout:10000},async t=>{
  const runState=run(t,['/kuneco/nonexistent-command']);
  assert.equal((await runState.exited).code,1);await removed(runState.pidFile);
});
test('container exec cancellation escalates TERM for the entire task group',{timeout:10000},async t=>{
  const script=`const {spawn}=require('node:child_process');process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('descendant '+process.pid);setInterval(()=>{},1000)"],{stdio:'inherit'});console.log('leader '+process.pid);setInterval(()=>{},1000);`;
  const r=run(t,[process.execPath,'-e',script]);
  await waitFor(()=>r.output().includes('descendant '));
  assert.equal(Number(await readFile(r.pidFile,'utf8')),r.child.pid);
  const leader=Number(r.output().match(/leader (\d+)/)[1]);
  const descendant=Number(r.output().match(/descendant (\d+)/)[1]);
  await writeFile(r.pidFile+'.cancel','');
  const started=Date.now();r.child.kill('SIGTERM');
  assert.equal((await r.exited).code,143);
  assert.ok(Date.now()-started>=900);assert.ok(Date.now()-started<4000);
  await dead(leader);await dead(descendant);await removed(r.pidFile);await removed(r.pidFile+'.cancel');
});
test('container exec cleans surviving descendants after a normal leader exit',{timeout:10000},async t=>{
  const script=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('descendant '+process.pid);setInterval(()=>{},1000)"],{stdio:['ignore','pipe','inherit']});child.stdout.once('data',data=>{process.stdout.write(data);process.exit(0);});`;
  const r=run(t,[process.execPath,'-e',script]);await waitFor(()=>r.output().includes('descendant '));
  const descendant=Number(r.output().match(/descendant (\d+)/)[1]);
  assert.equal((await r.exited).code,0);await dead(descendant);await removed(r.pidFile);
});
test('container exec continues cancellation after the leader exits on TERM',{timeout:10000},async t=>{
  const script=`const {spawn}=require('node:child_process');spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('descendant '+process.pid);setInterval(()=>{},1000)"],{stdio:'inherit'});setInterval(()=>{},1000);`;
  const r=run(t,[process.execPath,'-e',script]);await waitFor(()=>r.output().includes('descendant '));
  const descendant=Number(r.output().match(/descendant (\d+)/)[1]);
  r.child.kill('SIGTERM');assert.equal((await r.exited).code,143);
  await dead(descendant);await removed(r.pidFile);
});

test('container exec honors cancellation recorded before wrapper startup',{timeout:10000},async t=>{
  const id=randomUUID(),pidFile='/tmp/dingtu-'+id;
  await writeFile(pidFile+'.cancel','');
  const r=run(t,[process.execPath,'-e',"console.log('must not run');setInterval(()=>{},1000)"],{id});
  assert.equal((await r.exited).code,143);assert.equal(r.output(),'');
  await removed(pidFile);await removed(pidFile+'.cancel');
});
