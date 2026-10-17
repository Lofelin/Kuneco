import test from 'node:test';
import assert from 'node:assert/strict';
import {createShutdownBarrier} from '../../../src/app/shutdown.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('quit waits for every cleanup and coalesces repeated attempts',async()=>{
 const task=deferred(),network=deferred();let calls=0;
 const barrier=createShutdownBarrier([()=>{calls++;return task.promise;},()=>network.promise]);
 const first=barrier.run();assert.equal(barrier.requested,true);assert.equal(barrier.run(),first);
 task.resolve();await Promise.resolve();assert.equal(barrier.complete,false);
 network.resolve();await first;assert.equal(barrier.complete,true);await barrier.run();assert.equal(calls,1);
});
test('failure is surfaced while another cleanup is pending; retry only retries failed steps',async()=>{
 const task=deferred();let failures=0,taskCalls=0,finishedCalls=0;
 const barrier=createShutdownBarrier([()=>{taskCalls++;return task.promise;},()=>{if(++failures===1)throw Error('Docker unavailable');},()=>{finishedCalls++;}]);
 await assert.rejects(barrier.run(),/Docker unavailable/);assert.equal(barrier.complete,false);assert.equal(barrier.requested,true);
 const retry=barrier.run();task.resolve();await retry;
 assert.equal(barrier.complete,true);assert.equal(taskCalls,1);assert.equal(finishedCalls,1);assert.equal(failures,2);
});
