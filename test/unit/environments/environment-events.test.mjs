import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {EnvironmentEvents,observeEnvironmentOperations,observeRuntimeLaunch} from '../../../src/features/environments/environment-events.mjs';
const settle=()=>new Promise(r=>setTimeout(r,30));
async function fixture(t){const directory=await mkdtemp(path.join(tmpdir(),'kuneco-events-'));t.after(()=>rm(directory,{recursive:true,force:true}));return {directory,encrypt:v=>Buffer.from(v),decrypt:v=>v.toString()};}
test('history survives restart, isolates accounts/environments and redacts credentials',async t=>{
 const options=await fixture(t),journal=new EnvironmentEvents(options),entry={source:'代理连接与核验',message:'password=secret https://user:pass@host INFO'};
 await Promise.all([journal.record('a','one',entry),journal.record('a','two',{source:'x',message:'different'}),journal.record('b','one',{source:'x',message:'other owner'})]);
 const restored=new EnvironmentEvents(options),rows=await restored.read('a','one');assert.equal(rows.length,1);assert.ok(!rows[0].message.includes('secret'));assert.ok(!rows[0].message.includes('user:pass'));
 const received=[];const stop=restored.subscribe('a','one',rows=>received.push(...rows));await settle();
 await restored.record('a','one',{source:'服务健康',message:'healthy'},'health');await restored.record('a','one',{source:'服务健康',message:'healthy'},'health');await restored.record('a','one',{source:'服务健康',level:'ERROR',message:'unhealthy'},'health');
 await restored.record('b','one',{source:'x',message:'invisible'});
 assert.equal(received.length,3);assert.equal(received.at(-1).level,'ERROR');stop();await restored.record('a','one',{source:'x',message:'after-close'});assert.equal(received.length,3);
});
test('operation failures preserve thrown errors and captured environment without recording config',async t=>{
 const journal=new EnvironmentEvents(await fixture(t)),error=new Error('install failed password=secret'),manager={installRuntime:async()=>{throw error;},create:async()=> 'created'};
 observeEnvironmentOperations(manager,journal,()=>({id:'initiator'}));
 await assert.rejects(manager.installRuntime('a','one','codex',{apiKey:'never-record'}),e=>e===error);
 const rows=await journal.read('a','one');assert.equal(rows.length,2);assert.equal(rows[1].level,'ERROR');assert.ok(!JSON.stringify(rows).includes('never-record'));assert.ok(!JSON.stringify(rows).includes('secret'));
 await manager.create('a','New name');assert.equal((await journal.read('a','created'))[0].message,'Environment creation completed');
});
test('runtime startup/exit failure records metadata only and ignores requested cancellation',async t=>{
 const journal=new EnvironmentEvents(await fixture(t)),child=new EventEmitter(),controller=new AbortController();
 const launch=observeRuntimeLaunch(()=>child,{journal,owner:'a',id:'one',engine:'codex',signal:controller.signal});
 launch({args:['private prompt']});child.emit('error',Object.assign(new Error('private prompt'),{code:'ENOENT'}));child.emit('close',127);await journal.flush();
 let rows=await journal.read('a','one');assert.equal(rows.length,2);assert.match(rows[0].message,/ENOENT/);assert.ok(!JSON.stringify(rows).includes('private prompt'));
 controller.abort();child.emit('close',1);await journal.flush();assert.equal((await journal.read('a','one')).length,2);
});
test('replayed health checks retain completion time and deduplicate across journal restarts',async t=>{
 const options=await fixture(t),entry={eventId:'worker:health:check-1',time:'2026-10-18T00:00:00.000Z',source:'Service health',level:'DEBUG',message:'Worker container health check completed · result=passed'};
 await new EnvironmentEvents(options).record('a','one',entry);
 const journal=new EnvironmentEvents(options);await journal.record('a','one',entry);const rows=await journal.read('a','one');assert.equal(rows.length,1);assert.equal(rows[0].time,entry.time);
});
test('cleanup removes expired inactive files, retains all unexpired records, and preserves unrelated files',async t=>{
 const options=await fixture(t);let settings={environmentLogAutoClean:false,environmentLogRetentionDays:1,environmentLogMaxEntries:500};
 const journal=new EnvironmentEvents({...options,getPreferences:()=>settings});
 const old=new Date(Date.now()-2*86400000).toISOString(),recent=new Date().toISOString();
 await journal.record('a','old',{message:'expired',time:old});await journal.record('b','keep',{message:'recent',time:recent});
 const {writeFile,readFile,readdir}=await import('node:fs/promises');await writeFile(path.join(options.directory,'unrelated.txt'),'keep');
 assert.equal((await journal.read('a','old')).length,1);
 assert.equal((await journal.cleanup()).removed,0);
 const result=await journal.cleanup({manual:true});assert.equal(result.removed,1);assert.equal((await journal.read('a','old')).length,0);assert.equal((await journal.read('b','keep')).length,1);assert.equal(await readFile(path.join(options.directory,'unrelated.txt'),'utf8'),'keep');assert.ok(!(await readdir(options.directory)).includes(journal.key('a','old')+'.bin'));
 const key=journal.key('a','many');await journal.writeKey(key,Array.from({length:12000},(_,i)=>({eventId:String(i),time:recent,message:String(i)})));
 await Promise.all([journal.cleanup(),journal.record('a','many',{eventId:'latest',time:recent,message:'latest'})]);
 const rows=await journal.read('a','many');assert.equal(rows.length,12001);assert.equal(rows.at(-1).message,'latest');assert.equal(rows[0].message,'0');const replayed=[];const unsubscribe=journal.subscribe('a','many',batch=>replayed.push(...batch));await settle();unsubscribe();assert.equal(replayed.length,12001);
 settings={...settings,environmentLogAutoClean:true};await journal.record('a','expired',{message:'too old',time:old});assert.equal((await journal.read('a','expired')).length,0);
});
test('changing retention days keeps all entries within that selected window',async t=>{
 let policy={environmentLogAutoClean:false,environmentLogRetentionDays:30};const journal=new EnvironmentEvents({...await fixture(t),getPreferences:()=>policy});
 for(const days of [2,10,40])await journal.record('a','one',{message:String(days),time:new Date(Date.now()-days*86400000).toISOString()});
 policy={...policy,environmentLogAutoClean:true};assert.deepEqual((await journal.read('a','one')).map(r=>r.message),['2','10']);
 policy.environmentLogRetentionDays=90;assert.equal((await journal.read('a','one')).length,3);
 policy.environmentLogRetentionDays=7;assert.deepEqual((await journal.read('a','one')).map(r=>r.message),['2']);
 policy.environmentLogRetentionDays=1;assert.equal((await journal.read('a','one')).length,0);
});
