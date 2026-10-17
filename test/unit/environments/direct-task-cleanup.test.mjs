import test from 'node:test';import assert from 'node:assert/strict';
import {cleanupDirectTask} from '../../../src/features/environments/direct-task-cleanup.mjs';
import {DockerEnvironments,resourcePrefix} from '../../../src/features/environments/docker-environments.mjs';
const prefix='fixture',name='fixture-direct-task';
function fixture(){let exists=true;const calls=[];const m={command:async a=>{calls.push(a);if(a[0]==='inspect')return JSON.stringify({Id:'immutable',Config:{Labels:{app:'dingtu-direct','io.kuneco.environment':prefix}}});if(a[0]==='rm')exists=false;if(a[0]==='ps')return exists?'immutable':'';return '';}};return {m,calls};}
test('cleanup verifies ownership, removes created containers by immutable ID and checks absence',async()=>{const {m,calls}=fixture();assert.equal(await cleanupDirectTask(m,name,prefix),true);assert.ok(calls.some(a=>a[0]==='rm'&&a[2]==='immutable'));assert.ok(!calls.flat().includes('-v'));});
test('foreign container and uncertain inspection never become deletion or success',async()=>{
 const {m,calls}=fixture();await assert.rejects(cleanupDirectTask(m,name,'another'),/归属/);assert.ok(!calls.some(a=>a[0]==='stop'));
 const fail={command:async a=>{if(a[0]==='inspect')throw Error('inspect failed');return name;}};await assert.rejects(cleanupDirectTask(fail,name,prefix),/inspect failed/);
});
test('failed removal remains retryable and an already removed container is accepted',async()=>{const {m}=fixture(),original=m.command;let fail=true;m.command=async a=>{if(a[0]==='rm'&&fail)throw Error('daemon failure');return original(a);};await assert.rejects(cleanupDirectTask(m,name,prefix),/daemon failure/);fail=false;assert.equal(await cleanupDirectTask(m,name,prefix),true);assert.equal(await cleanupDirectTask({command:async a=>{if(a[0]==='inspect')throw Error('missing');return '';}},name,prefix),false);});
function manager(){const m=new DockerEnvironments({sourceRoot:process.cwd()});m.get=async()=>({prefix,item:{}});m.binary=async()=>'/usr/bin/true';m.command=async a=>{if(a[0]==='network')return JSON.stringify({Internal:false,Driver:'bridge',Labels:{app:'dingtu-direct','io.kuneco.environment':prefix}});if(a[0]==='image'&&a.includes('{{json .}}'))return JSON.stringify({Id:'fixture'});return '';};return m;}
test('stop invalidates captured launchers and preparations suspended before get returns',async()=>{
 const m=manager(),launch=await m.directChatSpawner('owner','id');await m.stopDirectTasks(prefix);assert.throws(()=>launch({command:'node'}),/停止或切换/);
 let resolve;const wait=new Promise(r=>resolve=r);m.get=async()=>{await wait;return {prefix,item:{}};};const pending=m.directChatSpawner('owner','id');await m.stopDirectTasks(prefix);resolve();await assert.rejects(pending,/停止或切换/);
});
test('environment switch reconciles direct tasks even if worker is not running',async()=>{
 const m=manager(),old='11111111-1111-1111-1111-111111111111',current='22222222-2222-2222-2222-222222222222',seen=[];
 m.load=async()=>({environments:[{id:old},{id:current}]});m.stopDirectTasks=async p=>seen.push(p);m.command=async()=>'';
 await m.stopOtherEnvironments('owner',current);assert.deepEqual(seen,[resourcePrefix('owner',old)]);
});
test('activation reconciles stale direct tasks of the selected environment before starting it',async()=>{
 const m=manager(),id='11111111-1111-1111-1111-111111111111',seen=[];m.load=async()=>({environments:[{id}]});m.stopOtherEnvironments=async()=>seen.push('others');m.stopDirectTasks=async p=>seen.push(p);m.start=async()=>seen.push('start');m.select=async()=>seen.push('select');
 await m.activate('owner',id);assert.deepEqual(seen,['others',resourcePrefix('owner',id),'start','select']);
 m.stopDirectTasks=async()=>{throw Error('cleanup failed');};seen.length=0;await assert.rejects(m.activate('owner',id),/cleanup failed/);assert.deepEqual(seen,['others']);
});
test('cleanup rejects new direct/proxy launchers while pending and invalidates suspended preparation',async()=>{
 const m=manager();m.exec=async()=> 'http://fixture';const proxy=await m.spawner('owner','id');
 let release;const gate=new Promise(r=>release=r);m.directTasks=new Map([['task',{prefix,cancel:()=>gate}]]);
 const stopping=m.stopDirectTasks(prefix);
 await assert.rejects(m.directChatSpawner('owner','id'),/停止或切换/);
 await assert.rejects(m.spawner('owner','id'),/停止或切换/);
 assert.throws(()=>proxy({command:'node',args:[]}),/停止或切换/);
 let resume;const get=new Promise(r=>resume=r);m.get=async()=>{await get;return {prefix,item:{}};};
 const preparing=m.directChatSpawner('owner','id');release();await stopping;resume();await assert.rejects(preparing,/停止或切换/);
});
test('proxy preparation crossing a stop cannot return a stale launcher',async()=>{
 const m=manager();let release;m.exec=()=>new Promise(r=>release=r);
 const pending=m.spawner('owner','id');while(!release)await new Promise(r=>setImmediate(r));
 await m.stopDirectTasks(prefix);release('http://fixture');await assert.rejects(pending,/停止或切换/);
});
test('installer is registered before run and switch cleanup cancels it without reporting success',async()=>{
 const m=manager();let finish,name,exists=false;const calls=[];
 m.command=async a=>{calls.push(a);if(a[0]==='run'){name=a[a.indexOf('--name')+1];exists=true;return new Promise(r=>finish=r);}
  if(a[0]==='inspect'){if(!exists)throw Error('missing');return JSON.stringify({Id:'installer-id',Config:{Labels:{app:'dingtu-installer','io.kuneco.environment':prefix}}});}
  if(a[0]==='ps')return exists?(a.includes('{{.Names}}')?name:'installer-id'):'';
  if(a[0]==='stop'){exists=false;finish('');}return '';};
 const installing=m.runRuntimeInstaller('owner','id',['node','--version']);const rejected=assert.rejects(installing,/停止或切换/);
 while(!finish)await new Promise(r=>setImmediate(r));
 await m.stopDirectTasks(prefix);await rejected;
 assert.equal(m.directTasks.size,0);assert.ok(calls.find(a=>a[0]==='run').includes('io.kuneco.environment='+prefix));
 assert.ok(!calls.flat().includes('-v'));
});
test('installer cleanup failures are visible and retained for retry',async()=>{
 const m=manager();let fail=true;
 m.command=async a=>{if(a[0]==='run')return '';if(a[0]==='inspect')return JSON.stringify({Id:'installer-id',Config:{Labels:{app:'dingtu-installer','io.kuneco.environment':prefix}}});if(a[0]==='stop'&&fail)throw Error('cleanup unavailable');if(a[0]==='ps')return fail?'installer-id':'';return '';};
 await assert.rejects(m.runRuntimeInstaller('owner','id',['node','--version']),/cleanup unavailable/);assert.equal(m.directTasks.size,1);
 fail=false;await m.stopDirectTasks(prefix);assert.equal(m.directTasks.size,0);
});
test('failed cancellation waits for other tasks and keeps launches blocked until successful retry',async()=>{
 const m=manager();let release,fail=true,finished=false;
 const slow=new Promise(r=>release=r);
 m.directTasks=new Map([
  ['failed',{prefix,cancel:async()=>{if(fail)throw Error('first cleanup failed');}}],
  ['slow',{prefix,cancel:()=>slow}]
 ]);
 const stopping=m.stopDirectTasks(prefix);const rejected=assert.rejects(stopping,/first cleanup failed/);
 void stopping.then(()=>{finished=true;},()=>{finished=true;});
 await new Promise(r=>setImmediate(r));assert.equal(finished,false);assert.equal(m.directStops.has(prefix),true);
 await assert.rejects(m.directChatSpawner('owner','id'),/停止或切换/);
 release();await rejected;assert.equal(m.directTasks.has('slow'),false);assert.equal(m.directTasks.has('failed'),true);
 await assert.rejects(m.directChatSpawner('owner','id'),/清理未完成/);
 await assert.rejects(m.spawner('owner','id'),/清理未完成/);
 await assert.rejects(m.runRuntimeInstaller('owner','id',['node','--version']),/清理未完成/);
 fail=false;await m.stopDirectTasks(prefix);assert.equal(m.directTasks.size,0);
 assert.doesNotThrow(()=>m.taskLaunchGuard()(prefix));
});
test('one owned container cleanup failure does not skip other containers or installer reconciliation',async()=>{
 const m=manager(),seen=[];let fail=true;
 m.command=async a=>{
  if(a[0]==='ps'&&a.includes('label=app=dingtu-direct'))return 'bad\ngood';
  if(a[0]==='ps'&&a.includes('label=app=dingtu-installer'))return 'installer';
  if(a[0]==='inspect')return JSON.stringify({Id:a.at(-1),Config:{Labels:{app:a.at(-1)==='installer'?'dingtu-installer':'dingtu-direct','io.kuneco.environment':prefix}}});
  if(a[0]==='stop'){seen.push(a.at(-1));if(a.at(-1)==='bad'&&fail)throw Error('bad stop');}
  if(a[0]==='ps')return a.includes('id=bad')&&fail?'bad':'';
  return '';
 };
 await assert.rejects(m.stopDirectTasks(prefix),/bad stop/);assert.deepEqual(seen,['bad','good','installer']);
 assert.throws(()=>m.taskLaunchGuard()(prefix),/清理未完成/);
 fail=false;await m.stopDirectTasks(prefix);assert.doesNotThrow(()=>m.taskLaunchGuard()(prefix));
});
