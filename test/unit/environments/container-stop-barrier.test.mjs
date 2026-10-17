import test from 'node:test';
import assert from 'node:assert/strict';
import {DockerEnvironments,resourcePrefix} from '../../../src/features/environments/docker-environments.mjs';
const owner='stop-fixture',id='11111111-1111-1111-1111-111111111111',prefix=resourcePrefix(owner,id);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 const m=new DockerEnvironments({sourceRoot:process.cwd()}),calls=[];let container;
 m.get=async()=>({prefix,item:{imageName:'fixture:base'}});m.state=async()=>({});m.rpc=async()=>({});
 m.command=async a=>{
  calls.push(a);
  if(a[0]==='image')return a.includes('{{json .}}')?JSON.stringify({Id:'sha256:fixture',Architecture:'arm64'}):'{}';
  if(a[0]==='network'&&a[1]==='inspect')return JSON.stringify({Internal:true,Driver:'bridge',Labels:{app:'dingtu'}});
  if(a[0]==='inspect'){if(!container)throw Error('absent');return a.includes('{{.State.Running}}')?'false':JSON.stringify(container);}
  if(a[0]==='ps'&&a.includes('--filter'))return '';
  if(a[0]==='ps')return container?prefix+'-gateway':'';
  if(a[0]==='run'){container={Id:'new-gateway',Config:{Labels:{'io.kuneco.creation-attempt':a.find(v=>v.startsWith('io.kuneco.creation-attempt=')).split('=')[1]}}};}
  if(a[0]==='rm')container=null;
  return '';
 };
 return {m,calls};
}
test('stop waits for image preparation and invalidates it before Docker creates a gateway',async()=>{
 const {m,calls}=fixture(),entered=deferred(),release=deferred(),command=m.command;
 m.command=async a=>{if(a[0]==='image'&&a.includes('{{json .}}')){entered.resolve();await release.promise;}return command(a);};
 const preparing=m.ensureGateway(owner,id),rejected=assert.rejects(preparing,/停止或切换/);await entered.promise;
 let stopped=false;const stop=m.stop(owner,id).then(()=>{stopped=true;});await new Promise(r=>setImmediate(r));
 assert.equal(stopped,false);await assert.rejects(m.ensureGateway(owner,id),/停止或切换/);
 release.resolve();await Promise.all([stop,rejected]);assert.ok(!calls.some(a=>a[0]==='run'));
});
test('stop waits for an in-flight Docker create and cleanup removes only its attempt',async()=>{
 const {m,calls}=fixture(),entered=deferred(),release=deferred(),command=m.command;
 m.command=async a=>{if(a[0]==='run'){entered.resolve();await release.promise;}return command(a);};
 const preparing=m.ensureGateway(owner,id),rejected=assert.rejects(preparing,/停止或切换/);await entered.promise;
 let stopped=false;const stop=m.stop(owner,id).then(()=>{stopped=true;});await new Promise(r=>setImmediate(r));assert.equal(stopped,false);
 release.resolve();await Promise.all([stop,rejected]);assert.ok(calls.some(a=>a[0]==='rm'&&a.at(-1)==='new-gateway'));assert.ok(!calls.some(a=>a[0]==='network'&&a[1]==='connect'));assert.ok(!calls.flat().includes('-v'));
});
test('stop barrier covers container shutdown and failure stays blocked until a successful retry',async()=>{
 const {m}=fixture(),entered=deferred(),release=deferred();let fail=true;
 m.stopDirectTasks=async()=>{};
 m.command=async a=>{if(a[0]==='ps')return prefix+'-worker';if(a[0]==='stop'){entered.resolve();await release.promise;if(fail)throw Error('stop failed');}return 'false';};
 const stale=m.taskLaunchGuard(),stop=m.stop(owner,id),rejected=assert.rejects(stop,/stop failed/);await entered.promise;
 assert.throws(()=>m.taskLaunchGuard()(prefix),/停止或切换/);release.resolve();await rejected;
 assert.throws(()=>m.taskLaunchGuard()(prefix),/清理未完成/);fail=false;await m.stop(owner,id);assert.doesNotThrow(()=>m.taskLaunchGuard()(prefix));assert.throws(()=>stale(prefix),/停止或切换/);
});
test('external stop invalidates old tasks and stops on its endpoint without deleting foreign containers',async()=>{
 const {m,calls}=fixture(),cleaned=[];m.get=async()=>({prefix,item:{external:{id:'foreign-id',endpoint:'unix:///fixture.sock'}}});m.stopDirectTasks=async p=>cleaned.push(p);
 m.command=async(a,options)=>{calls.push([a,options]);return a[0]==='ps'?'foreign-id':a[0]==='inspect'?'false':'';};const stale=m.taskLaunchGuard();await m.stop(owner,id);
 assert.deepEqual(cleaned,[prefix]);assert.throws(()=>stale(prefix),/停止或切换/);assert.ok(calls.some(([a,o])=>a[0]==='stop'&&a.at(-1)==='foreign-id'&&o.endpoint==='unix:///fixture.sock'));assert.ok(!calls.some(([a])=>a[0]==='rm'));
});
test('worker preparation held across environment stop cannot publish credentials or finish late',async()=>{
 const {m,calls}=fixture(),entered=deferred(),release=deferred();
 m.ensureGateway=async()=>({prefix,name:prefix+'-gateway',network:prefix+'-private'});
 m.command=async a=>a.includes('{{json .NetworkSettings.Ports}}')?JSON.stringify({'8080/tcp':[{HostPort:'1234'}]}):a[0]==='inspect'?'172.20.0.2':'';
 m.prepareWorker=async({assertCurrent})=>{entered.resolve();await release.promise;assertCurrent();};m.exec=async()=>calls.push(['write-credentials']);
 const adapter=await m.connect(owner,id,{},null),preparing=adapter.startWorker(),rejected=assert.rejects(preparing,/停止或切换/);await entered.promise;
 let stopped=false;const stop=m.stop(owner,id).then(()=>{stopped=true;});await new Promise(r=>setImmediate(r));assert.equal(stopped,false);
 release.resolve();await Promise.all([stop,rejected]);assert.deepEqual(calls,[]);await assert.rejects(adapter.startWorker(),/停止或切换/);
});
test('upgrade rollback restores the old gateway name but does not restart it after stop',async()=>{
 const {m,calls}=fixture(),entered=deferred(),release=deferred(),command=m.command;let replacement=false;
 const old={Id:'old-gateway',Config:{Image:'old',Labels:{app:'dingtu'}},State:{Running:true},Mounts:[],NetworkSettings:{Networks:{bridge:{},[prefix+'-private']:{IPAddress:'172.20.0.2'}}}};
 m.command=async a=>{
  if(a[0]==='inspect'&&a.includes('{{json .}}')&&!replacement){calls.push(a);return JSON.stringify(old);}
  if(a[0]==='run'){entered.resolve();await release.promise;replacement=true;}
  return command(a);
 };
 const preparing=m.ensureGateway(owner,id),rejected=assert.rejects(preparing,/停止或切换/);await entered.promise;
 const stopping=m.stop(owner,id);release.resolve();await Promise.all([stopping,rejected]);
 assert.ok(calls.some(a=>a[0]==='rename'&&a.at(-1)===prefix+'-gateway'));assert.ok(!calls.some(a=>a[0]==='start'));
});
test('external startup already in Docker is awaited and stopped before environment stop returns',async()=>{
 const {m,calls}=fixture(),entered=deferred(),release=deferred();let running=false;
 m.get=async()=>({prefix,item:{external:{id:'foreign-id',endpoint:'unix:///fixture.sock'}}});m.stopDirectTasks=async()=>{};
 m.command=async(a,options)=>{calls.push([a,options]);if(a[0]==='start'){entered.resolve();await release.promise;running=true;}if(a[0]==='stop')running=false;return a[0]==='ps'?'foreign-id':a[0]==='inspect'?String(running):'';};
 const starting=m.start(owner,id),rejected=assert.rejects(starting,/停止或切换/);await entered.promise;
 let stopped=false;const stopping=m.stop(owner,id).then(()=>{stopped=true;});await new Promise(r=>setImmediate(r));assert.equal(stopped,false);
 release.resolve();await Promise.all([stopping,rejected]);assert.equal(running,false);assert.ok(!calls.some(([a])=>a[0]==='rm'));
});
test('external stop cancels tracked tasks without depending on the managed engine',async()=>{
 const {m}=fixture(),external={id:'a'.repeat(64),endpoint:'unix:///external-only.sock'};let cancelled=false;const seen=[];
 m.get=async()=>({prefix,item:{external}});m.directTasks=new Map([['tracked',{prefix,cancel:async()=>{cancelled=true;}}]]);
 m.command=async(a,o={})=>{assert.equal(o.endpoint,external.endpoint,'must never query the managed engine');seen.push(a);return a[0]==='ps'?external.id:a[0]==='inspect'?'false':'';};
 await m.stop(owner,id);assert.equal(cancelled,true);assert.equal(m.directTasks.size,0);assert.ok(seen.some(a=>a[0]==='ps'&&a.includes('--no-trunc')&&a.includes('{{.ID}}')));assert.ok(seen.some(a=>a[0]==='stop'&&a.at(-1)===external.id));
});
test('confirmed absent external container does not block switching and partial IDs never match',async()=>{
 const {m}=fixture(),external={id:'a'.repeat(64),endpoint:'unix:///external-only.sock'},seen=[];m.load=async()=>({environments:[{id,external}]});
 m.command=async(a,o)=>{assert.equal(o.endpoint,external.endpoint);seen.push(a);if(a[0]!=='ps')assert.fail('absent external container must not be stopped');return external.id.slice(0,12);};
 const stale=m.taskLaunchGuard();await m.stopOtherEnvironments(owner,null);assert.equal(seen.length,1);assert.throws(()=>stale(prefix),/停止或切换/);
});
test('external daemon listing failure stays visible and blocks startup until retry',async()=>{
 const {m}=fixture(),external={id:'b'.repeat(64),endpoint:'unix:///external-only.sock'};let unavailable=true;
 m.get=async()=>({prefix,item:{external}});m.command=async()=>{if(unavailable)throw Error('external daemon unavailable');return '';};
 await assert.rejects(m.stop(owner,id),/external daemon unavailable/);assert.throws(()=>m.taskLaunchGuard()(prefix),/清理未完成/);
 unavailable=false;await m.stop(owner,id);assert.doesNotThrow(()=>m.taskLaunchGuard()(prefix));
});
test('reactivating an external environment reconciles its tracked tasks without managed scans',async()=>{
 const {m}=fixture(),external={id:'c'.repeat(64),endpoint:'unix:///external-only.sock'},seen=[];m.load=async()=>({environments:[{id,external}]});
 m.stopOtherEnvironments=async()=>{};m.start=async()=>seen.push('start');m.select=async()=>seen.push('select');m.command=async()=>assert.fail('no managed engine request');
 m.directTasks=new Map([['tracked',{prefix,cancel:async()=>seen.push('cancel') }]]);
 await m.activate(owner,id);assert.deepEqual(seen,['cancel','start','select']);assert.equal(m.directTasks.size,0);
});
