import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DockerEnvironments} from '../src/docker-environments.mjs';
test('environment rename persists per owner, preserves resources and rejects empty names',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-rename-'));
 try{
  const manager=new DockerEnvironments({directory,encrypt:Buffer.from,decrypt:value=>value.toString()});
  const original={id:'env',name:'Initial',proxy:{host:'fixture'},registry:{runtimes:[{id:'cc'}]},external:{id:'container'},icon:'trees'};
  await manager.save('A',{activeId:'env',localEnabled:true,localName:'Local',environments:[original]});await manager.save('B',{activeId:'env',environments:[{id:'env',name:'B'}]});
  await manager.renameEnvironment('A','env','  Development  ');let saved=await manager.load('A');assert.equal(saved.environments[0].name,'Development');assert.equal(saved.activeId,'env');assert.deepEqual(saved.environments[0].proxy,original.proxy);assert.deepEqual(saved.environments[0].registry,original.registry);assert.deepEqual(saved.environments[0].external,original.external);assert.equal((await manager.load('B')).environments[0].name,'B');
  const restored=new DockerEnvironments({directory,encrypt:Buffer.from,decrypt:value=>value.toString()});assert.equal((await restored.load('A')).environments[0].name,'Development');
  await assert.rejects(restored.renameEnvironment('A','env',''),/1至40/);assert.equal((await restored.load('A')).environments[0].name,'Development');
  await restored.renameEnvironment('A',null,'Laptop');assert.equal((await restored.load('A')).localName,'Laptop');await assert.rejects(restored.renameEnvironment('A',null,' '),/1至40/);assert.equal((await restored.load('A')).localName,'Laptop');
  await assert.rejects(restored.renameEnvironment('A','missing','Name'),/不存在/);await assert.rejects(restored.renameEnvironment(null,'env','Name'),/登录/);await assert.rejects(restored.renameEnvironment('A','env','x'.repeat(41)),/40/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
