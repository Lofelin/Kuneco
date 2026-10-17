import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {DockerEnvironments} from '../../../src/features/environments/docker-environments.mjs';
import {accountMutation} from '../../../src/features/environments/account-mutation.mjs';
test('concurrent environment mutations retain proxy, registry, selection and names',async()=>{
 const directory=await mkdtemp(tmpdir()+'/kuneco-account-transaction-');
 const m=new DockerEnvironments({directory,sourceRoot:process.cwd(),encrypt:s=>s,decrypt:s=>s.toString()});
 try{
  const id=await m.create('owner','initial');
  await Promise.all([m.update('owner',id,{proxy:{host:'fixture.invalid'}}),m.update('owner',id,{registry:{runtimes:[]}}),m.renameEnvironment('owner',id,'renamed'),m.select('owner',id)]);
  const data=await m.load('owner');assert.equal(data.activeId,id);assert.equal(data.environments[0].name,'renamed');assert.equal(data.environments[0].proxy.host,'fixture.invalid');assert.deepEqual(data.environments[0].registry,{runtimes:[]});
  const results=await Promise.allSettled(Array.from({length:12},(_,i)=>m.create('owner','env'+i)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,9);assert.equal((await m.load('owner')).environments.length,10);
  assert.ok((await readdir(directory)).every(n=>n.endsWith('.bin')));
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('failed account mutation releases its queue and does not block other accounts',async()=>{
 const manager={};let release;const wait=new Promise(r=>release=r),seen=[];
 const first=accountMutation(manager,'a',async()=>{await wait;throw Error('fixture');});const rejected=assert.rejects(first,/fixture/);
 const second=accountMutation(manager,'a',()=>seen.push('a'));
 await accountMutation(manager,'b',()=>seen.push('b'));assert.deepEqual(seen,['b']);release();await rejected;await second;assert.deepEqual(seen,['b','a']);
});
test('concurrent runtime metadata patches merge inside the account transaction',async()=>{
 const directory=await mkdtemp(tmpdir()+'/kuneco-runtime-metadata-');
 const m=new DockerEnvironments({directory,sourceRoot:process.cwd(),encrypt:s=>s,decrypt:s=>s.toString()});
 try{
  const id=await m.create('owner','metadata');
  await m.update('owner',id,{runtimeMetadata:{old:{name:'old'},keep:{name:'keep'}}});
  await Promise.all([
   m.update('owner',id,item=>({runtimeMetadata:{...item.runtimeMetadata,codex:{name:'Codex'}}})),
   m.update('owner',id,item=>({runtimeMetadata:{...item.runtimeMetadata,claude:{name:'Claude'}}})),
   m.update('owner',id,item=>{const metadata={...item.runtimeMetadata};delete metadata.old;return {runtimeMetadata:metadata};})
  ]);
  assert.deepEqual((await m.get('owner',id)).item.runtimeMetadata,{keep:{name:'keep'},codex:{name:'Codex'},claude:{name:'Claude'}});
 }finally{await rm(directory,{recursive:true,force:true});}
});
