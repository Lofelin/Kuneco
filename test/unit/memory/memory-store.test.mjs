import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MemoryStore,withMemory} from '../../../src/features/memory/memory-store.mjs';
const a={owner:'alice',environmentId:'dev'},b={owner:'alice',environmentId:'prod'},c={owner:'bob',environmentId:'dev'};
const entry=(title='约定')=>({title,content:'请使用中文回复。',enabled:true});
async function fixture(t,options={}){const dir=await mkdtemp(path.join(tmpdir(),'kuneco-memory-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new MemoryStore({file:path.join(dir,'memory.bin'),...options});await store.load();return store;}
test('memory is isolated by both account and environment, including local environment',async t=>{
 const store=await fixture(t);await store.change(a,'create',entry());const [item]=store.list(a);
 for(const scope of [b,c,{owner:'alice',environmentId:null}]){assert.deepEqual(store.list(scope),[]);await assert.rejects(store.change(scope,'update',{...item,content:'wrong scope'}),/不属于当前环境/);await assert.rejects(store.change(scope,'delete',{id:item.id}),/不属于当前环境/);}
 assert.throws(()=>store.list({owner:null}),/登录/);assert.equal(store.list(a)[0].content,entry().content);
});
test('concurrent changes persist atomically and return detached objects',async t=>{
 const store=await fixture(t);await Promise.all(Array.from({length:12},(_,i)=>store.change(a,'create',entry('约定'+i))));
 const reloaded=new MemoryStore({file:store.file});await reloaded.load();assert.equal(reloaded.list(a).length,12);
 const copy=store.list(a);copy[0].content='external mutation';assert.notEqual(store.list(a)[0].content,copy[0].content);
 const [item]=store.list(a);await store.change(a,'update',{...item,enabled:false});await store.change(a,'delete',{id:item.id});assert.equal(store.list(a).length,11);
});
test('save failure preserves published state and queued changes recover',async t=>{
 let fail=false;const store=await fixture(t,{encrypt:value=>{if(fail)throw Error('encryption unavailable');return Buffer.from(value);},decrypt:value=>value.toString()});
 await store.change(a,'create',entry());const saved=await readFile(store.file);fail=true;await assert.rejects(store.change(a,'create',entry('fail')),/encryption/);assert.equal(store.list(a).length,1);assert.deepEqual(await readFile(store.file),saved);
 fail=false;await store.change(a,'create',entry('recover'));assert.equal(store.list(a).length,2);
});
test('corrupt storage is retained and cannot be silently overwritten',async t=>{
 const store=await fixture(t);await writeFile(store.file,'corrupt');const next=new MemoryStore({file:store.file});await assert.rejects(next.load(),/原文件已保留/);await assert.rejects(next.change(a,'create',entry()),/尚未就绪/);assert.equal(await readFile(store.file,'utf8'),'corrupt');
});
test('validates input while allowing a large library with bounded recall',async t=>{
 const store=await fixture(t);for(const value of [{...entry(),title:''},{...entry(),content:'x'.repeat(4001)},{...entry(),enabled:'yes'}])await assert.rejects(store.change(a,'create',value));
 for(let i=0;i<5;i++)await store.change(a,'create',{...entry(),content:'x'.repeat(4000)});
 await store.change(a,'create',{...entry(),content:'x'.repeat(4000)});assert.equal(store.list(a).length,6);assert.ok(JSON.stringify(store.recall(a,'x')).length<7000);
 await store.change(a,'create',{...entry(),enabled:false,content:'x'.repeat(4000)});assert.equal(store.list(a).length,7);
});
test('runtime snapshots include only enabled memory and preserve images and caller input',async t=>{
 const store=await fixture(t);await store.change(a,'create',entry());await store.change(b,'create',entry('production secret'));await store.change(a,'create',{...entry('disabled secret'),enabled:false});
 const original={text:'question',images:[{dataURL:'image'}],documents:[{name:'file'}]};const result=withMemory(original,store.list(a));assert.deepEqual(result.images,original.images);assert.deepEqual(result.documents,original.documents);assert.equal(original.text,'question');assert.match(result.text,/请使用中文回复/);assert.doesNotMatch(result.text,/production secret|disabled secret/);assert.ok(result.text.endsWith('question'));
 const item=store.list(a)[0];await store.change(a,'update',{...item,enabled:false});const empty=withMemory('next turn',store.list(a));assert.match(empty,/\[\]/);assert.doesNotMatch(empty,/请使用中文回复/);
});
