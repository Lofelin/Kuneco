import test from 'node:test';
import assert from 'node:assert/strict';
import {ContainerGateway} from '../../../src/features/environments/docker-environments.mjs';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const ready={state:'ready',ip:'203.0.113.8',verificationState:'verified'};
function fixture(handler){
  const calls=[],events=[];let verified=0,started=0;
  const manager={rpc:async(_owner,_id,action)=>{calls.push(action);return handler?.(action) ?? ready;},command:async()=> 'true'};
  const gateway=new ContainerGateway(manager,'fixture-owner','183494cd-1b80-4886-a620-4956f9535772',12345,'fixture-token',async()=>{verified++;});
  gateway.startWorker=async()=>{started++;};gateway.on('status',status=>events.push({...status}));
  return {gateway,calls,events,manager,get verified(){return verified;},get started(){return started;}};
}
for(const action of ['stop','block'])test(`container ${action} invalidates a pending status result`,async()=>{
  const pending=deferred(),f=fixture(op=>op==='status'?pending.promise:undefined),sync=f.gateway.sync();await Promise.resolve();
  if(action==='stop')await f.gateway.stop();else f.gateway.block('explicit block');
  const eventCount=f.events.length;pending.resolve(ready);await sync;
  assert.notEqual(f.gateway.status.state,'ready');assert.equal(f.events.length,eventCount,'stale status must not be emitted');assert.equal(f.calls.filter(x=>x==='status').length,1);
  await f.gateway.stop();
});
for(const action of ['stop','block'])test(`container ${action} prevents late verification from persisting a pin or starting worker`,async()=>{
  const pending=deferred(),f=fixture(op=>op==='verify'?pending.promise:undefined),verification=f.gateway.verify();await Promise.resolve();
  if(action==='stop')await f.gateway.stop();else f.gateway.block('explicit block');
  pending.resolve(ready);await verification;
  assert.equal(f.verified,0);assert.equal(f.started,0);assert.equal(f.calls.filter(x=>x==='status').length,0);assert.notEqual(f.gateway.status.state,'ready');
  await f.gateway.stop();
});
test('stopping while fixed-exit persistence is pending prevents worker startup',async()=>{
  const persist=deferred(),entered=deferred(),f=fixture();
  f.gateway.onVerified=async()=>{entered.resolve();await persist.promise;};
  const verification=f.gateway.verify();await entered.promise;await f.gateway.stop();persist.resolve();await verification;
  assert.equal(f.started,0);assert.equal(f.calls.filter(x=>x==='status').length,0);
});
test('stale failed status inspection cannot overwrite a stopped adapter',async()=>{
  const inspect=deferred(),entered=deferred(),f=fixture(op=>op==='status'?Promise.reject(new Error('control unavailable')):undefined);
  f.manager.command=async()=>{entered.resolve();return inspect.promise;};
  const sync=f.gateway.sync();await entered.promise;await f.gateway.stop();const before={...f.gateway.status},count=f.events.length;
  inspect.resolve('true');await sync;assert.deepEqual(f.gateway.status,before);assert.equal(f.events.length,count);
});
test('monitoring is single-instance and cannot restart after stop',async t=>{
  const intervals=new Set();let created=0;
  t.mock.method(globalThis,'setInterval',callback=>{const interval={callback,unref(){}};intervals.add(interval);created++;return interval;});
  t.mock.method(globalThis,'clearInterval',interval=>intervals.delete(interval));
  const f=fixture();f.gateway.startMonitoring();f.gateway.startMonitoring();f.gateway.startMonitoring();
  assert.equal(created,1);assert.equal(intervals.size,1);
  const callback=[...intervals][0].callback;callback();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.filter(x=>x==='status').length,1);
  await f.gateway.stop();assert.equal(intervals.size,0);f.gateway.startMonitoring();assert.equal(created,1);
  callback();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.filter(x=>x==='status').length,1,'stale callback must not issue another status RPC');
});
test('concurrent and repeated stop issue one control RPC',async()=>{
  const pending=deferred(),f=fixture(op=>op==='stop'?pending.promise:undefined);
  const first=f.gateway.stop(),second=f.gateway.stop();await Promise.resolve();assert.equal(f.calls.filter(x=>x==='stop').length,1);
  pending.resolve();await Promise.all([first,second]);await f.gateway.stop();assert.equal(f.calls.filter(x=>x==='stop').length,1);
});
test('newer status snapshot wins when concurrent sync results arrive out of order',async()=>{
  const older=deferred(),newer=deferred();let requested=0;
  const f=fixture(op=>op==='status'?(++requested===1?older.promise:newer.promise):undefined);
  const first=f.gateway.sync();await Promise.resolve();const second=f.gateway.sync();await Promise.resolve();
  const latest={...ready,reason:'latest snapshot'};newer.resolve(latest);await second;
  older.resolve({...ready,state:'blocked',reason:'obsolete snapshot'});await first;
  assert.deepEqual(f.gateway.status,latest);assert.deepEqual(f.events,[latest]);await f.gateway.stop();
});
test('closed adapter does not issue verification, health or region RPCs',async()=>{
  const f=fixture();await f.gateway.stop();const calls=[...f.calls],status={...f.gateway.status};
  const results=await Promise.all([f.gateway.verify(),f.gateway.checkNow(),f.gateway.detectRegion(),f.gateway.sync()]);
  assert.deepEqual(f.calls,calls);for(const result of results)assert.deepEqual(result,status);assert.equal(f.events.length,0);
});
test('late fixed-exit persistence failure after stop cannot overwrite status or repeat stop',async()=>{
  const persist=deferred(),entered=deferred(),f=fixture();
  f.gateway.onVerified=async()=>{entered.resolve();return persist.promise;};
  const verification=f.gateway.verify();await entered.promise;await f.gateway.stop();
  const status={...f.gateway.status},count=f.events.length;persist.reject(new Error('late persistence failure'));
  await verification;assert.deepEqual(f.gateway.status,status);assert.equal(f.events.length,count);assert.equal(f.started,0);
  assert.equal(f.calls.filter(x=>x==='stop').length,1);assert.equal(f.calls.filter(x=>x==='status').length,0);
});
test('pending block RPC prevents polling stale ready state until it completes',async()=>{
  const pending=deferred(),f=fixture(op=>op==='block'?pending.promise:undefined);f.gateway.status={...ready};
  f.gateway.block('manual block');const sync=f.gateway.sync();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.calls.filter(x=>x==='status').length,0);assert.equal(f.gateway.status.state,'blocked');assert.ok(f.events.every(event=>event.state==='blocked'));
  pending.resolve({state:'blocked'});await sync;await new Promise(resolve=>setImmediate(resolve));
  const after=f.calls.filter(x=>x==='status').length;await f.gateway.sync();assert.equal(f.calls.filter(x=>x==='status').length,after+1,'polling resumes after block completion');await f.gateway.stop();
});
for(const method of ['verify','checkNow'])test(`failed block cannot be undone by polling; successful explicit ${method} can recover`,async()=>{
  const pending=deferred(),f=fixture(op=>op==='block'?pending.promise:undefined);f.gateway.status={...ready};
  f.gateway.block('manual block');pending.reject(new Error('control connection lost'));await new Promise(resolve=>setImmediate(resolve));
  await f.gateway.sync();assert.equal(f.gateway.status.state,'blocked');assert.equal(f.gateway.status.controlState,'unavailable');assert.ok(f.events.every(event=>event.state==='blocked'));
  await f.gateway[method]();assert.equal(f.gateway.status.state,'ready');assert.equal(f.gateway.status.ip,ready.ip);assert.equal(f.calls.filter(x=>x==='verify').length,1);
  await f.gateway.stop();
});

test('stop follows an already dispatched block and cancels a not-yet-dispatched block',async()=>{
 const pending=deferred(),f=fixture(op=>op==='block'?pending.promise:undefined);
 f.gateway.block('pause');await Promise.resolve();assert.deepEqual(f.calls,['block']);
 const stopped=f.gateway.stop();await Promise.resolve();assert.deepEqual(f.calls,['block']);
 pending.resolve();await stopped;assert.deepEqual(f.calls,['block','stop']);
 const next=fixture();next.gateway.block('pause');await next.gateway.stop();assert.deepEqual(next.calls,['stop']);
});
test('strict stop reports live-container RPC failure, retries, and accepts confirmed stopped container',async()=>{
 let stops=0;
 const f=fixture(action=>{if(action==='stop' && ++stops===1)throw new Error('stop RPC unavailable');});
 f.manager.command=async()=>JSON.stringify({State:{Running:true,Restarting:false}});
 await assert.rejects(f.gateway.stop({strict:true}),/stop RPC unavailable/);
 await f.gateway.stop({strict:true});assert.equal(stops,2);
 await f.gateway.stop({strict:true});assert.equal(stops,2,'successful stop is retained');
 const stopped=fixture(action=>{if(action==='stop')throw new Error('control socket closed');});
 stopped.manager.command=async()=>JSON.stringify({State:{Running:false,Restarting:false}});
 await stopped.gateway.stop({strict:true});
 const restarting=fixture(action=>{if(action==='stop')throw new Error('still restarting');});
 restarting.manager.command=async()=>JSON.stringify({State:{Running:false,Restarting:true}});
 await assert.rejects(restarting.gateway.stop({strict:true}),/still restarting/);
});
