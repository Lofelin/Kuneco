import test from 'node:test';
import assert from 'node:assert/strict';
import {DockerEnvironments} from '../../../src/features/environments/docker-environments.mjs';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function manager(){const m=new DockerEnvironments({sourceRoot:process.cwd()});m.command=async()=>'';return m;}
test('shutdown waits for preparation and task cancellation and invalidates captured guards',async()=>{
 const m=manager(),prepare=deferred(),cancel=deferred(),guard=m.taskLaunchGuard();let started=false,done=false;
 const preparing=m.withEnvironmentPreparation('fixture',async check=>{await prepare.promise;check();});
 const rejected=assert.rejects(preparing,/正在退出/);
 await turn();m.directTasks=new Map([['task',{prefix:'fixture',cancel:()=>{started=true;return cancel.promise;}}]]);
 const stopping=m.shutdownTasks().then(()=>{done=true;});
 assert.throws(()=>guard('fixture'),/正在退出/);await turn();assert.equal(done,false);assert.equal(started,false);
 prepare.resolve();await rejected;await turn();assert.equal(started,true);assert.equal(done,false);
 cancel.resolve();await stopping;assert.equal(m.directTasks.size,0);assert.equal(done,true);
 await assert.rejects(m.withEnvironmentPreparation('fixture',async()=>{}),/正在退出/);
});
test('shutdown failure waits for every cancellation and can retry without allowing new launch',async()=>{
 const m=manager(),slow=deferred();let fail=true,done=false;
 m.directTasks=new Map([['bad',{prefix:'fixture',cancel:async()=>{if(fail)throw Error('cleanup failure');}}],['slow',{prefix:'fixture',cancel:()=>slow.promise}]]);
 const stopping=m.shutdownTasks();const rejected=assert.rejects(stopping,/退出清理未完成/);void stopping.finally(()=>{done=true;}).catch(()=>{});
 await turn();assert.equal(done,false);slow.resolve();await rejected;assert.equal(m.directTasks.size,1);
 assert.throws(()=>m.taskLaunchGuard()('fixture'),/正在退出/);
 fail=false;await m.shutdownTasks();assert.equal(m.directTasks.size,0);assert.equal(m.directStopFailures.size,0);
});
test('installer quota remains occupied after cleanup failure and releases on confirmed retry',async()=>{
 const m=manager();m.get=async()=>({prefix:'fixture',item:{}});let fail=true;
 m.command=async a=>{
  if(a[0]==='run')return '';
  if(a[0]==='inspect')return JSON.stringify({Id:'installer-id',Config:{Labels:{app:'dingtu-installer','io.kuneco.environment':'fixture'}}});
  if(a[0]==='stop'&&fail)throw Error('cleanup unavailable');
  if(a[0]==='ps')return fail?'installer-id':'';return '';
 };
 await assert.rejects(m.runRuntimeInstaller('owner','id',['node','--version']),/cleanup unavailable/);
 assert.equal(m.taskCapacity.active,1);assert.equal(m.directTasks.size,1);
 fail=false;await m.stopDirectTasks('fixture');assert.equal(m.taskCapacity.active,0);assert.equal(m.directTasks.size,0);
 await m.stopDirectTasks('fixture');assert.equal(m.taskCapacity.active,0);
});
test('installer launch failure releases quota after confirmed daemon absence',async()=>{
 const m=manager();m.get=async()=>({prefix:'fixture',item:{}});
 m.command=async a=>{if(a[0]==='run')throw Error('launch failed');if(a[0]==='inspect')throw Error('not found');return '';};
 await assert.rejects(m.runRuntimeInstaller('owner','id',['node']),/launch failed/);
 assert.equal(m.taskCapacity.active,0);assert.equal(m.directTasks.size,0);
});
test('shutdown of tracked external tasks does not consult an unavailable managed daemon',async()=>{
 const m=manager();let cancelled=false;
 m.command=async()=>{throw Error('managed daemon offline');};
 m.directTasks=new Map([['external',{prefix:'external-fixture',cancel:async()=>{cancelled=true;}}]]);
 await m.shutdownTasks();assert.equal(cancelled,true);assert.equal(m.directTasks.size,0);
});
