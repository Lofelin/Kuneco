import {withMemory} from '../../../src/features/memory/memory-store.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {ChatRuns} from '../../../src/features/chat/chat-runs.mjs';
import {stageCodexDocuments,originalDocumentPrompt} from '../../../src/features/runtimes/codex-documents.mjs';
import {observeRuntimeLaunch} from '../../../src/features/environments/environment-events.mjs';
import {normalizeDocuments,documentPrompt} from '../../../src/features/chat/document-attachments.mjs';
const source=await readFile(new URL('../../../src/app/main.mjs',import.meta.url),'utf8');
function harness(){
 const handlers={},events=[],diagnostics=[],executions=new Map(),runs=new ChatRuns();
 const sessions=new Map(['a','b'].map(id=>[id,{id,environmentId:'env',engine:'deepseek',model:'model-'+id,project:'/workspace/'+id,networkMode:'direct'}]));
 // Use real launch/document adapters; journal persistence stays outside this IPC fixture.
 const context=vm.createContext({withMemory,memoryService:null,memoryLibrary:{sync:async scope=>{assert.equal(scope.owner,'owner');assert.equal(scope.environmentId,'env');},recallAsync:async scope=>{assert.equal(scope.owner,'owner');assert.equal(scope.environmentId,'env');return [{title:'共享约定',content:'请使用中文',enabled:true}];}},stageCodexDocuments,originalDocumentPrompt,observeRuntimeLaunch,environmentEvents:null,recordEnvironmentEvent(...entry){diagnostics.push(entry);},normalizeDocuments,documentPrompt,createBrowserAgentTool:()=>({}),browserFeatures:{},browserTabs:new Map(),activeTabId:null,createBrowserTab(){},navigateBrowserTab(){},browserNetworkReady:()=>true,usageDetails:()=>({}),console,AbortController,Promise,randomUUID:()=>Math.random().toString(),runs,aiSessions:sessions,activeAISessionId:'a',activeContainerId:'env',chatGeneration:1,chatOwner:'owner',account:{user:{id:'owner'}},accountChanging:false,containerOperation:false,chatNetworkChanging:false,runtimeOwner:'owner',registeredRuntimes:{runtimes:[{id:'deepseek'},{id:'codex'}]},environmentStatus:{passed:false,reasons:['system language reminder']},gateway:null,sessionId:undefined,codexSessionId:undefined,codexModel:null,project:'',selectedEngine:'deepseek',chatViews:[],
  ipcMain:{handle:(name,fn)=>handlers[name]=fn},guarded:fn=>fn,normalizeDeepSeekInput:p=>({text:p,images:[]}),normalizeCodexInput:p=>({text:p,images:[]}),requireActiveEnvironment(){},repairSessionModel:async()=>{},chatNetworkMode:c=>c.networkMode,chatRequestRoute:c=>c.networkMode,containerAuth:async()=>({state:'signed-in'}),dockerOwner:()=> 'owner',dockerEnvs:{syncDeepSeekSource:async()=>{},directChatSpawner:async()=>()=>{}},createDirectChatSpawner:()=>()=>{},persistAISessions(){},totalUsageTokens:()=>1,emit:(type,data,meta)=>events.push({type,data,...meta}),
  runDeepSeek:options=>new Promise(resolve=>{executions.set(options.sessionId,{options,finish:resolve});options.signal.addEventListener('abort',()=>resolve({total_tokens:1}));})
 });
 vm.runInContext(source.slice(source.indexOf("ipcMain.handle('workspace:cc'"),source.indexOf('// Only read the installed CLI')),context);
 return {handlers,events,diagnostics,executions,runs,sessions,context};
}
test('two actual IPC sends overlap, keep session/model identity, cancel independently and emit tagged events',async()=>{
 const h=harness(),send=h.handlers['workspace:cc'];
 await Promise.all([send('first',undefined,'a','r-a'),send('second',undefined,'b','r-b')]);
 assert.match(h.executions.get('a').options.prompt.text,/请使用中文/);assert.match(h.executions.get('b').options.prompt.text,/请使用中文/);assert.equal(h.runs.size,2);assert.equal(h.executions.get('a').options.model,'model-a');assert.equal(h.executions.get('b').options.model,'model-b');
 h.context.activeAISessionId='b';h.executions.get('a').options.onText('only a');h.executions.get('b').options.onText('only b');
 assert.deepEqual(h.events.filter(e=>e.type==='ccText').map(e=>[e.chatId,e.requestId,e.data]),[['a','r-a','only a'],['b','r-b','only b']]);
 await assert.rejects(send('duplicate',undefined,'b','r-new'),/正在处理/);
 const b=h.runs.get('b');await h.runs.abortWhere(task=>task.chatId==='a');assert.equal(b.signal.aborted,false);assert.equal(h.runs.has('b'),true);
 h.executions.get('b').finish({total_tokens:2});await b.finished;assert.equal(h.runs.size,0);
 assert.deepEqual(h.events.filter(e=>e.type==='ccEnd').map(e=>e.chatId),['a','b']);
 assert.deepEqual(h.diagnostics,[],'Successful preparation must not emit startup errors');
});
test('preflight is reserved per conversation and cancellation during preflight cannot start a runner',async()=>{
 const h=harness();let release;h.context.repairSessionModel=()=>new Promise(r=>release=r);
 const first=h.handlers['workspace:cc']('first',undefined,'a','r-a');await assert.rejects(h.handlers['workspace:cc']('duplicate',undefined,'a','r-dup'),/正在处理/);
 const stopped=h.runs.abortWhere();release();await assert.rejects(first,/变化/);await stopped;assert.equal(h.executions.size,0);assert.equal(h.runs.size,0);
});
test('proxy failure cancels only proxy tasks and lifecycle shutdown cancels all remaining tasks',async()=>{
 const runs=new ChatRuns(),a=runs.begin('a',{networkMode:'proxy'}),b=runs.begin('b',{networkMode:'direct'});
 for(const task of [a,b])task.signal.addEventListener('abort',()=>runs.finish(task));
 await runs.abortWhere(task=>task.networkMode!=='direct');assert.equal(a.signal.aborted,true);assert.equal(b.signal.aborted,false);assert.equal(runs.size,1);
 await runs.abortWhere();assert.equal(b.signal.aborted,true);assert.equal(runs.size,0);
});
test('Codex native history IDs and emitted replacements stay with their owning conversation',async()=>{
 const h=harness();for(const item of h.sessions.values()){item.engine='codex';item.codexSessionId='native-'+item.id;}
 h.context.codexSessionId='native-b';h.context.activeAISessionId='b';
 h.context.runCodex=options=>new Promise(resolve=>h.executions.set(options.sessionId,{options,finish:resolve}));
 await Promise.all([h.handlers['workspace:cc']('A',undefined,'a','ra'),h.handlers['workspace:cc']('B',undefined,'b','rb')]);
 const a=h.executions.get('native-a'),b=h.executions.get('native-b');assert.ok(a&&b,JSON.stringify(h.events.filter(e=>e.type==='ccError')));assert.match(a.options.prompt,/请使用中文/);assert.match(b.options.prompt,/请使用中文/);assert.equal(a.options.project,'/workspace/a');assert.equal(b.options.project,'/workspace/b');
 a.options.onEvent('session','next-a');assert.equal(h.context.codexSessionId,'native-b');b.options.onEvent('session','next-b');assert.equal(h.context.codexSessionId,'next-b');
 assert.equal(h.sessions.get('a').codexSessionId,'next-a');assert.equal(h.sessions.get('b').codexSessionId,'next-b');const done=[...h.runs.values()].map(r=>r.finished);a.finish();b.finish();await Promise.all(done);
 assert.deepEqual(h.events.filter(e=>e.type==='ccError'),[]);assert.deepEqual(h.diagnostics,[]);
});
test('Claude IPC supplies the same scoped snapshot while preserving resumed conversation identity',async()=>{
 const h=harness(),schema={optional(){return this;}};
 for(const item of h.sessions.values()){item.engine='cc';item.sessionId='native-'+item.id;}
 Object.assign(h.context,{createBrowserAgentTool:()=>({definition:{description:"fixture"}}),process,chatRuntimeEnvironment:value=>value,directChatEnvironment:value=>value,registeredRuntimes:{runtimes:[{id:'cc'}]},claudePath:'claude',path:{join:(...parts)=>parts.join('/')},here:'/app',readFile:async()=>'',createFileChangeHooks:()=>({}),createSdkMcpServer:value=>value,tool:()=>({}),z:{string:()=>schema,record:()=>schema,unknown:()=>schema,number:()=>schema},createClaudeActivityAdapter:()=>()=>[]});
 h.context.query=async function*(options){const input=await options.prompt[Symbol.asyncIterator]().next();h.executions.set(options.options.resume,input.value.message.content);yield {type:'result',session_id:options.options.resume,is_error:false};};
 await h.handlers['workspace:cc']('Claude task',undefined,'a','claude-a');await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(h.events.filter(e=>e.type==='ccError'),[]);assert.match(h.executions.get('native-a'),/请使用中文/);assert.ok(h.executions.get('native-a').endsWith('Claude task'));assert.deepEqual(h.events.filter(e=>e.type==='ccError'),[]);
});
test('completed IPC turns enqueue original user text and source metadata, while cancelled turns do not',async()=>{
 const h=harness(),recorded=[];h.context.memoryService={recordTurn:async(scope,source)=>recorded.push({scope,source})};
 await h.handlers['workspace:cc']('remember this preference',undefined,'a','source-request');h.executions.get('a').options.onText('finished answer');const finished=h.runs.get('a').finished;h.executions.get('a').finish({total_tokens:1});await finished;
 assert.equal(recorded.length,1);assert.equal(recorded[0].source.userText,'remember this preference');assert.equal(recorded[0].source.assistantText,'finished answer');assert.equal(recorded[0].source.chatId,'a');assert.equal(recorded[0].source.requestId,'source-request');assert.equal(recorded[0].scope.environmentId,'env');
 await h.handlers['workspace:cc']('cancel me',undefined,'b','cancel-request');h.executions.get('b').options.onText('partial');await h.runs.abortWhere(task=>task.chatId==='b');assert.equal(recorded.length,1);
});
