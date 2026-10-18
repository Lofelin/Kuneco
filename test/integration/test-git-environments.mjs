import {executeGitOperation} from '../../src/features/git/git-executor.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DockerEnvironments,runtimeInstallerArguments} from '../../src/features/environments/docker-environments.mjs';
import {readGitInfo} from '../../src/features/git/git-management.mjs';
const directory=await mkdtemp(path.join(tmpdir(),'kuneco-git-integration-'));
const manager=new DockerEnvironments({directory,sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()});
const owner='git-qa-'+Date.now(),created=[];
try{
 const keys=[];
 for(let i=0;i<2;i++){
  const name='Git QA '+i,id=await manager.createPrepared(owner,name);created.push({id,name});
  const {prefix,item}=await manager.get(owner,id);
  const read=()=>readGitInfo(args=>manager.command(runtimeInstallerArguments({name:prefix+'-verify',prefix,image:item.imageName,args,network:'none'})));
  const operation=(action,value={})=>executeGitOperation({action,value,context:{route:'managed'},execute:(args,options)=>manager.command(runtimeInstallerArguments({name:prefix+'-manage',prefix,image:item.imageName,args,input:true,network:'none'}),options)});
  const before=await operation('read');assert.equal(before.name,'');assert.equal(before.credentials.length,0);
  await operation('identity',{name:'Fixture '+i,email:'fixture'+i+'@example.test'});
  await operation('credentialSave',{host:'git.example.test',username:'fixture'+i,token:'integration-placeholder-'+i});
  const saved=await operation('read');assert.equal(saved.name,'Fixture '+i);assert.equal(saved.credentials[0].username,'fixture'+i);assert.ok(!JSON.stringify(saved).includes('integration-placeholder-'));
  const actualName=await manager.command(runtimeInstallerArguments({name:prefix+'-config',prefix,image:item.imageName,args:['git','config','--get','user.name'],network:'none'}));assert.equal(actualName,'Fixture '+i);
  await assert.rejects(operation('test',{target:'ssh://git@github.com'}),/代理尚未连接/);
  const info=await read();assert.match(info.version,/git version/);assert.match(info.publicKey,/^ssh-ed25519 /);assert.equal((await read()).publicKey,info.publicKey);keys.push(info.publicKey);
 }
 assert.notEqual(keys[0],keys[1]);console.log('PASS real container creation: Git available, independent persisted public keys, readback after container recreation, isolated identities/credentials, effective git config, missing proxy blocked');
}finally{
 for(const {id,name} of created){await manager.deleteResources(owner,id,name);await manager.forget(owner,id,name);}
 await rm(directory,{recursive:true,force:true});
}
