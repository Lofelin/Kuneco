import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';
import {MemoryStore,withMemory} from '../../../src/features/memory/memory-store.mjs';
import {MemoryService} from '../../../src/features/memory/memory-service.mjs';
const scope={owner:'alice',environmentId:'dev'};
const input={turnId:'turn-a',chatId:'chat-a',requestId:'request-a',engine:'codex',model:'test-model',project:'/workspace/app',networkMode:'direct',userText:'我的偏好是回答使用中文。以后改为英文，请记住。',assistantText:'明白。'};
const fact=(overrides={})=>({title:'回复语言',content:'回答使用中文',type:'preference',key:'response.language',scope:'environment',keywords:['回答','语言','response','language'],evidence:'我的偏好是回答使用中文',memoryId:null,expectedRevision:null,confidence:.95,...overrides});
async function fixture(t){const dir=await mkdtemp(path.join(tmpdir(),'kuneco-memory-service-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new MemoryStore({file:path.join(dir,'memory.bin')});await store.load();return store;}
async function apply(store,source=input,proposals=[fact()]){const id=await store.enqueue(scope,source);await store.jobState(scope,id,'running');await store.apply(scope,id,proposals);return id;}
test('legacy encrypted payload shape upgrades without rewriting until a successful mutation',async t=>{
 const store=await fixture(t),old=[{...scope,id:'legacy',title:'约定',content:'使用中文',enabled:true,updatedAt:new Date().toISOString()}];await writeFile(store.file,JSON.stringify(old));await store.load();assert.equal(store.list(scope)[0].pinned,true);assert.equal(store.detail(scope,'legacy').history[0].actor,'migration');assert.ok(Array.isArray(JSON.parse(await readFile(store.file))));await store.change(scope,'update',{...store.list(scope)[0],content:'使用英文'});const data=JSON.parse(await readFile(store.file));assert.equal(data.version,2);assert.equal(data.items[0].history.length,2);
});
test('automatic facts deduplicate sources and preserve the old revision on a confirmed correction',async t=>{
 const store=await fixture(t);await apply(store);const first=store.list(scope)[0];assert.equal(first.origin,'automatic');assert.equal(first.sources[0].chatId,'chat-a');assert.equal(first.sources[0].quote,fact().evidence);
 await apply(store,{...input,turnId:'turn-b'},[fact({content:'回答使用中文。',memoryId:first.id,expectedRevision:first.revision})]);assert.equal(store.list(scope).length,1);assert.equal(store.list(scope)[0].sources.length,2);
 const current=store.list(scope)[0];await apply(store,{...input,turnId:'turn-c'},[fact({content:'以后回答使用英文',evidence:'以后改为英文，请记住',memoryId:current.id,expectedRevision:current.revision})]);const updated=store.list(scope)[0];assert.equal(updated.id,first.id);assert.equal(updated.history.length,3);assert.equal(updated.history[0].value.content,'回答使用中文');assert.match(withMemory('language?',store.recall(scope,'language')),/以后回答使用英文/);assert.doesNotMatch(withMemory('language?',store.recall(scope,'language')),/回答使用中文/);
});
test('questions about a recalled value cannot become factual evidence or add duplicate sources',async t=>{
 const store=await fixture(t);await apply(store);const original=store.list(scope)[0];
 for(const [n,question] of ['回答应该使用什么语言？只回答语言，不调用工具。','What language should answers use? Only return the language.'].entries()){
  await apply(store,{...input,turnId:'question-'+n,userText:question},[fact({evidence:question,memoryId:original.id,expectedRevision:original.revision})]);
 }
 assert.equal(store.detail(scope,original.id).sources.length,1);assert.equal(store.detail(scope,original.id).revision,1);
});
test('manual edits and stale revisions become resolvable conflicts instead of silent overwrites',async t=>{
 const store=await fixture(t);await apply(store);const original=store.list(scope)[0];await store.change(scope,'update',{...original,content:'请使用中文和简短段落'});
 await apply(store,{...input,turnId:'conflict'},[fact({content:'以后回答使用英文',evidence:'以后改为英文，请记住',memoryId:original.id,expectedRevision:original.revision})]);const [target,candidate]=store.list(scope);assert.equal(target.content,'请使用中文和简短段落');assert.equal(candidate.status,'conflict');assert.equal(candidate.enabled,false);
 await assert.rejects(store.change(scope,'resolve',{id:candidate.id,revision:candidate.revision,accept:true,targetRevision:1}),/新修订/);
 await store.change(scope,'resolve',{id:candidate.id,revision:candidate.revision,accept:true,targetRevision:target.revision});assert.equal(store.list(scope).length,1);assert.equal(store.list(scope)[0].content,'以后回答使用英文');assert.equal(store.detail(scope,candidate.id).status,'resolved');
});
test('automatic processing cannot revive removed memories, and manual restore retains history',async t=>{
 const store=await fixture(t);await apply(store);const item=store.list(scope)[0];await store.change(scope,'delete',{id:item.id,revision:item.revision});await apply(store,{...input,turnId:'replay'},[fact({memoryId:item.id,expectedRevision:item.revision})]);assert.deepEqual(store.list(scope),[]);assert.equal(store.list(scope,{includeDeleted:true}).length,1);await store.change(scope,'restore',{id:item.id,revision:store.detail(scope,item.id).revision});assert.equal(store.list(scope)[0].history.length,3);
});
test('evidence and scope validation are transactional, and assistant claims cannot become evidence',async t=>{
 const store=await fixture(t);const id=await store.enqueue(scope,input);await store.jobState(scope,id,'running');await assert.rejects(store.apply(scope,id,[fact(),fact({content:'助手说测试通过',evidence:'助手说测试通过'})]),/用户原文证据/);assert.deepEqual(store.list(scope),[]);
 await store.apply(scope,id,[fact()]);const memory=store.list(scope)[0];const other={owner:'bob',environmentId:'dev'};const otherId=await store.enqueue(other,{...input,turnId:'cross'});await store.jobState(other,otherId,'running');await assert.rejects(store.apply(other,otherId,[fact({memoryId:memory.id,expectedRevision:memory.revision})]),/当前范围/);assert.equal(store.list(other).length,0);
});
test('enqueue is idempotent and interrupted extraction resumes after reload without repeating chat',async t=>{
 const store=await fixture(t);const id=await store.enqueue(scope,input);assert.equal(await store.enqueue(scope,input),null);await store.jobState(scope,id,'running');const next=new MemoryStore({file:store.file});await next.load();assert.equal(next.pending(scope).id,id);let calls=0;const service=new MemoryService({store:next,getScope:()=>scope,extract:async()=>{calls++;return {memories:[fact()]};}});await service.tick();await service.tick();assert.equal(calls,1);assert.equal(next.status(scope).jobs[0].status,'completed');assert.equal(await next.enqueue(scope,input),null);assert.equal(next.jobs[0].source.userText,'');
});
test('failed extraction remains visible and retry only repeats extraction; disabling prevents writes',async t=>{
 const store=await fixture(t);let succeed=false,calls=0;const service=new MemoryService({store,getScope:()=>scope,extract:async()=>{calls++;if(!succeed)throw Error('provider failed');return {memories:[fact()]};}});await service.recordTurn(scope,input);await service.tick();assert.equal(store.status(scope).jobs[0].status,'failed');await service.tick();assert.equal(calls,1);succeed=true;await service.retry(scope,store.jobs[0].id);await service.tick();assert.equal(calls,2);assert.equal(store.list(scope).length,1);await store.change(scope,'settings',{automatic:false});assert.equal(await service.recordTurn(scope,{...input,turnId:'off'}),null);
});
test('scope changes abort background extraction and retain a queued job in its original scope',async t=>{
 const store=await fixture(t);let current=scope,started;const start=new Promise(r=>started=r);const service=new MemoryService({store,getScope:()=>current,extract:({signal})=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true});})});await service.recordTurn(scope,input);const running=service.tick();await start;current={owner:'bob',environmentId:'prod'};await running;assert.equal(store.pending(scope).source.turnId,input.turnId);assert.equal(store.list(scope).length,0);assert.equal(store.list(current).length,0);await service.stop();
});
test('recall ranks bilingual keywords, filters project and inactive records, and obeys a hard context budget',async t=>{
 const store=await fixture(t);await apply(store,input,[fact({type:'decision',scope:'project',title:'构建检查',content:'发布前执行 npm run check',key:'release.check',keywords:['发布','build','release','检查']})]);await store.change(scope,'create',{title:'不相关内容',content:'园艺浇水时间',type:'note',enabled:true});await store.change(scope,'create',{title:'固定约定',content:'不记录密码',type:'note',enabled:true,pinned:true});const result=store.recall(scope,'release build',{project:'/workspace/app'});assert.equal(result.length,2);assert.ok(result.some(i=>i.title==='构建检查'));assert.equal(store.recall(scope,'release build',{project:'/different'}).some(i=>i.title==='构建检查'),false);assert.equal(store.recall(scope,'无关问题').some(i=>i.title==='构建检查'),false);assert.ok(JSON.stringify(store.recall(scope,'release',{project:'/workspace/app',budget:200}).map(({id,revision,title,content})=>({id,revision,title,content}))).length<=200);
});
test('historical backfill cannot replace a memory from a newer conversation',async t=>{
 const store=await fixture(t);await apply(store,{...input,at:'2026-10-20T00:00:00Z'});const current=store.list(scope)[0];
 await apply(store,{...input,turnId:'old-history',historical:true,at:'2026-01-01T00:00:00Z'},[fact({content:'旧约定回答使用英文',evidence:'以后改为英文，请记住',memoryId:current.id,expectedRevision:current.revision})]);
 const items=store.list(scope);assert.equal(items.find(i=>i.id===current.id).content,current.content);assert.equal(items.find(i=>i.id!==current.id).status,'conflict');
});
test('production two-stage extraction judges one batch and preserves independent evidence in one turn',async t=>{
 const store=await fixture(t);let calls=0;const service=new MemoryService({store,getScope:()=>scope,extract:async()=>({memories:[fact(),fact({content:'回答使用中文。',evidence:'以后改为英文，请记住'})]}),judge:async({schema})=>{calls++;assert.ok(schema.properties.decisions);return {decisions:[{index:0,action:'store',memoryId:null,expectedRevision:null,batchIndex:null},{index:1,action:'merge',memoryId:null,expectedRevision:null,batchIndex:0}]};}});await service.recordTurn(scope,input);await service.tick();assert.equal(calls,1);assert.equal(store.list(scope).length,1);assert.equal(store.list(scope)[0].sources.length,2);assert.equal(store.status(scope).jobs[0].status,'completed');
});
test('invalid original evidence is rejected before batch judge and no partial records are saved',async t=>{
 const store=await fixture(t);let called=false;const service=new MemoryService({store,getScope:()=>scope,extract:async()=>({memories:[fact(),fact({evidence:'助手虚构用户从未说过的约定'})]}),judge:async()=>{called=true;}});await service.recordTurn(scope,input);await service.tick();assert.equal(called,false);assert.equal(store.list(scope).length,0);assert.equal(store.status(scope).jobs[0].status,'failed');
});
test('historical paraphrases cannot revive a tombstoned specifically named topic with a different key',async t=>{
 const store=await fixture(t);const title='长期回复语言与格式约定';await apply(store,input,[fact({title})]);const prior=store.list(scope)[0];await store.change(scope,'delete',{id:prior.id,revision:prior.revision});await apply(store,{...input,turnId:'replay-title',historical:true},[fact({title,content:'以后回答使用英文',evidence:'以后改为英文，请记住',key:'renamed.language'})]);assert.equal(store.list(scope).length,0);assert.equal(store.list(scope,{includeDeleted:true}).filter(i=>i.status==='deleted').length,1);
});
