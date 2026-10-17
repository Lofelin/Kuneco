import {DockerEnvironments,resourcePrefix} from '../src/docker-environments.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {query} from '@anthropic-ai/claude-agent-sdk';
const directory=await mkdtemp(path.join(tmpdir(),'dingtu-docker-test-'));
const manager=new DockerEnvironments({directory,sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()});
const owner='docker-test-'+Date.now();const id=await manager.createAndStart(owner,'隔离验收');const prefix=resourcePrefix(owner,id);let second;
try{

 const capabilities=await manager.exec(owner,id,['node','-e',"const fs=require('fs');console.log(fs.readFileSync('/proc/self/status','utf8').match(/CapEff:\\s+(\\w+)/)[1])"]);
 assert.match(capabilities,/^0+$/);
 const version=await manager.runtimeInfo(owner,id,true);assert.equal(version.runtimes.length,0);
 await manager.exec(owner,id,['node','-e',"require('fs').writeFileSync('/workspace/proof','persistent')"]);
 const direct=await manager.exec(owner,id,['node','-e',"const net=require('net');const s=net.connect(443,'1.1.1.1');s.setTimeout(1200);s.on('connect',()=>{console.log('DIRECT');s.destroy()});s.on('error',()=>console.log('BLOCKED'));s.on('timeout',()=>{console.log('BLOCKED');s.destroy()})"]);
 assert.equal(direct,'BLOCKED');
 const dns=await manager.exec(owner,id,['node','-e',"require('dns').resolve4('example.com',e=>console.log(e?'BLOCKED':'DNS_LEAK'))"]);assert.equal(dns,'BLOCKED');
 second=await manager.createAndStart(owner,'第二个新容器');
 assert.notEqual(resourcePrefix(owner,second),prefix);
 assert.equal(await manager.exec(owner,second,['node','-e',"console.log(require('fs').existsSync('/workspace/proof'))"]),'false');
 await manager.exec(owner,second,['node','-e',"require('fs').writeFileSync('/workspace/proof','second')"]);
 assert.equal(await manager.exec(owner,id,['cat','/workspace/proof']),'persistent');
 await manager.stop(owner,id);await manager.start(owner,id);
 assert.equal(await manager.exec(owner,id,['cat','/workspace/proof']),'persistent');
 const spawn=await manager.spawner(owner,id);const child=spawn({command:'node',args:['-e','setInterval(()=>{},1000)']});await new Promise(r=>setTimeout(r,1000));child.kill();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('cancel timeout')),5000);child.on('close',()=>{clearTimeout(timer);resolve()});});
 console.log('Docker 验收通过：直接新建并启动两个容器、文件互相隔离、空白运行时列表、非root零有效权限、直连与DNS阻断、数据卷重建保留、进程取消。未登录或调用模型。');
}finally{
 for(const cleanupId of [id,second].filter(Boolean)){const prefix=resourcePrefix(owner,cleanupId);
 for(const suffix of ['worker','gateway'])await manager.command(['rm','-f',prefix+'-'+suffix]).catch(()=>{});
 await manager.command(['network','rm',prefix+'-private']).catch(()=>{});
 for(const suffix of ['home','work'])await manager.command(['volume','rm',prefix+'-worker-'+suffix]).catch(()=>{});
 }
 await rm(directory,{recursive:true,force:true});
}
