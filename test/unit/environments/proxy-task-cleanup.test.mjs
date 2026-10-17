import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {trackProxyTask} from '../../../src/features/environments/proxy-task-cleanup.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){const child=new EventEmitter(),calls=[];child.kill=signal=>calls.push(signal);const manager={exec:async(...args)=>calls.push(args)};trackProxyTask(manager,'owner','env','prefix','task',child);return {manager,child,calls};}
test('unexpected Docker CLI close sends container cancellation and releases tracking after cleanup',async()=>{
 const {manager,child,calls}=fixture();let release;manager.exec=(...args)=>{calls.push(args);return new Promise(r=>release=r);};
 child.emit('close',null,'SIGKILL');assert.equal(manager.directTasks.size,1);assert.equal(calls[0][2].at(-1),'1');release();await tick();assert.equal(manager.directTasks.size,0);
});
test('normal CLI close reconciles without creating an early-cancellation marker',async()=>{
 const {manager,child,calls}=fixture();child.emit('close',0,null);await tick();assert.equal(calls[0][2].at(-1),'0');assert.equal(manager.directTasks.size,0);
});
test('failed cancellation does not kill client or discard retry and blocks new launches',async()=>{
 const {manager,child,calls}=fixture();manager.exec=async()=>{throw Error('control unavailable');};const errors=[];child.on('error',e=>errors.push(e));
 child.kill();await tick();assert.equal(calls.length,0);assert.equal(errors.length,1);assert.equal(manager.directTasks.size,1);assert.ok(manager.directStopFailures.has('prefix'));
 manager.exec=async()=>{};await manager.directTasks.get('task').cancel();child.emit('close',143,null);await tick();assert.equal(manager.directTasks.size,0);
});
test('immutable exec tracking recovers after worker was stopped without touching replacement name',async()=>{
 const child=new EventEmitter();child.kill=()=>{};const containerId='c'.repeat(64),endpoint='unix:///owned.sock',calls=[];
 const manager={exec:async()=>{throw Error('must not resolve name');},command:async(a,o)=>{calls.push(a);assert.equal(o.endpoint,endpoint);if(a[0]==='exec'){assert.equal(a[3],containerId);throw Error('container stopped');}return '{"Running":false}';}};
 trackProxyTask(manager,'owner','env','prefix','task',child,undefined,{containerId,endpoint});child.emit('close',null,'SIGKILL');await tick();assert.equal(manager.directTasks.size,0);assert.equal(calls.length,2);assert.ok(!manager.directStopFailures?.has('prefix'));
});
test('external cleanup failure uses its immutable container and endpoint fallback',async()=>{
 const child=new EventEmitter();child.kill=()=>{};const containerId='d'.repeat(64),endpoint='unix:///external.sock';let inspected=0;
 const manager={command:async(a,o)=>{assert.equal(o.endpoint,endpoint);assert.equal(a.at(-1),containerId);inspected++;return '{"Running":false,"Restarting":false}';}};
 trackProxyTask(manager,'owner','env','prefix','task',child,async()=>{throw Error('external stopped');},{containerId,endpoint});child.emit('close',143,null);await tick();assert.equal(inspected,1);assert.equal(manager.directTasks.size,0);
});
