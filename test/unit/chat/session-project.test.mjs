import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../../src/app/main.mjs',import.meta.url),'utf8');
test('changing a conversation directory preserves both runtime histories and persists the new cwd',async()=>{
 let handler,saved;
 const context=vm.createContext({ipcMain:{handle:(_,fn)=>handler=fn},guarded:fn=>fn,runs:new Map(),activeAISessionId:"chat",accountChanging:false,containerOperation:false,account:{user:{id:'owner'}},activeContainerId:'env',chatGeneration:1,dockerEnvs:{},project:'/workspace',sessionId:'claude-history',codexSessionId:'codex-history',sessionSave:Promise.resolve(),selectEnvironmentProject:async()=>'/workspace/file',storeCurrentSession:()=>{saved={project:context.project,sessionId:context.sessionId,codexSessionId:context.codexSessionId};}});
 vm.runInContext(source.slice(source.indexOf("ipcMain.handle('workspace:project'"),source.indexOf("ipcMain.handle('workspace:browserCookies'")),context);
 assert.equal(await handler({mode:'container',path:'/workspace/file'}),'/workspace/file');
 assert.deepEqual(saved,{project:'/workspace/file',sessionId:'claude-history',codexSessionId:'codex-history'});
 context.runs.set("chat",{});await assert.rejects(handler({mode:'container',path:'/workspace'}),/结束当前请求/);
 assert.equal(context.project,'/workspace/file');
});
