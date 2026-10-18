import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {executeGitOperation} from '../../../src/features/git/git-executor.mjs';
const exec=promisify(execFile);
test('Git identities, keys and HTTPS credentials stay in their selected environment',async()=>{
 const parent=await mkdtemp(path.join(tmpdir(),'kuneco-git-settings-')),a=path.join(parent,'a with space'),b=path.join(parent,'b');
 const run=(root,action='read',value={})=>executeGitOperation({action,value,context:{root,local:true,route:'external'}});
 try{
  const initial=await run(a);const sshCommand=(await exec('git',['config','--file',path.join(a,'config'),'--get','core.sshCommand'])).stdout.trim();const resolved=(await exec('sh',['-c',sshCommand+' -G example.test'])).stdout;assert.match(resolved,/identityfile none/);assert.ok(resolved.includes(path.join(a,'known_hosts')));
  await run(a,'identity',{name:'Alice',email:'alice@example.test'});let info=await run(a);assert.equal(info.name,'Alice');assert.equal((await run(b)).name,'');
  const repo=path.join(parent,'repo');await exec('git',['init',repo]);
  await executeGitOperation({action:'identity',value:{scope:'repository',name:'Repo Author',email:'repo@example.test'},context:{root:a,local:true,route:'external',project:repo}});
  const repoInfo=await executeGitOperation({action:'read',value:{},context:{root:a,local:true,route:'external',project:repo}});assert.equal(repoInfo.repositoryName,'Repo Author');await assert.rejects(exec('git',['-C',repo,'config','--local','--get','user.name']));const inA=await exec('git',['-C',repo,'config','--get','user.name'],{env:{...process.env,GIT_CONFIG_GLOBAL:path.join(a,'config'),GIT_CONFIG_NOSYSTEM:'1'}});assert.equal(inA.stdout.trim(),'Repo Author');await assert.rejects(exec('git',['-C',repo,'config','--get','user.name'],{env:{...process.env,GIT_CONFIG_GLOBAL:path.join(b,'config'),GIT_CONFIG_NOSYSTEM:'1'}}));assert.equal(repoInfo.name,'Alice');assert.equal((await run(b)).repositoryAvailable,false);
  const first=await run(a,'keyCreate');const privateFile=path.join(a,'keys',first.activeKey);const privateBefore=await readFile(privateFile);assert.match(first.fingerprint,/SHA256:/);
  const second=await run(a,'keyCreate');assert.equal(second.keys.length,2);assert.notEqual(second.activeKey,first.activeKey);assert.deepEqual(await readFile(privateFile),privateBefore);
  const chosen=await run(a,'keySelect',{key:first.activeKey});assert.equal(chosen.publicKey,first.publicKey);assert.equal((await stat(privateFile)).mode&0o777,0o600);
  await assert.rejects(run(b,'keySelect',{key:first.activeKey}),/密钥不存在/);
  const token='fixture-secret-DO-NOT-RETURN';info=await run(a,'credentialSave',{host:'git.example.test',username:'Alice',token});assert.ok(!JSON.stringify(info).includes(token));assert.equal((await stat(path.join(a,'credentials.json'))).mode&0o777,0o600);assert.equal((await run(b)).credentials.length,0);
  async function credential(root,host){return new Promise((resolve,reject)=>{const child=execFile(process.execPath,[path.join(root,'credential.cjs'),'get'],{encoding:'utf8'},(error,stdout)=>error?reject(error):resolve(stdout));child.stdin.end('protocol=https\nhost='+host+'\n\n');});}
  assert.match(await credential(a,'git.example.test'),/password=fixture-secret/);assert.equal(await credential(a,'other.example.test'),'');
  assert.ok(!(await readFile(path.join(a,'config'),'utf8')).includes(token));
  await run(a,'credentialRemove',{host:'git.example.test'});assert.equal(await credential(a,'git.example.test'),'');
  await assert.rejects(run(a,'test',{target:'https://user:secret@example.test/repo'}),/仅支持/);
  await assert.rejects(run(a,'identity',{name:'x\ninjected',email:'a@b.c'}),/配置值无效/);
 }finally{await rm(parent,{recursive:true,force:true});}
});

test('account identity defaults initialize once without inventing email or replacing saved identity',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'kuneco-git-defaults-'));
 const run=(folder,defaultIdentity,action='read',value={})=>executeGitOperation({action,value,context:{root:path.join(root,folder),local:true,route:'external',defaultIdentity}});
 try{
  const noEmail=await run('password',{name:'Password User',email:''});assert.equal(noEmail.name,'Password User');assert.equal(noEmail.email,'');
  const oauth=await run('oauth',{name:'Profile Name',email:'profile@example.test'});assert.equal(oauth.name,'Profile Name');assert.equal(oauth.email,'profile@example.test');
  const unchanged=await run('oauth',{name:'Different',email:'different@example.test'});assert.equal(unchanged.name,'Profile Name');assert.equal(unchanged.email,'profile@example.test');
  await run('existing',null,'identity',{name:'Git Author',email:'git@example.test'});
  const existing=await run('existing',{name:'Profile Name',email:'profile@example.test'});assert.equal(existing.name,'Git Author');assert.equal(existing.email,'git@example.test');
 }finally{await rm(root,{recursive:true,force:true});}
});
