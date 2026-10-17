import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {nextRuns,validateSchedule} from '../../../src/features/automation/automation-schedule.mjs';import {learningQuestions} from '../../../src/features/automation/learning-library.mjs';import {LearningAutomations} from '../../../src/features/automation/learning-automation.mjs';
const schedule={mode:'fixed',time:'09:00',days:[1,2,3,4,5],timeZone:'America/New_York'};
test('library has 56 unique bilingual sequential questions',()=>{assert.equal(learningQuestions('all').length,56);for(const l of ['zh','en']){const qs=learningQuestions(l);assert.equal(qs.length,28);assert.deepEqual(qs.map(q=>q.step),Array.from({length:28},(_,i)=>i+1));}assert.equal(new Set(learningQuestions('all').map(q=>q.id)).size,56);});
test('fixed and interval times respect timezone, weekdays and time windows',()=>{
 assert.equal(new Date(nextRuns(schedule,Date.parse('2026-10-16T14:00Z'),1)[0]).toISOString(),'2026-10-19T13:00:00.000Z');
 const s={...schedule,mode:'interval',start:'09:00',end:'11:00',minutes:60};assert.deepEqual(nextRuns(s,Date.parse('2026-10-19T12:59Z')).map(t=>new Date(t).toISOString()),['2026-10-19T13:00:00.000Z','2026-10-19T14:00:00.000Z','2026-10-19T15:00:00.000Z']);
 assert.equal(new Date(nextRuns(schedule,Date.parse('2026-11-01T00:00Z'),1)[0]).toISOString(),'2026-11-02T14:00:00.000Z');
 assert.throws(()=>validateSchedule({...schedule,days:[]}));assert.throws(()=>validateSchedule({...s,minutes:0}));assert.throws(()=>validateSchedule({...s,end:'08:00'}));
});
test('scheduler isolates context, does not overlap, preserves failed question, persists and skips missed runs',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dingtu-learning-'));let current={owner:'a',environmentId:'env'},calls=0,fail=true,release;
 const store=new LearningAutomations({file:path.join(dir,'jobs.json'),context:()=>current,execute:async()=>{calls++;if(fail)throw new Error('proxy unavailable');await new Promise(r=>release=r);return{text:'lesson',sessionId:'session',ip:'203.0.113.1'};}});
 try{await store.load();const item=await store.create({engine:'codex',language:'zh',schedule});item.nextAt=Date.now()-1000;
 current={owner:'b',environmentId:'env'};await store.tick();assert.equal(calls,0);assert.deepEqual(store.list(),[]);current={owner:'a',environmentId:'env'};
 await store.tick();assert.equal(item.cursor,0);assert.equal(item.status,'failed');assert.ok(item.nextAt>Date.now());fail=false;item.nextAt=Date.now()-1000;
 const running=store.tick();while(!release)await new Promise(r=>setTimeout(r,1));await store.tick();assert.equal(calls,2);release();await running;assert.equal(item.cursor,1);assert.equal(item.sessionId,'session');assert.equal(item.history[0].answer,'lesson');
 await store.change(item.id,'rename',{name:'我的任务'});assert.equal(item.name,'我的任务');await assert.rejects(store.change(item.id,'rename',{name:'  '}));await store.change(item.id,'toggle');assert.equal(item.enabled,false);store.stop();const restored=new LearningAutomations({file:store.file,context:()=>current,execute:()=>assert.fail('must not replay')});await restored.load();assert.equal(restored.list()[0].name,'我的任务');assert.equal(restored.list()[0].cursor,1);assert.equal(restored.list()[0].enabled,false);restored.stop();
 }finally{store.stop();await rm(dir,{recursive:true,force:true});}
});
test('automation persists explicit direct routing and defaults old callers to proxy',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kuneco-learning-network-'));const context=()=>({owner:'a',environmentId:'env'});const store=new LearningAutomations({file:path.join(dir,'jobs.json'),context,execute:async item=>{assert.equal(item.networkMode,'direct');return{text:'ok'};}});let restored;
 try{const direct=await store.create({engine:'codex',language:'zh',schedule,networkMode:'direct'});const proxy=await store.create({engine:'cc',language:'en',schedule});assert.equal(proxy.networkMode,'proxy');await assert.rejects(store.create({engine:'cc',language:'zh',schedule,networkMode:'invalid'}));direct.nextAt=Date.now()-1000;await store.tick();assert.equal(direct.cursor,1);restored=new LearningAutomations({file:store.file,context,execute:()=>assert.fail('unexpected execution')});await restored.load();assert.deepEqual(restored.list().map(i=>i.networkMode),['direct','proxy']);}finally{store.stop();restored?.stop();await rm(dir,{recursive:true,force:true});}
});
