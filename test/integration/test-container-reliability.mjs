// Explicit, isolated Docker integration test; never uses account containers/volumes.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DockerEnvironments,workerArguments} from '../../src/features/environments/docker-environments.mjs';
import {workerImage,ensureWorker,ensurePrivateNetwork} from '../../src/features/environments/container-reliability.mjs';
const manager=new DockerEnvironments({sourceRoot:process.cwd()});
const prefix='kuneco-reliability-test-'+randomUUID(),name=prefix+'-worker',network=prefix+'-private';
const base='dingtu-runtime:3-clean',gatewayIP='172.30.250.254';
const image=await workerImage(manager,base);
const args=workerArguments({name,network,gatewayIP,proxyURL:'http://workspace:fixture@'+gatewayIP+':8080',image,spec:'integration-v1'});
const inspect=async()=>JSON.parse(await manager.command(['inspect','--format','{{json .}}',name]));
const noCancel=()=>{};
try{
 await manager.command(['network','create','--internal','--label','app=dingtu','--subnet','172.30.250.0/24',network]);
 await manager.command(workerArguments({name,network,gatewayIP,proxyURL:'http://fixture',image:base}));
 await manager.command(['exec','--user','1000:1000',name,'sh','-c','printf retained > /home/node/reliability-sentinel; printf work > /workspace/reliability-sentinel']);
 await ensurePrivateNetwork(manager,network);
 const before=await inspect();
 await ensureWorker(manager,{name,image,spec:'integration-v1',args,assertCurrent:noCancel});
 const after=await inspect();assert.notEqual(after.Id,before.Id);assert.equal(after.HostConfig.Init,true);assert.equal(after.HostConfig.LogConfig.Type,'local');assert.equal(after.HostConfig.ReadonlyRootfs,true);
 assert.deepEqual(after.Mounts.map(m=>m.Name).sort(),before.Mounts.map(m=>m.Name).sort());
 assert.equal(await manager.command(['exec',name,'cat','/home/node/reliability-sentinel']),'retained');
 assert.equal(await manager.command(['exec',name,'cat','/workspace/reliability-sentinel']),'work');
 await ensureWorker(manager,{name,image,spec:'integration-v1',args,assertCurrent:noCancel});assert.equal((await inspect()).Id,after.Id);
 await manager.command(['network','connect','bridge',name]);
 await assert.rejects(ensureWorker(manager,{name,image,spec:'integration-v1',args,assertCurrent:noCancel}),/网络/);
 assert.equal((await inspect()).Id,after.Id);
 await manager.command(['network','disconnect','bridge',name]);
 const bad=[...args];bad[bad.indexOf('--entrypoint')+1]='/missing-entrypoint';
 await assert.rejects(ensureWorker(manager,{name,image,spec:'integration-bad',args:bad,assertCurrent:noCancel}));
 assert.equal((await inspect()).Id,after.Id);assert.equal((await inspect()).State.Running,true);
 await manager.command(['exec','--user','1000:1000',name,'node','-e',"require('child_process').spawn('sh',['-c','sleep .1'],{detached:true,stdio:'ignore'}).unref()"]);
 await new Promise(r=>setTimeout(r,300));
 const ps=await manager.command(['exec',name,'ps','-eo','stat']);assert.ok(!ps.split('\n').some(s=>s.trim().startsWith('Z')));
 assert.match(await manager.command(['exec',name,'sh','-c','iptables -S OUTPUT']),/-P OUTPUT DROP/);
 console.log(JSON.stringify({extraNetworkRejected:true,upgrade:true,rollback:true,volumesPreserved:true,reconnectRetainsContainer:true,init:true,zombies:0,readonly:true,logs:after.HostConfig.LogConfig,networkPolicy:'OUTPUT DROP'}));
}finally{
 const names=(await manager.command(['ps','-a','--format','{{.Names}}'])).split('\n').filter(n=>n===name||n.startsWith(name+'-upgrade-'));
 for(const n of names)await manager.command(['rm','-f',n]);
 await manager.command(['network','rm',network]).catch(()=>{});
 for(const volume of [name+'-home',name+'-work'])await manager.command(['volume','rm',volume]).catch(()=>{});
}
