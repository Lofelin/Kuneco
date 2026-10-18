import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeChatPayload,decodeChatPayload} from '../../../src/features/chat/chat-object-store.mjs';
import {mergeChatPayload,saveChatSnapshot,ChatSyncConflict} from '../../../src/features/chat/chat-sync.mjs';
const snapshot=(text='hello')=>({activeAISessionId:'a',sessions:[{id:'a',title:'A'}],views:[{id:'a',messages:[{role:'user',text}]}]});
test('merge independent chats, metadata and message extensions without dropping remote content',()=>{
 const base=snapshot(),local=structuredClone(base),remote=structuredClone(base);
 local.sessions[0].pinned=true;remote.sessions.push({id:'b',title:'B'});remote.views.push({id:'b',messages:[]});remote.views[0].messages.push({role:'assistant',text:'reply'});
 const merged=mergeChatPayload(base,local,remote);assert.equal(merged.sessions.length,2);assert.equal(merged.sessions[0].pinned,true);assert.equal(merged.views[0].messages.length,2);assert.equal(base.sessions.length,1);
});
test('divergent messages and delete/edit conflicts stop rather than overwrite',()=>{
 assert.throws(()=>mergeChatPayload(snapshot(),snapshot('local'),snapshot('remote')),ChatSyncConflict);
 assert.throws(()=>mergeChatPayload(snapshot(),snapshot(),{sessions:[],views:[]}),ChatSyncConflict);
 const remote=snapshot();remote.sessions[0].title='changed';assert.throws(()=>mergeChatPayload(snapshot(),{sessions:[],views:[],activeAISessionId:null},remote),ChatSyncConflict);
});
test('409 fetches latest revision and retries merged payload once',async()=>{
 const base=snapshot(),local=structuredClone(base),remote=structuredClone(base);local.sessions[0].pinned=true;remote.sessions.push({id:'b'});const calls=[];
 const result=await saveChatSnapshot({owner:'owner',revision:1,payload:local,base,isCurrent:()=>true,client:{chats:async()=>({revision:2,payload:remote}),saveChats:async value=>{calls.push(value);if(calls.length===1)throw Object.assign(new Error('old message'),{status:409});return {revision:3};}}});
 assert.equal(calls.length,2);assert.equal(calls[1].revision,2);assert.equal(result.payload.sessions.length,2);assert.equal(result.revision,3);
});
test('identical remote payload needs no second write and account changes never retry',async()=>{
 const payload=snapshot();let calls=0;const client={saveChats:async()=>{calls++;throw Object.assign(new Error(),{status:409});},chats:async()=>({revision:3,payload})};
 assert.equal((await saveChatSnapshot({client,payload,base:payload,revision:1,owner:'a',isCurrent:()=>true})).revision,3);assert.equal(calls,1);
 await assert.rejects(saveChatSnapshot({client,payload,base:payload,revision:1,owner:'a',isCurrent:()=>false}),/账号已变化/);assert.equal(calls,2);
});
test('repeated conflict and network failures do not loop or silently overwrite',async()=>{
 let calls=0;const base=snapshot(),local=snapshot();local.sessions[0].pinned=true;
 await assert.rejects(saveChatSnapshot({client:{chats:async()=>({revision:2,payload:base}),saveChats:async()=>{calls++;throw Object.assign(new Error(),{status:409});}},payload:local,base,revision:1,owner:'a',isCurrent:()=>true}),ChatSyncConflict);assert.equal(calls,2);
 await assert.rejects(saveChatSnapshot({client:{saveChats:async()=>{throw new Error('offline');}},payload:local,base,revision:1,owner:'a',isCurrent:()=>true}),/offline/);
});

test('decoded image key order does not reject a completed stream with an independent cloud append',async()=>{
 const image={dataURL:'data:image/png;base64,AAAA',name:'fixture.png',detail:'high'};
 const base={sessions:[{id:'a'},{id:'b'}],views:[{id:'a',messages:[{role:'user',text:'image',images:[image]},{role:'assistant',text:'',reasoning:{phase:'process',processMs:5000}}]},{id:'b',messages:[]}]};
 const blocks=new Map(),packed=await encodeChatPayload(base,async(id,value,scope)=>blocks.set(scope+':'+id,value));
 const remote=await decodeChatPayload(packed,async(id,scope)=>blocks.get(scope+':'+id));
 assert.notDeepEqual(Object.keys(remote.views[0].messages[0].images[0]),Object.keys(image));
 remote.views[1].messages.push({role:'user',text:'cloud update'});
 const local=structuredClone(base);Object.assign(local.views[0].messages[1],{text:'finished',reasoning:{phase:'completed',processMs:11000}});
 const merged=mergeChatPayload(base,local,remote);
 assert.equal(merged.views[0].messages[1].text,'finished');assert.deepEqual(merged.views[0].messages[0].images,[image]);assert.equal(merged.views[1].messages[0].text,'cloud update');
 remote.views[0].messages[0].images[0].dataURL='data:image/png;base64,BBBB';
 assert.throws(()=>mergeChatPayload(base,local,remote),ChatSyncConflict,'a genuine concurrent image edit still conflicts');
});
