import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {buildMemoryHierarchy} from '../../../src/features/memory/memory-hierarchy.mjs';
import {rankMemoryCandidates,selectRecalledMemories} from '../../../src/features/memory/memory-search.mjs';
import {MemoryRetriever} from '../../../src/features/memory/memory-retriever.mjs';
import {deduplicateMemoryBatch} from '../../../src/features/memory/memory-batch-dedup.mjs';
const atom=(id,extra={})=>({id,revision:1,owner:'a',environmentId:'e',title:'中文约定',content:'发布简报使用中文。',type:'fact',status:'active',enabled:true,project:null,createdAt:'2026-01-01',updatedAt:'2026-01-01',sources:[],...extra});
const proposal=(content='使用中文简报')=>({title:'语言约定',content,key:'language',scope:'environment',keywords:[],evidence:'请使用中文简报。',confidence:.99});
const decision=(index,action,other={})=>({index,action,memoryId:null,expectedRevision:null,batchIndex:null,...other});
test('hierarchy derives explicit scenes and stable preferences; edits and removal invalidate references',()=>{
 const a=atom('a',{scene:'发布',type:'preference',sources:[{jobId:'1',turnId:'1',quote:'中文'},{jobId:'2',turnId:'2',quote:'中文'}]}),b=atom('b',{scene:'发布',content:'固定周五发送。'}),c=atom('c',{project:'private',scene:'发布'});
 const h=buildMemoryHierarchy([a,b,c]);assert.equal(h.L0.length,2);assert.equal(h.L1.length,2);assert.equal(h.L2.length,1);assert.equal(h.L3.length,1);assert.equal(h.L2[0].memberRefs.length,2);assert.match(h.L2[0].content,/周五/);
 const updated=buildMemoryHierarchy([{...a,revision:2},b]);assert.notEqual(h.L2[0].revision,updated.L2[0].revision);
 const deleted=buildMemoryHierarchy([{...a,status:'deleted'},b]);assert.equal(deleted.L2.length,0);assert.equal(deleted.L3.length,0);assert.equal(deleted.L0.length,0);
 assert.equal(buildMemoryHierarchy([atom('single',{type:'preference',sources:[{turnId:'one'}]})]).L3.length,0);
});
test('RRF combines independent keyword and semantic ranks and excludes disabled/private memories',()=>{
 const a=atom('a'),b=atom('b',{title:'Briefing',content:'English release summary'}),c=atom('c',{enabled:false});
 const ranked=rankMemoryCandidates([a,b,c],'中文',{queryVector:[1,0],vectors:new Map([['a',[1,0]],['b',[.9,.1]],['c',[1,0]]])});assert.equal(ranked[0].item.id,'a');assert.equal(ranked[0].score,2/61);assert.equal(ranked[1].item.id,'b');assert.equal(ranked[1].keyword,0);assert.ok(ranked[1].semantic>.5);
 const derived=atom('scene',{memberRefs:[{id:'a',revision:1}]});assert.equal(selectRecalledMemories([{item:derived,matched:true},{item:a,matched:true}]).length,1);
 assert.deepEqual(selectRecalledMemories(ranked,{budget:5}),[]);
});
test('local retriever caches isolated 384-dimensional vectors and reports deadline fallback',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'memory-hybrid-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;const vector=[1,...Array(383).fill(0)],embeddings={ready:true,status:()=>({ready:true}),encode:async texts=>{calls++;return texts.map(()=>vector);},close:async()=>{}};
 const retriever=new MemoryRetriever({embeddings,file:path.join(dir,'index')});const args={scope:{owner:'a',environmentId:'e'},mode:'local',items:[atom('x')],query:'unrelated English query'};assert.equal((await retriever.recall(args))[0].id,'x');assert.equal(retriever.status(args.scope,'local').strategy,'hybrid');const n=calls;await retriever.recall(args);assert.equal(calls,n+1);await retriever.recall({...args,mode:'remote'});assert.equal(calls,n+3);
 embeddings.encode=async()=>new Promise(resolve=>setTimeout(()=>resolve([vector]),20));await retriever.recall({...args,options:{timeout:1}});assert.equal(retriever.status(args.scope,'local').reason,'semantic_timeout');await retriever.close();
});
test('one batch decision merges synonyms, updates aliases, and rejects foreign revision references',async()=>{
 let calls=0;const old=atom('old',{key:'language'}),proposals=[proposal(),proposal('简报用汉语'),proposal('改为英文简报')];
 const result=await deduplicateMemoryBatch({proposals,pools:[[old],[],[]],judge:async()=>{calls++;return {decisions:[decision(0,'merge',{memoryId:'old',expectedRevision:1}),decision(1,'merge',{batchIndex:0}),decision(2,'update',{batchIndex:1})]};}});assert.equal(calls,1);assert.equal(result.length,1);assert.equal(result[0].memoryId,'old');assert.equal(result[0].content,'改为英文简报');
 await assert.rejects(deduplicateMemoryBatch({proposals:[proposal()],pools:[[old]],judge:async()=>({decisions:[decision(0,'update',{memoryId:'old',expectedRevision:2})]})}),/版本/);
 assert.deepEqual(await deduplicateMemoryBatch({proposals:[proposal(old.content)],pools:[[{...old,status:'deleted'}]],judge:()=>{throw Error('unneeded');}}),[]);
});
test('unbound conversations constrain extraction schema to environment rather than inventing project scope',async()=>{
 const {extractionSchema,extractionPrompt}=await import('../../../src/features/memory/memory-extraction.mjs');const job={source:{project:null,userText:'某项目使用中文',assistantText:''}};assert.deepEqual(extractionSchema(job).properties.memories.items.properties.scope.enum,['environment']);assert.match(extractionPrompt(job,[]),/禁止输出 scope=project/);assert.deepEqual(extractionSchema({source:{project:'/workspace/app'}}).properties.memories.items.properties.scope.enum,['environment','project']);
});
test('temporary acceptance evidence is excluded without dropping genuine enduring business decisions',async()=>{
 const {temporaryMemoryEvidence}=await import('../../../src/features/memory/memory-extraction.mjs');assert.equal(temporaryMemoryEvidence('后续仍须记住口令 TEST-123','自动压缩实机验收。请记住验收口令 TEST-123。后续仍须记住口令 TEST-123'),true);assert.equal(temporaryMemoryEvidence('请实际调用 Write 工具，在当前验收项目创建页面。'),true);assert.equal(temporaryMemoryEvidence('请实际调用技能 kuneco-check 执行检查。'),true);assert.equal(temporaryMemoryEvidence('项目验收之后，每次发版简报固定周四发送。'),false);assert.equal(temporaryMemoryEvidence('以后每次执行技能都先检查可用工具。'),false);
});
test('a fresh single candidate still receives durability judgment',async()=>{
 let calls=0;const result=await deduplicateMemoryBatch({proposals:[proposal()],pools:[[]],judge:async()=>{calls++;return {decisions:[decision(0,'skip')]};}});assert.equal(calls,1);assert.deepEqual(result,[]);
});
