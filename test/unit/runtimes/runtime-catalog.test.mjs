import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DockerEnvironments} from '../../../src/features/environments/docker-environments.mjs';
import {RUNTIME_CATALOG,supportsChat} from '../../../src/features/runtimes/runtime-install-config.mjs';
import {removeCLIRuntime} from '../../../src/features/runtimes/runtime-removal.mjs';

test('new CLI detection handles partial availability without attributing another brand',async()=>{
 const manager=new DockerEnvironments({sourceRoot:process.cwd()});
 const result=await manager.detectCommands(async([command])=>{if(['kimi','qwen','kiro-cli','ve'].includes(command))return command+' 1.0';throw new Error('not installed');});
 assert.deepEqual(result.runtimes.map(item=>[item.id,item.name]),[['kimi','Kimi'],['qwen','Qwen'],['kiro','Kiro'],['doubao','Doubao']]);
 for(const item of result.runtimes)assert.equal(supportsChat(item.id),false);
});
test('install verifies the CLI before persisting metadata and keeps the requested Doubao command',async()=>{
 for(const engine of ['kimi','qwen','kiro','doubao']){
  const manager=new DockerEnvironments({sourceRoot:process.cwd()}),item={},commands=[];
  manager.get=async()=>({item});manager.update=async(owner,id,patch)=>Object.assign(item,typeof patch==='function'?patch(item):patch);
  manager.runRuntimeInstaller=async(owner,id,args)=>commands.push(args);
  manager.exec=async(owner,id,args)=>{assert.deepEqual(args,[RUNTIME_CATALOG[engine].command,'--version']);throw new Error('binary missing');};
  manager.runtimeInfo=async()=>({runtimes:[{id:engine,...item.runtimeMetadata[engine]}]});
  await assert.rejects(manager.installRuntime('owner','container',engine,{name:'Custom',description:'Description'}),/binary missing/);
  assert.equal(item.runtimeMetadata,undefined);
  manager.exec=async()=> '1.0';const result=await manager.installRuntime('owner','container',engine,{name:'Custom',description:'Description'});
  assert.equal(result.runtimes[0].name,'Custom');assert.ok(result.runtimes[0].addedAt);
  if(engine==='doubao')assert.equal(commands[0].at(-1),'npx -y @volcengine/skills-setup@latest');
  await assert.rejects(manager.installRuntime('owner','container','toString'),/未知/);
 }
});
test('new npm runtime removal targets only its owning package; Kiro keeps credentials',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'dingtu-new-runtime-'));
 try{
  const root=path.join(home,'node_modules');
  for(const [id,pkg] of [['kimi','@moonshot-ai/kimi-code'],['qwen','@qwen-code/qwen-code'],['doubao','@volcengine/cli']]){
   const executable=path.join(root,pkg,'bin/cli.js');await mkdir(path.dirname(executable),{recursive:true});await writeFile(executable,'fixture');const calls=[];
   await removeCLIRuntime(id,{home,executable,execute:async(command,args)=>{calls.push(args);return {stdout:args[0]==='root'?root:''};}});
   assert.deepEqual(calls.at(-1),['uninstall','-g',pkg]);
  }
  await mkdir(path.join(home,'.local/bin'),{recursive:true});await mkdir(path.join(home,'.kiro'),{recursive:true});
  const executable=path.join(home,'.local/bin/kiro-cli');await writeFile(executable,'fixture');await writeFile(path.join(home,'.local/bin/kiro-cli-chat'),'fixture');await writeFile(path.join(home,'.kiro/auth'),'fixture');
  await removeCLIRuntime('kiro',{home,executable});await assert.rejects(access(executable));await access(path.join(home,'.kiro/auth'));
 }finally{await rm(home,{recursive:true,force:true});}
});
