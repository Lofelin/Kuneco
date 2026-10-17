import {DockerEnvironments} from '../../src/features/environments/docker-environments.mjs';import {importEnvironmentProject,browseEnvironmentProject} from '../../src/features/projects/project-files.mjs';import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';
const exec=promisify(execFile),dir=await realpath(await mkdtemp(path.join(tmpdir(),'dingtu-import-live-'))),prefix='dingtu-import-test-'+randomUUID().slice(0,8),worker=prefix+'-worker';
const manager=new DockerEnvironments({directory:dir,sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()});
manager.get=async()=>({item:{},prefix});manager.workingDirectory=async()=>'/workspace';
try{
 const source=path.join(dir,'repo');await mkdir(source);await exec('git',['init','-b','main',source]);await writeFile(path.join(source,'committed.txt'),'committed');await exec('git',['-C',source,'add','.']);await exec('git',['-C',source,'-c','user.name=Import Test','-c','user.email=import@example.invalid','commit','-m','fixture']);await writeFile(path.join(source,'draft.txt'),'uncommitted');
 await manager.command(['run','-d','--name',worker,'--label','app=dingtu-test','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/workspace:rw,uid=1000,gid=1000','--entrypoint','sleep','dingtu-runtime:3-clean','infinity']);
 const imported=await importEnvironmentProject(manager,'fixture','env',source);
 assert.equal(await manager.exec('fixture','env',['git','-C',imported,'log','-1','--format=%s']),'fixture');
 assert.equal(await manager.exec('fixture','env',['git','-C',imported,'branch','--show-current']),'main');
 assert.match(await manager.exec('fixture','env',['git','-C',imported,'status','--porcelain']),/draft.txt/);
 assert.equal(await manager.exec('fixture','env',['cat',imported+'/draft.txt']),'uncommitted');
 const listing=await browseEnvironmentProject(manager,'fixture','env',imported);assert.equal(listing.directory,imported);
 console.log('PASS real isolated container import: Git history, branch, uncommitted file and directory selection');
}finally{await manager.command(['rm','-f',worker]).catch(()=>{});await rm(dir,{recursive:true,force:true});}
