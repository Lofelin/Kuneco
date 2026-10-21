import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {MemoryRepository} from '../../../src/features/memory/memory-repository.mjs';
import {MemoryStore} from '../../../src/features/memory/memory-store.mjs';
import {SyncedMemoryStore} from '../../../src/features/memory/memory-sync-store.mjs';
const scope={owner:'alice',environmentId:'dev'},source={turnId:'one',engine:'codex',userText:'以后使用中文回复',assistantText:'好的'};
async function fixture(t){const directory=await mkdtemp(path.join(tmpdir(),'kuneco-memory-choice-'));t.after(()=>rm(directory,{recursive:true,force:true}));const records=new Map();let requests=0;
 const api=async(s,value)=>{requests++;const key=JSON.stringify(s),old=records.get(key)||{revision:0,payload:null};if(!value)return {...structuredClone(old),serverTime:Date.now()};if(value.revision!==old.revision)throw Object.assign(Error('conflict'),{status:409});const next={revision:old.revision+1,payload:structuredClone(value.payload)};records.set(key,next);return {revision:next.revision,serverTime:Date.now()};};
 const open=async()=>{const legacyFile=path.join(directory,'legacy.bin'),repo=new MemoryRepository({legacyFile,file:path.join(directory,'choice.bin'),local:new MemoryStore({file:path.join(directory,'local.bin')}),remote:new SyncedMemoryStore({legacyFile,file:path.join(directory,'cache.bin'),remote:api})});await repo.load();return repo;};return {directory,records,open,get requests(){return requests;}};
}
test('default device storage never calls memory APIs for read, write, queue, recall or reload',async t=>{
 const f=await fixture(t),r=await f.open();assert.equal(r.mode(scope),'local');await r.sync(scope,{force:true});await r.change(scope,'create',{title:'个人偏好',content:'使用中文',enabled:true});await r.enqueue(scope,source);assert.equal(r.list(scope).length,1);assert.equal(r.status(scope).storage,'local');assert.ok(r.recall(scope,'中文').length);const next=await f.open();await next.sync(scope,{force:true});assert.equal(next.list(scope).length,1);assert.equal(next.status(scope).jobs.length,1);assert.equal(f.requests,0);
});
test('choosing cloud does not upload device data until explicit import; switching back prevents all memory requests',async t=>{
 const f=await fixture(t),r=await f.open();await r.change(scope,'create',{title:'本机约定',content:'设备专用',enabled:true});await r.enqueue(scope,source);const local=r.list(scope)[0];await r.setStorage(scope,'remote');await r.sync(scope,{force:true});assert.equal(r.list(scope).length,0);assert.equal(f.records.size,0);await r.uploadLocal(scope);assert.equal(r.list(scope)[0].id,local.id);assert.equal(r.status(scope).jobs.length,1);await r.uploadLocal(scope);assert.equal(r.list(scope).length,1);assert.equal(r.status(scope).jobs.length,1);const requests=f.requests;await r.setStorage(scope,'local');await r.sync(scope,{force:true});await r.change(scope,'settings',{recall:false});assert.equal(f.requests,requests);const reopened=await f.open();assert.equal(reopened.mode(scope),'local');assert.equal(reopened.status(scope).recall,false);assert.equal(f.requests,requests);
});
test('cloud choice persists per account and environment, other scopes still default to device',async t=>{
 const f=await fixture(t),r=await f.open();await r.setStorage(scope,'remote');await r.sync(scope,{force:true});await r.change(scope,'create',{title:'同步内容',content:'云端记录',enabled:true});const next=await f.open();assert.equal(next.mode(scope),'remote');assert.equal(next.mode({owner:'bob',environmentId:'dev'}),'local');assert.equal(next.mode({owner:'alice',environmentId:'other'}),'local');await next.sync(scope,{force:true});assert.equal(next.list(scope)[0].content,'云端记录');
});
test('an old remote cache never silently enables cloud sync after local preference file is absent',async t=>{
 const f=await fixture(t),r=await f.open();await r.remote.sync(scope,{force:true});const next=await f.open(),before=f.requests;assert.equal(next.mode(scope),'local');await next.sync(scope,{force:true});assert.equal(f.requests,before);
});
test('async local recall rejects stale atoms, derived members and storage switches without uploading',async t=>{
 const f=await fixture(t),r=await f.open();await r.change(scope,'create',{title:'约定',content:'简报使用中文',enabled:true});const item=r.list(scope)[0];let release;r.retriever={recall:()=>new Promise(resolve=>release=resolve),status:()=>({ready:true})};
 const pending=r.recallAsync(scope,'briefing');await r.change(scope,'update',{...item,enabled:false});release([{...item,layer:'L2',memberRefs:[{id:item.id,revision:item.revision}]}]);assert.deepEqual(await pending,[]);
 const next=r.list(scope)[0];await r.change(scope,'update',{...next,enabled:true});const current=r.list(scope)[0],inFlight=r.recallAsync(scope,'briefing');await r.setStorage(scope,'remote');release([current]);assert.deepEqual(await inFlight,[]);assert.equal(f.requests,0);
});
