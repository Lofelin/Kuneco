import test from 'node:test';import assert from 'node:assert/strict';
import {summarizeTurnChanges} from '../../../src/features/chat/turn-changes.mjs';
import {recordArtifacts,insightView} from '../../../src/features/chat/chat-insights.mjs';
const scope={owner:'a',environmentId:'e',chatId:'c'},turn={...scope,id:'t'};
const receipt=(extra={})=>({id:'one',turnId:'t',path:'/a',before:'old\n',after:'new\nadded\n',...extra});
test('only exact round and account/environment/conversation identities are accepted',()=>{
 const rows=[receipt(),receipt({turnId:'old',path:'/unrelated'}),receipt({turnId:undefined,path:'/legacy'})];
 const result=summarizeTurnChanges(rows,turn,scope);assert.equal(result.files.length,1);assert.equal(result.added,2);assert.equal(result.removed,1);
 for(const key of Object.keys(scope))assert.equal(summarizeTurnChanges(rows,turn,{...scope,[key]:'other'}),null);
 assert.equal(summarizeTurnChanges(rows,null),null);
});
test('multiple consecutive writes count final net change; intervening modification is unknown',()=>{
 const rows=[receipt(),receipt({id:'two',before:'new\nadded\n',after:'old\n'})];
 assert.equal(summarizeTurnChanges(rows,turn).added,0);assert.equal(summarizeTurnChanges(rows,turn).removed,0);
 rows[1].before='external';const result=summarizeTurnChanges(rows,turn);assert.equal(result.added,null);assert.match(result.files[0].change.unavailable,/不连续/);
});
test('missing, binary and repeated patch-only changes never report invented zero totals',()=>{
 for(const extra of [{before:undefined,after:undefined},{unavailable:'二进制文件'}])assert.equal(summarizeTurnChanges([receipt(extra)],turn).added,null);
 const patch=receipt({before:undefined,after:undefined,diff:'@@ -1,1 +1,2 @@\n-old\n+new\n+added\n'});
 assert.equal(summarizeTurnChanges([patch],turn).added,2);assert.equal(summarizeTurnChanges([patch,{...patch,id:'two'}],turn).added,null);
});
test('receipts are deduplicated within turns but reused tool ids in new turns stay separate',()=>{
 const item={id:'c',fileChangeTurn:turn};const a={id:'tool',status:'completed',changes:[{path:'/a',before:'',after:'a\n'}]};
 recordArtifacts(item,a,'old');recordArtifacts(item,a,'t');recordArtifacts(item,a,'t');
 const view=insightView(item,[{id:'c',messages:[{reasoning:{activities:[a]}}]}],scope);
 assert.equal(view.artifacts.length,2);assert.equal(view.turnChanges.files.length,1);assert.equal(view.turnChanges.added,1);
 item.fileChangeTurn={...turn,id:'next'};assert.equal(insightView(item,[],scope).turnChanges.files.length,0);
});
test('failed tools are excluded while earlier confirmed writes remain after stop or failure',()=>{
 const item={id:'c',fileChangeTurn:turn};recordArtifacts(item,{id:'ok',status:'completed',changes:[{path:'/a',before:'',after:'\n'}]},'t');
 recordArtifacts(item,{id:'no',status:'failed',changes:[{path:'/b',before:'',after:'x'}]},'t');
 assert.equal(insightView(item,[],scope).turnChanges.added,1);assert.equal(item.artifacts.length,1);
});
test('large approximate diff and truncated unified hunks never masquerade as exact counts',()=>{
 const middle=Array.from({length:1001},(_,i)=>String(i)).join('\n');
 assert.equal(summarizeTurnChanges([receipt({before:'old\n'+middle+'\nold',after:'new\n'+middle+'\nnew'})],turn).added,null);
 assert.equal(summarizeTurnChanges([receipt({before:undefined,after:undefined,diff:'@@ -1,3 +1,3 @@\n-one\n+two'})],turn).added,null);
});
test('terminal newline is not a phantom extra line and changing it is a real line replacement',()=>{
 assert.equal(summarizeTurnChanges([receipt({before:'',after:'a\nb\n'})],turn).added,2);
 const changed=summarizeTurnChanges([receipt({before:'a',after:'a\n'})],turn);assert.equal(changed.added,1);assert.equal(changed.removed,1);
});
