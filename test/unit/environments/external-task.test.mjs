import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {externalTaskArguments,externalTaskCancellation,externalTaskScript,externalTaskCancelScript,verifyExternalTaskCapabilities} from '../../../src/features/environments/external-task.mjs';
const item={external:{id:'fixture-container',endpoint:'unix:///fixture.sock'}};
test('external task requires process-group capability and reports unavailable tools',async()=>{
 const calls=[];await verifyExternalTaskCapabilities({command:async(a,o)=>{calls.push([a,o]);}},item);
 assert.equal(calls[0][0][1],item.external.id);assert.equal(calls[0][1].endpoint,item.external.endpoint);assert.match(calls[0][0].at(-1),/command -v setsid/);
 await assert.rejects(verifyExternalTaskCapabilities({command:async()=>{throw Error('missing');}},item),/setsid/);
});
test('external task preserves command argv, uses its own session and passes stdin to background task',()=>{
 const token=randomUUID(),args=['literal $HOME','a; exit 1'];const result=externalTaskArguments(token,'tool',args);
 assert.deepEqual(result.slice(-3),['tool',...args]);assert.equal(result[4],'/tmp/kuneco-task-'+token);
 assert.match(externalTaskScript,/exec 3<&0/);assert.match(externalTaskScript,/<&3 &/);assert.match(externalTaskScript,/setsid sh/);
 assert.throws(()=>externalTaskArguments('../../etc','tool'),/无效/);
 execFileSync('sh',['-n'],{input:externalTaskScript});execFileSync('sh',['-n'],{input:externalTaskCancelScript});
});
test('external cancellation shares in-flight cleanup, retries failure and retains successful result',async()=>{
 let release,calls=0;const manager={command:async(a,o)=>{calls++;assert.equal(o.endpoint,item.external.endpoint);assert.equal(a[1],item.external.id);if(calls===1){await new Promise(r=>{release=r;});throw Error('daemon unavailable');}return '';}};
 const cancel=externalTaskCancellation(manager,item,randomUUID());const first=cancel(),second=cancel();assert.equal(first,second);release();await assert.rejects(first,/unavailable/);await cancel();await cancel();assert.equal(calls,2);
});
test('external cancellation publishes marker before waiting for PID and waits for done acknowledgement',()=>{
 assert.ok(externalTaskCancelScript.indexOf(': > "$p/cancel"')<externalTaskCancelScript.indexOf('test -f "$p/pid"'));
 assert.match(externalTaskCancelScript,/while ! test -f "\$p\/done"/);
 assert.match(externalTaskCancelScript,/kill -KILL "-\$pid"/);
 assert.match(externalTaskScript,/test -f "\$p\/cancel"/);
});
