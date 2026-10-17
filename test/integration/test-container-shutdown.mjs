// Only disposable fixture containers, networks and volumes. Never load account data.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {DockerEnvironments,resourcePrefix} from '../../src/features/environments/docker-environments.mjs';
const owner='shutdown-fixture',id=randomUUID(),prefix=resourcePrefix(owner,id);
const m=new DockerEnvironments({sourceRoot:process.cwd()}),command=m.command.bind(m);
const externalName='kuneco-shutdown-external-'+id;let externalId;
const ready=child=>new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(Error('fixture readiness timed out')),20000);
 child.once('error',reject);child.once('close',()=>{clearTimeout(timer);reject(Error('fixture closed before readiness'));});
 child.stdout.once('data',data=>{clearTimeout(timer);assert.match(String(data),/ready/);resolve();});
});
try{
 m.get=async()=>({prefix,item:{imageName:'dingtu-runtime:3-clean'}});
 const launcher=await m.directChatSpawner(owner,id),child=launcher({command:'/bin/sh',args:['-c','echo ready; sleep 300']});
 const closed=once(child,'close');await ready(child);
 assert.equal(m.taskCapacity.active,1);
 const names=(await command(['ps','-a','--format','{{.Names}}','--filter','label=io.kuneco.environment='+prefix])).split('\n').filter(Boolean);
 assert.equal(names.length,1);
 await m.shutdownTasks();await closed;
 assert.equal(m.taskCapacity.active,0);assert.equal(m.directTasks.size,0);
 assert.equal((await command(['ps','-aq','--filter','label=io.kuneco.environment='+prefix])).trim(),'');
 assert.throws(()=>launcher({command:'/bin/sleep',args:['1']}),/正在退出/);
 const external=new DockerEnvironments({sourceRoot:process.cwd()});
 externalId=await command(['run','-d','--name',externalName,'--label','app=kuneco-shutdown-fixture','--network','none','--init','--entrypoint','/bin/sleep','dingtu-runtime:3-clean','infinity']);
 const item={external:{id:externalId,endpoint:external.endpoint,workingDirectory:'/tmp'}};
 const launchExternal=await external.externalSpawner(owner,id,item,{direct:true});
 const ext=launchExternal({command:'/bin/sh',args:['-c','echo ready; sleep 300']});const extClosed=once(ext,'close');await ready(ext);
 const original=external.command.bind(external);
 external.command=(args,options)=>{if(!options?.endpoint)throw Error('managed daemon offline');return original(args,options);};
 await external.shutdownTasks();await extClosed;assert.equal(external.directTasks.size,0);
 assert.throws(()=>launchExternal({command:'/bin/sleep',args:['1']}),/正在退出/);
 console.log(JSON.stringify({managedShutdownRemovesTask:true,quotaReleased:true,staleLauncherRejected:true,externalShutdownWithoutManagedDaemon:true,accountDataLoaded:false},null,2));
}finally{
 const tasks=(await command(['ps','-aq','--filter','label=io.kuneco.environment='+prefix])).split('\n').filter(Boolean);
 for(const task of tasks)await command(['rm','-f',task]);
 if(externalId)await command(['rm','-f',externalId]);
 const networks=(await command(['network','ls','--format','{{.Name}}'])).split('\n');
 if(networks.includes(prefix+'-direct-egress'))await command(['network','rm',prefix+'-direct-egress']);
 const volumes=(await command(['volume','ls','--format','{{.Name}}'])).split('\n');
 for(const volume of [prefix+'-worker-home',prefix+'-worker-work'])if(volumes.includes(volume))await command(['volume','rm',volume]);
 assert.equal((await command(['ps','-aq','--filter','label=io.kuneco.environment='+prefix])).trim(),'');
}
