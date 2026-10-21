import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {MemoryStore} from '../../../src/features/memory/memory-store.mjs';
import {MemoryService} from '../../../src/features/memory/memory-service.mjs';
const scope={owner:'a',environmentId:'dev'};
async function fixture(t){const dir=await mkdtemp(path.join(tmpdir(),'memory-preferences-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new MemoryStore({file:path.join(dir,'memory.bin')});await store.load();return store;}
test('memory settings persist per scope, bound actual recall and preserve extraction deduplication context',async t=>{
 const store=await fixture(t);for(let n=0;n<10;n++)await store.change(scope,'create',{title:'release '+n,content:'release convention '+n,enabled:true,type:'fact'});
 await store.change(scope,'settings',{limit:4,budget:3000});assert.equal(store.recall(scope,'release').length,4);
 await store.change(scope,'settings',{recall:false});assert.deepEqual(store.recall(scope,'release'),[]);assert.ok(store.recall(scope,'release',{forExtraction:true}).length>0);
 assert.equal(store.status({owner:'a',environmentId:'other'}).recall,true);assert.equal(store.status({owner:'b',environmentId:'dev'}).limit,8);
 const next=new MemoryStore({file:store.file});await next.load();assert.equal(next.status(scope).limit,4);assert.equal(next.status(scope).budget,3000);assert.equal(next.status(scope).recall,false);
 await assert.rejects(next.change(scope,'settings',{budget:Infinity}),/召回/);assert.equal(next.status(scope).budget,3000);
});
test('extraction emits scoped lifecycle log metadata without transcripts',async t=>{
 const store=await fixture(t),events=[];const service=new MemoryService({store,getScope:()=>scope,onJobEvent:(s,e)=>events.push({scope:s,...e}),extract:async()=>({memories:[]})});
 await service.recordTurn(scope,{turnId:'turn',engine:'deepseek',userText:'private user text',assistantText:'private assistant text'});await service.tick();
 assert.deepEqual(events.map(e=>e.status),['queued','running','completed']);assert.ok(events.every(e=>e.scope.environmentId==='dev'&&e.engine==='deepseek'));assert.doesNotMatch(JSON.stringify(events),/private user|private assistant/);assert.equal(events.at(-1).count,0);
});
