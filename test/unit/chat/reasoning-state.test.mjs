import test from 'node:test';
import assert from 'node:assert/strict';
import {updateReasoningState,reasoningSnapshot} from '../../../src/features/chat/reasoning-state.mjs';

test('waiting, thinking and answer streaming are timed independently, with multiple thinking segments',()=>{
 const state=updateReasoningState(null,{phase:'waiting'},1000);
 updateReasoningState(state,{text:'first'},6000);
 updateReasoningState(state,{phase:'answering'},8000);
 assert.equal(reasoningSnapshot(state,20000).thinkingMs,2000);
 updateReasoningState(state,{text:'second'},21000);
 updateReasoningState(state,{phase:'completed'},24000);
 const saved=reasoningSnapshot(state,50000);
 assert.equal(saved.waitingMs,5000);assert.equal(saved.thinkingMs,5000);assert.equal(saved.durationMs,5000);
});
test('terminal states survive redundant completion and late stream updates',()=>{
 for(const phase of ['failed','stopped','completed']){
  const state=updateReasoningState(null,{kind:'process',phase:'process'},1000);
  updateReasoningState(state,{phase},4000);
  updateReasoningState(state,{phase:'completed'},5000);
  updateReasoningState(state,{text:'late',phase:'process'},6000);
  assert.equal(state.phase,phase);assert.equal(state.text,'');assert.equal(reasoningSnapshot(state,10000).processMs,3000);
 }
});
test('history preserves failure and stop, interrupts active snapshots, and never charges offline time',()=>{
 for(const phase of ['waiting','thinking','process','answering','stopped','failed','completed']){
  const stored={phase,kind:'thinking',text:'partial',waitingMs:3000,thinkingMs:1500,userExpanded:true};
  const restored=updateReasoningState(null,{...stored,complete:true},9000000);
  const saved=reasoningSnapshot(restored,9900000);
  assert.equal(saved.phase,['completed','stopped','failed'].includes(phase)?phase:'stopped');
  assert.equal(saved.waitingMs,3000);assert.equal(saved.thinkingMs,1500);assert.equal(saved.userExpanded,true);
 }
 const legacy=updateReasoningState(null,{text:'old',durationMs:5200,complete:true},9000000);
 assert.equal(legacy.phase,'completed');assert.equal(reasoningSnapshot(legacy).durationMs,5200);
});
test('parallel turns have independent clocks and stopping one does not settle another',()=>{
 const a=updateReasoningState(null,{phase:'waiting'},1000),b=updateReasoningState(null,{kind:'process'},2000);
 updateReasoningState(a,{text:'thought'},3000);updateReasoningState(a,{phase:'stopped'},4000);
 assert.equal(reasoningSnapshot(a,9000).thinkingMs,1000);assert.equal(reasoningSnapshot(b,9000).processMs,7000);assert.equal(b.phase,'process');
});
test('terminal turns settle pending tools without fabricating successful execution',()=>{
 for(const phase of ['completed','stopped','failed']){
  const state=updateReasoningState(null,{kind:'process',activities:[{id:'pending',status:'in_progress'},{id:'done',status:'completed'}]},0);
  updateReasoningState(state,{phase},1000);
  assert.equal(state.activities[0].status,phase==='completed'?'interrupted':phase);assert.equal(state.activities[1].status,'completed');
 }
});
