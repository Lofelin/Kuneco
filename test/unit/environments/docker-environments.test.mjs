import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DockerEnvironments,workerArguments,resourcePrefix} from '../../../src/features/environments/docker-environments.mjs';
test('local environment deletion persists, allows zero environments, and recreation is account scoped',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-local-'));
 const manager=new DockerEnvironments({directory,sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()});manager.engineStatus=async()=>({ready:false});
 try{
  await manager.createLocal('owner');
  await assert.rejects(manager.forgetLocal('owner','wrong'));
  await manager.forgetLocal('owner','本机环境');
  assert.equal((await manager.state('owner')).localEnabled,false);
  assert.equal((await manager.state('other')).localEnabled,false);
  await assert.rejects(manager.select('owner',null));
  const id=await manager.create('owner','Docker');await manager.select('owner',id);await manager.forget('owner',id,'Docker');
  assert.equal((await manager.state('owner')).environments.length,0);assert.equal((await manager.state('owner')).localEnabled,false);
  await manager.createLocal('owner','我的本机');assert.equal((await manager.state('owner')).localName,'我的本机');await assert.rejects(manager.createLocal('owner'));
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('container resources are account-scoped and names cannot inject Docker options',()=>{
 const id='12345678-1234-1234-1234-123456789abc';
 assert.notEqual(resourcePrefix('user1',id),resourcePrefix('user2',id));assert.throws(()=>resourcePrefix('user','--privileged'));
 const args=workerArguments({name:'test',network:'private',gatewayIP:'172.19.0.2',proxyURL:'http://proxy'});
 assert.ok(args.includes('--read-only'));assert.ok(args.includes('no-new-privileges'));assert.ok(!args.includes('--privileged'));assert.ok(!args.join(' ').includes('docker.sock'));assert.ok(args.includes('127.0.0.1'));
});
test('environment registry is per account, validates names, and never returns proxy credentials',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-registry-'));
 const manager=new DockerEnvironments({directory,sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()});manager.engineStatus=async()=>({ready:false});
 try{const id=await manager.create('owner1','开发');await manager.update('owner1',id,{proxy:{password:'private'}});await manager.select('owner1',id);assert.equal((await manager.state('owner2')).environments.length,0);assert.equal((await manager.state('owner1')).activeId,id);assert.ok(!JSON.stringify(await manager.state('owner1')).includes('private'));await assert.rejects(manager.get('owner2',id));await assert.rejects(manager.create('owner1',''));}finally{await rm(directory,{recursive:true,force:true});}
});

test('environment deletion validates ownership and name and removes only exact resources',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-delete-'));
 const manager=new DockerEnvironments({directory,sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()});
 try{
  const id=await manager.create('owner','待删除'),other=await manager.create('owner','保留');await manager.select('owner',id);
  const prefix=resourcePrefix('owner',id),calls=[];
  manager.command=async args=>{calls.push(args);if(args[1]==='ls')return args[0]==='container'?`${prefix}-worker\n${prefix}-gateway\n${prefix}-worker-other`:args[0]==='network'?`${prefix}-private\nother-network`:`${prefix}-worker-home\n${prefix}-worker-work\nother-volume`;return '';};
  await assert.rejects(manager.deleteResources('other',id,'待删除'));await assert.rejects(manager.deleteResources('owner',id,'错误'));assert.equal(calls.length,0);
  await manager.deleteResources('owner',id,'待删除');
  assert.deepEqual(calls.filter(args=>args[1]==='rm').map(args=>args.at(-1)),['worker','gateway','private','worker-home','worker-work'].map(suffix=>prefix+'-'+suffix));
  await manager.forget('owner',id,'待删除');assert.deepEqual((await manager.load('owner')).environments.map(item=>item.id),[other]);assert.equal((await manager.load('owner')).activeId,other);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('failed container cleanup retains environment so deletion can be retried',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-delete-fail-'));
 const manager=new DockerEnvironments({directory,sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()});
 try{const id=await manager.create('owner','保留待重试');manager.command=async()=>{throw new Error('engine unavailable');};await assert.rejects(manager.deleteResources('owner',id,'保留待重试'));assert.equal((await manager.get('owner',id)).item.name,'保留待重试');}finally{await rm(directory,{recursive:true,force:true});}
});

test('engine status returns only display metadata and preserves independent engine/image readiness',async()=>{
 const manager=new DockerEnvironments({directory:'/unused',sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()});
 manager.command=async args=>args[0]==='version'?'29.0.0':JSON.stringify([{Size:2147483648,Config:{Env:['PRIVATE=do-not-expose']}}]);
 const status=await manager.engineStatus();assert.equal(status.version,'29.0.0');assert.equal(status.imageName,'dingtu-runtime:3-clean');assert.equal(status.imageSize,2147483648);assert.equal(status.image,true);assert.equal(JSON.stringify(status).includes('PRIVATE'),false);
 manager.command=async args=>{if(args[0]==='version')return '29.0.0';throw new Error('image missing');};
 const missing=await manager.engineStatus();assert.equal(missing.ready,true);assert.equal(missing.image,false);assert.equal(missing.imageSize,null);
 manager.command=async()=>{throw new Error('offline');};const offline=await manager.engineStatus();assert.equal(offline.ready,false);assert.equal(offline.image,false);
});

test('container runtime preview runs only inside the image with no host files or network',async()=>{
 const manager=new DockerEnvironments({directory:'/unused',sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()}),calls=[];
 manager.command=async args=>{calls.push(args);return args.includes('claude')?'container-claude-version':'container-codex-version'};
 const result=await manager.previewRuntimes();assert.deepEqual(result.runtimes.map(item=>item.version),['container-claude-version','container-codex-version']);
 for(const args of calls){assert.equal(args[0],'run');assert.ok(args.includes('dingtu-runtime:3-clean'));assert.equal(args[args.indexOf('--network')+1],'none');assert.ok(args.includes('--read-only'));assert.ok(!args.includes('--mount')&&!args.includes('-v'));}
});

test('new container creation starts a unique environment and rolls back only failed new resources',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-create-'));
 const manager=new DockerEnvironments({directory,sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()});
 manager.engineStatus=async()=>({ready:true,image:true});manager.verifyImageTools=async()=>{};const started=[],cleaned=[];
 manager.start=async(owner,id)=>{started.push(resourcePrefix(owner,id));};
 try{
  const first=await manager.createAndStart('owner','新容器一'),second=await manager.createAndStart('owner','新容器二');
  assert.notEqual(first,second);assert.notEqual(started[0],started[1]);assert.equal((await manager.load('owner')).environments.length,2);
  manager.start=async()=>{throw new Error('启动失败');};manager.deleteResources=async(owner,id)=>{cleaned.push(id);};
  await assert.rejects(manager.createAndStart('owner','失败容器'),/已清理/);
  assert.equal(cleaned.length,1);assert.ok(![first,second].includes(cleaned[0]));assert.deepEqual((await manager.load('owner')).environments.map(item=>item.id),[first,second]);
  manager.engineStatus=async()=>({ready:false,image:false});await assert.rejects(manager.createAndStart('owner','未就绪'),/基础镜像/);assert.equal((await manager.load('owner')).environments.length,2);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('external container claims bind the original container across engine aliases and release only for its owner',async()=>{
 const {claimExternal,releaseExternal}=await import('../../../src/features/environments/external-containers.mjs');
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-claim-')),manager={directory};const id='a'.repeat(64);
 try{
  assert.equal(await claimExternal(manager,'owner',{id,endpoint:'unix:///first',key:'first'}),true);
  assert.equal(await claimExternal(manager,'owner',{id,endpoint:'unix:///alias',key:'second'}),false);
  await assert.rejects(claimExternal(manager,'other',{id,endpoint:'unix:///alias',key:'second'}),/其他账号/);
  await releaseExternal(manager,'other',{id,endpoint:'unix:///alias'});
  await assert.rejects(claimExternal(manager,'other',{id,endpoint:'unix:///first',key:'first'}),/其他账号/);
  await releaseExternal(manager,'owner',{id,endpoint:'unix:///alias'});
  assert.equal(await claimExternal(manager,'other',{id,endpoint:'unix:///alias',key:'second'}),true);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('prepare reports real ordered stages and verifies readiness before completion',async()=>{
 const manager=new DockerEnvironments({sourceRoot:process.cwd()});
 manager.binary=async()=>'/usr/bin/true';manager.pullBaseImage=async()=>{};
 const commands=[];manager.command=async args=>commands.push(args);
 manager.engineStatus=async()=>({ready:true,image:true});
 const progress=[];await manager.prepare(value=>progress.push(value));
 assert.deepEqual(progress.map(value=>value.stage),[1,2,3,3,4,4]);
 assert.equal(progress.at(-1).complete,true);assert.equal(commands[0][0],'build');assert.equal(manager.busy,false);
 manager.command=async()=>{throw new Error('build failed');};
 const failure=[];await assert.rejects(manager.prepare(value=>failure.push(value)),/build failed/);
 assert.deepEqual(failure.map(value=>value.stage),[1,2,3,3]);assert.equal(manager.busy,false);
 manager.command=async()=>'';manager.engineStatus=async()=>({ready:true,image:false});
 await assert.rejects(manager.prepare(),/配置核验未通过/);assert.equal(manager.busy,false);
});

test('deleting active environment follows menu order and wraps to the first remaining entry',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-delete-order-'));
 const manager=new DockerEnvironments({directory,sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()});
 try{
  await manager.createLocal('owner','Local');
  const first=await manager.create('owner','First'),second=await manager.create('owner','Second');
  await manager.select('owner',first);await manager.forget('owner',first,'First');
  assert.equal((await manager.load('owner')).activeId,second);
  await manager.forget('owner',second,'Second');assert.equal((await manager.load('owner')).activeId,null);
  const last=await manager.create('owner','Last');await manager.forgetLocal('owner','Local');
  assert.equal((await manager.load('owner')).activeId,last);
  await manager.forget('owner',last,'Last');const state=await manager.load('owner');
  assert.equal(state.localEnabled,false);assert.deepEqual(state.environments,[]);assert.equal(state.activeId,null);
 }finally{await rm(directory,{recursive:true,force:true});}
});


test('new environments reject images without required tools before saving any environment',async()=>{
 const manager=new DockerEnvironments({sourceRoot:process.cwd()});let created=false;
 manager.load=async()=>({});manager.engineStatus=async()=>({ready:true,image:true});
 manager.create=async()=>{created=true;};manager.command=async args=>{assert.equal(args[args.indexOf('--network')+1],'none');assert.ok(args.includes('--read-only'));assert.ok(args.includes('dingtu-runtime:3-clean'));assert.equal(args.at(-1),'node --version && npm --version && curl --version');throw new Error('curl missing');};
 await assert.rejects(manager.createAndStart('owner','new'),/Node.js、npm 或 curl/);assert.equal(created,false);
 manager.command=async()=> 'node npm curl available';await manager.verifyImageTools('dingtu-runtime:3-clean');
});

test('control-plane outage preserves forwarding status while confirmed core-container stop blocks it',async()=>{
 const {ContainerGateway}=await import('../../../src/features/environments/docker-environments.mjs');let unavailable=false,stopped=false;const calls=[];
 const manager={rpc:async(...args)=>{calls.push(args);if(unavailable)throw new Error('control timeout');return {state:'ready',ip:'203.0.113.8'};},command:async()=>stopped?'false':'true'};
 const gateway=new ContainerGateway(manager,'owner','183494cd-1b80-4886-a620-4956f9535772',12345,'test-token');
 await gateway.sync();unavailable=true;await gateway.sync();
 assert.equal(gateway.status.state,'ready');assert.equal(gateway.status.controlState,'unavailable');assert.equal(calls.some(args=>args[2]==='stop'),false);
 stopped=true;await gateway.sync();assert.equal(gateway.status.state,'blocked');
 unavailable=false;stopped=false;await gateway.sync();assert.equal(gateway.status.state,'ready');assert.equal(gateway.status.controlState,undefined);
 await gateway.stop();const count=calls.length;await gateway.sync();assert.equal(calls.length,count);
});
