import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,writeFile,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {ChatRuns} from '../../../src/features/chat/chat-runs.mjs';
import {insightView} from '../../../src/features/chat/chat-insights.mjs';
import {undoTurnChanges} from '../../../src/features/chat/turn-change-undo.mjs';
const source=await readFile(new URL('../../../src/app/main.mjs',import.meta.url),'utf8');
const scopeFunction=source.slice(source.indexOf('function insightSession('),source.indexOf('const chatPopouts='));
const handler=source.slice(source.indexOf("ipcMain.handle('workspace:chatUndo'"),source.indexOf("ipcMain.handle('workspace:chatArtifact'"));
async function fixture(run){
 const temporary=await mkdtemp(path.join(tmpdir(),'chat-undo-handler-')),root=await realpath(temporary),file=path.join(root,'file.txt');
 await writeFile(file,'after');
 const metadata={id:'turn',owner:'owner',environmentId:null,chatId:'chat',project:root};
 const item={id:'chat',engine:'deepseek',environmentId:null,fileChangeTurn:metadata,fileChangeTurns:[metadata],artifacts:[{id:'receipt',turnId:'turn',path:file,before:'before',after:'after',beforeExists:true,afterExists:true}]};
 const context={account:{user:{id:'owner'}},activeContainerId:null,accountChanging:false,containerOperation:false,chatGeneration:1,aiSessions:new Map([['chat',item]]),chatViews:[],learningAutomations:{running:new Map()},runs:new ChatRuns(),dockerOwner:()=> 'owner',randomUUID:()=> 'undo-request',insightView,undoTurnChanges,persisted:0,async persistAISessions(){context.persisted++;},ipcMain:{handle(_name,fn){context.handler=fn;}},guarded:fn=>fn};
 vm.createContext(context);vm.runInContext(scopeFunction+handler.replaceAll('import.meta.url',JSON.stringify(new URL('../../../src/app/main.mjs',import.meta.url).href)),context);
 try{await run({context,item,file,scope:{owner:'owner',environmentId:null,chatId:'chat',turnId:'turn'}});}finally{await rm(temporary,{recursive:true,force:true});}
}
test('undo IPC uses server receipts, persists completion, and never accepts client file plans',()=>fixture(async({context,item,file,scope})=>{
 const result=await context.handler({...scope,files:[{path:'/not-an-authorized-file',before:'injected'}]});
 assert.equal(result.ok,true);assert.equal(await readFile(file,'utf8'),'before');assert(item.fileChangeTurn.revertedAt);assert.equal(context.persisted,1);assert.equal(context.runs.size,0);assert.equal(context.containerOperation,false);
 const view=insightView(item,[],scope);assert.equal(view.conversationChanges,null);assert.equal(view.changeHistory[0].undo.available,false);
 await assert.rejects(context.handler(scope),/已撤销/);
}));
test('undo IPC rejects another account, environment, unknown turn, and active runs without touching files',()=>fixture(async({context,file,scope})=>{
 for(const bad of [{owner:'other'},{environmentId:'other'},{turnId:'other'}])await assert.rejects(context.handler({...scope,...bad}));
 const task=context.runs.begin('other',{requestId:'running'});await assert.rejects(context.handler(scope),/正在执行/);context.runs.finish(task);
 assert.equal(await readFile(file,'utf8'),'after');assert.equal(context.persisted,0);
}));
test('undo IPC preserves later edits and missing snapshot metadata; failures release the operation gate',()=>fixture(async({context,item,file,scope})=>{
 delete item.artifacts[0].beforeExists;await assert.rejects(context.handler(scope),/快照/);item.artifacts[0].beforeExists=true;
 await writeFile(file,'external');await assert.rejects(context.handler(scope),/后续修改/);assert.equal(await readFile(file,'utf8'),'external');assert.equal(context.containerOperation,false);assert.equal(context.runs.size,0);assert.equal(context.persisted,0);
}));
test('undo IPC preserves recovery paths and disables retry after incomplete compensation',()=>fixture(async({context,item,scope})=>{
 context.undoTurnChanges=async()=>({ok:false,message:'写入失败',backups:[{path:'file.txt',backup:'/project/.kuneco-undo-test.backup'}],recovery:[{path:'file.txt',backup:'/project/.kuneco-undo-test.backup',message:'conflict'}],rollback:{conflicts:['file.txt'],errors:[]}});
 await assert.rejects(context.handler(scope),/人工检查[\s\S]*\.kuneco-undo-test.backup/);
 assert.equal(item.fileChangeTurn.undoBackups.length,1);assert(item.fileChangeTurn.undoFailure);assert.equal(context.persisted,1);
 assert.equal(insightView(item,[],scope).changeHistory[0].undo.available,false);assert.equal(context.runs.size,0);assert.equal(context.containerOperation,false);
}));
