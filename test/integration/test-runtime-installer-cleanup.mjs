// Uses only a unique disposable environment and an installed image; no package downloads.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DockerEnvironments} from '../../src/features/environments/docker-environments.mjs';
const manager=new DockerEnvironments({sourceRoot:process.cwd()});
const prefix='kuneco-installer-test-'+randomUUID(),volume=prefix+'-worker-home',image='dingtu-runtime:3-clean';
manager.get=async()=>({prefix,item:{imageName:image}});
const remaining=()=>manager.command(['ps','-aq','--filter','label=io.kuneco.environment='+prefix]);
const clean=async()=>{assert.equal(await remaining(),'');assert.equal(manager.directTasks.size,0);assert.ok(await manager.command(['volume','inspect','--format','{{.Name}}',volume]));};
await manager.command(['image','inspect',image]);
await manager.command(['volume','create','--label','app=kuneco-installer-test',volume]);
try{
 assert.equal(await manager.runRuntimeInstaller('fixture','fixture',['node','-e',"process.stdout.write('installer-ok')"]),'installer-ok');await clean();
 await assert.rejects(manager.runRuntimeInstaller('fixture','fixture',['node','-e',"process.stderr.write('fixture download failed');process.exit(23)"]),/fixture download failed/);await clean();
 // Failure to launch the entrypoint can leave a created container for explicit cleanup.
 await assert.rejects(manager.runRuntimeInstaller('fixture','fixture',['/nonexistent-kuneco-installer']),/Docker 操作失败/);await clean();
 const pending=manager.runRuntimeInstaller('fixture','fixture',['node','-e','setInterval(()=>{},1000)']);
 const stopped=assert.rejects(pending,/Docker 操作失败|停止或切换/);
 for(let attempt=0;!await remaining();attempt++){if(attempt===50)throw Error('Installer did not start');await new Promise(r=>setTimeout(r,100));}
 await manager.stopDirectTasks(prefix);await stopped;await clean();
 console.log(JSON.stringify({success:true,commandFailure:true,entrypointFailure:true,cancellation:true,noTaskContainers:true,homeVolumePreserved:true}));
}finally{
 await manager.stopDirectTasks(prefix);
 assert.equal(await remaining(),'');
 await manager.command(['volume','rm',volume]);
}
