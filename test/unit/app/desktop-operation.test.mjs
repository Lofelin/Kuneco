import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {setTimeout as delay} from 'node:timers/promises';
import {runDesktopOperation} from '../../e2e/helpers/desktop-operation.mjs';

function harness(login) {
 const page=vm.createContext({window:{},workspace:{accountLogin:login}});
 let commands=0;
 const evaluate=async expression=>{
  commands++;
  let timer;
  try{return await Promise.race([Promise.resolve(vm.runInContext(expression,page)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('CDP command timed out')),10);})]);}
  finally{clearTimeout(timer);}
 };
 const until=async(fn,timeoutMs)=>{
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){const result=await fn();if(result)return result;await delay(1);}
  throw new Error('Operation deadline exceeded');
 };
 return {evaluate,until,page,commands:()=>commands};
}

test('awaiting the entire login in one CDP command reproduces the shorter driver timeout',async()=>{
 let release;const ctx=harness(()=>new Promise(resolve=>{release=resolve;}));
 try{await assert.rejects(ctx.evaluate('workspace.accountLogin()'),/CDP command timed out/);}
 finally{release();}
});

test('slow login outlives the CDP command budget without blocking observation or replaying login',async()=>{
 let calls=0,release;
 const ctx=harness(()=>{calls++;return new Promise(resolve=>{release=resolve;});});
 const pending=runDesktopOperation(ctx,'workspace.accountLogin()',{name:'slow fixture login',timeoutMs:1000});
 await delay(30); // The original awaited Runtime.evaluate would time out at 10ms.
 assert.equal(calls,1);
 assert.ok(ctx.commands()>2,'CDP remains responsive while login is pending');
 release();await pending;
 assert.equal(calls,1);
 assert.equal(Object.keys(ctx.page.window).length,0);
});

test('login rejection preserves its cause and is never retried',async()=>{
 let calls=0;const ctx=harness(()=>{calls++;throw new Error('fixture credentials rejected');});
 await assert.rejects(runDesktopOperation(ctx,'workspace.accountLogin()',{name:'layout-one'}),/layout-one.*fixture credentials rejected/);
 assert.equal(calls,1);assert.equal(Object.keys(ctx.page.window).length,0);
});

test('pending login has a bounded operation deadline and cleans up observation state',async()=>{
 let calls=0;const ctx=harness(()=>{calls++;return new Promise(()=>{});});
 await assert.rejects(runDesktopOperation(ctx,'workspace.accountLogin()',{name:'stalled login',timeoutMs:20}),/stalled login.*Operation deadline exceeded/);
 assert.equal(calls,1);assert.equal(Object.keys(ctx.page.window).length,0);
});
