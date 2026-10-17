import assert from 'node:assert/strict';
import {DockerEnvironments} from '../src/docker-environments.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const directory=await mkdtemp(path.join(tmpdir(),'existing-container-'));
const manager=new DockerEnvironments({directory,sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()});
const name='existing-fixture-'+Date.now();let source;
try{
 source=await manager.command(['run','-d','--name',name,'--network','none','--entrypoint','sleep','dingtu-runtime:1','infinity']);
 const before=JSON.parse(await manager.command(['inspect',source]))[0];
 await manager.command(['exec',source,'sh','-c','echo original > /workspace/existing-proof']);
 const listed=await manager.existing('fixture-owner'),choice=listed.find(item=>item.name===name);assert.ok(choice,'本机其他容器可以被列出');
 assert.equal((await manager.previewExisting('fixture-owner',choice.key)).runtimes.length,2);
 const id=await manager.attach('fixture-owner','原容器环境',choice.key);assert.equal((await manager.get('fixture-owner',id)).item.external.id,source);
 assert.equal((await manager.runtimeInfo('fixture-owner',id,true)).runtimes.length,2);assert.equal(await manager.exec('fixture-owner',id,['cat','/workspace/existing-proof']),'original');
 assert.ok(!(await manager.existing('other-owner')).some(item=>item.id===source),'已关联容器不泄露给其他账号');
 const spawn=await manager.spawner('fixture-owner',id);const child=spawn({command:'node',args:['-e','setInterval(()=>{},1000)']});await new Promise(resolve=>setTimeout(resolve,500));const closed=new Promise(resolve=>child.once('close',resolve));child.kill();await Promise.race([closed,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('取消未完成')),6000);timer.unref();})]);
 await manager.deleteResources('fixture-owner',id,'原容器环境');await manager.forget('fixture-owner',id,'原容器环境');
 const after=JSON.parse(await manager.command(['inspect',source]))[0];assert.equal(after.State.Running,true);assert.deepEqual(after.HostConfig.NetworkMode,before.HostConfig.NetworkMode);assert.deepEqual(after.Mounts,before.Mounts);assert.equal(await manager.command(['exec',source,'cat','/workspace/existing-proof']),'original');
 console.log('已有容器验收通过：枚举原容器、检测两个运行时、原地执行与取消、账号归属、移除关联保留原容器文件及网络。');
}finally{if(source)await manager.command(['rm','-f',source]).catch(()=>{});await rm(directory,{recursive:true,force:true});}
