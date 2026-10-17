// Disposable external container only; no account volumes or production containers.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {DockerEnvironments,resourcePrefix} from '../../src/features/environments/docker-environments.mjs';
const m=new DockerEnvironments({sourceRoot:process.cwd()}),id=randomUUID(),owner='task-recovery-fixture',prefix=resourcePrefix(owner,id),name='kuneco-task-recovery-'+id;
const command=m.command.bind(m);let containerId;
try{
 containerId=await command(['run','-d','--name',name,'--network','none','--init','--entrypoint','sleep','dingtu-runtime:3-clean','infinity']);
 const item={external:{id:containerId,endpoint:m.endpoint,workingDirectory:'/tmp'}};
 m.get=async()=>({prefix,item});m.state=async()=>({});
 const launch=await m.externalSpawner(owner,id,item,{direct:true});
 const child=launch({command:'sh',args:['-c','echo ready; sleep 300']});child.on('error',()=>{});
 await once(child.stdout,'data');
 const ended=once(child,'close');await command(['stop','-t','1',containerId]);await ended;
 for(let i=0;m.directTasks.size&&i<100;i++)await new Promise(r=>setTimeout(r,100));
 assert.equal(m.directTasks.size,0,'stopped container must resolve failed exec cleanup');
 // An external daemon remains usable even if the managed-daemon path is unavailable.
 m.command=(args,options)=>{if(!options?.endpoint)throw Error('managed daemon offline');return command(args,options);};
 await m.stop(owner,id);assert.doesNotThrow(()=>m.taskLaunchGuard()(prefix));
 await command(['rm',containerId]);
 await m.stop(owner,id);assert.doesNotThrow(()=>m.taskLaunchGuard()(prefix));
 console.log(JSON.stringify({stoppedExecCleanupRecovers:true,externalWithoutManagedDaemon:true,deletedExternalStop:true,volumesUsed:false}));
}finally{if(containerId)await command(['rm','-f',containerId]).catch(()=>{});}
