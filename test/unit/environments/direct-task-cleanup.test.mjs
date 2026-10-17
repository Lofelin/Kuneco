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
