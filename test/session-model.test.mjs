import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
test('model switch persists current conversation, permits in-flight request and rejects unknown or other conversations',async()=>{
 let handler,saved=0;const item={id:'a',engine:'deepseek',environmentId:'env',model:'one',codexSessionId:'context'};
 const context=vm.createContext({ipcMain:{handle:(_,fn)=>handler=fn},guarded:fn=>fn,accountChanging:false,containerOperation:false,chatNetworkChanging:false,aiSessions:new Map([['a',item]]),activeAISessionId:'a',activeContainerId:'env',runtimeOwner:'owner',account:{user:{id:'owner'}},registeredRuntimes:{runtimes:[{id:'deepseek',models:[{model:'one'},{model:'two'}]}]},codexModel:'one',run:{},persistAISessions:async()=>saved++});
 vm.runInContext(source.slice(source.indexOf("ipcMain.handle('workspace:sessionModel'"),source.indexOf("ipcMain.handle('workspace:sessionNetwork'")),context);
 await handler('a','two');assert.equal(item.model,'two');assert.equal(item.codexSessionId,'context');assert.equal(saved,1);assert.equal(context.codexModel,'two');
 await assert.rejects(handler('a','unknown'),/不支持/);await assert.rejects(handler('b','two'),/环境已变化/);
 context.runtimeOwner='other';await assert.rejects(handler('a','one'),/环境已变化/);assert.equal(item.model,'two');
});
