import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelWithContainerFallback,taskContainerStopped} from '../../../src/features/environments/task-container-state.mjs';
const execution={containerId:'a'.repeat(64),endpoint:'unix:///fixture.sock'};
test('cancel success never inspects; stopped immutable container completes failed cleanup',async()=>{
 let reads=0;const manager={command:async(a,o)=>{reads++;assert.equal(a.at(-1),execution.containerId);assert.equal(o.endpoint,execution.endpoint);return '{"Running":false,"Restarting":false}';}};
 await cancelWithContainerFallback(manager,execution,async()=>{});assert.equal(reads,0);
 await cancelWithContainerFallback(manager,execution,async()=>{throw Error('stopped');});assert.equal(reads,1);
});
test('running or restarting container retains cancellation error',async()=>{
 for(const state of [{Running:true},{Running:false,Restarting:true}])await assert.rejects(cancelWithContainerFallback({command:async()=>JSON.stringify(state)},execution,async()=>{throw Error('cancel failed');}),/cancel failed/);
});
test('inspect error needs successful complete ID listing proving absence',async()=>{
 for(const present of [true,false]){const manager={command:async a=>{if(a[0]==='inspect')throw Error('inspect failed');assert.deepEqual(a,['ps','-aq','--no-trunc']);return present?execution.containerId:'b'.repeat(64);}};if(present)await assert.rejects(taskContainerStopped(manager,execution),/inspect failed/);else assert.equal(await taskContainerStopped(manager,execution),true);}
 await assert.rejects(taskContainerStopped({command:async()=>{throw Error('daemon offline');}},execution),/daemon offline/);
 await assert.rejects(taskContainerStopped({}, {...execution,containerId:'mutable-name'}),/ID/);
});
