import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
test('session selection waiting for model repair cannot activate old chat after account switch',async()=>{
 let select,finish,activated=false;const item={id:'A-chat',environmentId:null,engine:'cc'};
 const context=vm.createContext({ipcMain:{handle:(name,fn)=>{if(name==='workspace:selectSession')select=fn}},guarded:fn=>fn,chatGeneration:1,accountChanging:false,containerOperation:false,chatNetworkChanging:false,run:null,activeContainerId:null,aiSessions:new Map([['A-chat',item]]),storeCurrentSession:()=>{},repairSessionModel:()=>new Promise(resolve=>finish=resolve),activateAISession:()=>activated=true});
 vm.runInContext(source.slice(source.indexOf("ipcMain.handle('workspace:selectSession'"),source.indexOf("ipcMain.handle('workspace:engine'")),context);
 const selecting=select('A-chat');context.chatGeneration++;context.aiSessions=new Map([['B-chat',{id:'B-chat'}]]);finish();await assert.rejects(selecting,/对话账号或环境已变化/);assert.equal(activated,false);assert.equal(context.aiSessions.has('A-chat'),false);
 context.accountChanging=true;await assert.rejects(select('B-chat'),/正在处理/);
});
