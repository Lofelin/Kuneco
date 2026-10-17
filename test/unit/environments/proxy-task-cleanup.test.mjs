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
