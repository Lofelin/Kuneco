import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {removeCLIRuntime} from '../../../src/features/runtimes/runtime-removal.mjs';
import {DockerEnvironments} from '../../../src/features/environments/docker-environments.mjs';

test('native CLI uninstall removes only its executable and versions, preserving auth and chats',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'dingtu-remove-'));
 try{
  await mkdir(path.join(home,'.local/bin'),{recursive:true});await mkdir(path.join(home,'.local/share/claude/versions'),{recursive:true});await mkdir(path.join(home,'.claude'),{recursive:true});
  const target=path.join(home,'.local/share/claude/versions/fixture');await writeFile(target,'fixture');await writeFile(path.join(home,'.claude/history.jsonl'),'history');
  const executable=path.join(home,'.local/bin/claude');await symlink(target,executable);
  await removeCLIRuntime('cc',{home,executable});await assert.rejects(access(executable));await access(path.join(home,'.claude/history.jsonl'));
 }finally{await rm(home,{recursive:true,force:true});}
});
test('npm uninstall is restricted to the detected package and unknown installations are untouched',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'dingtu-remove-'));
 try{
  const root=path.join(home,'node_modules'),executable=path.join(root,'@openai/codex/bin/codex.js');await mkdir(path.dirname(executable),{recursive:true});await writeFile(executable,'fixture');const calls=[];
  const execute=async(command,args)=>{calls.push([command,args]);return {stdout:args[0]==='root'?root:''};};
  await removeCLIRuntime('codex',{home,executable,execute});assert.deepEqual(calls.at(-1),['npm',['uninstall','-g','@openai/codex']]);
  const unknown=path.join(home,'unknown');await writeFile(unknown,'fixture');await assert.rejects(removeCLIRuntime('codex',{home,executable:unknown,execute}),/无法识别/);await access(unknown);
  await assert.rejects(removeCLIRuntime('unexpected',{home,executable,execute}),/未知/);
 }finally{await rm(home,{recursive:true,force:true});}
});
function managerFixture(){
 const manager=new DockerEnvironments({directory:'/unused',sourceRoot:path.resolve('.')});const item={runtimeMetadata:{deepseek:{name:'DeepSeek'},codex:{name:'Codex'}}};const calls=[];
 manager.get=async()=>({item});manager.exec=async(owner,id,args)=>{assert.equal(owner,'owner');assert.equal(id,'environment');calls.push(args);};manager.update=async(owner,id,patch)=>Object.assign(item,typeof patch==='function'?patch(item):patch);manager.runtimeInfo=async()=>({runtimes:[{id:'codex'}]});return {manager,item,calls};
}
test('API runtime removal deletes only credentials and its metadata after detection confirms removal',async()=>{
 const {manager,item,calls}=managerFixture();await manager.removeRuntime('owner','environment','deepseek');
 assert.match(calls[0][2],/credentials.json/);assert.ok(!calls[0][2].includes('recursive'));assert.equal(item.runtimeMetadata.deepseek,undefined);assert.equal(item.runtimeMetadata.codex.name,'Codex');
});
test('removal failures, remaining installations and external containers do not discard metadata',async()=>{
 const {manager,item,calls}=managerFixture();manager.exec=async()=>{throw new Error('fixture failure');};await assert.rejects(manager.removeRuntime('owner','environment','deepseek'),/fixture failure/);assert.ok(item.runtimeMetadata.deepseek);
 manager.exec=async()=>{};manager.runtimeInfo=async()=>({runtimes:[{id:'deepseek'}]});await assert.rejects(manager.removeRuntime('owner','environment','deepseek'),/仍检测/);assert.ok(item.runtimeMetadata.deepseek);
 item.external={id:'external'};await assert.rejects(manager.removeRuntime('owner','environment','deepseek'),/原容器/);assert.equal(calls.length,0);
});
test('CLI container removal uses the scoped installer, verifies absence and preserves other metadata',async()=>{
 const {manager,item}=managerFixture();let invocation;manager.runRuntimeInstaller=async(owner,id,args)=>{assert.equal(id,'environment');invocation=args;};manager.runtimeInfo=async()=>({runtimes:[{id:'deepseek'}]});
 await manager.removeRuntime('owner','environment','codex');assert.match(invocation.at(-1),/await removeCLIRuntime\("codex"\)/);assert.equal(item.runtimeMetadata.codex,undefined);assert.ok(item.runtimeMetadata.deepseek);
});
