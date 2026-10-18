import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {subscribeEnvironmentLogs} from '../../../src/features/environments/environment-log-stream.mjs';
const pause=()=>new Promise(resolve=>setTimeout(resolve,70));
function fixture(overrides={}){
 const calls=[],events=[],children=[];
 const docker={sourceRoot:'/tmp',endpoint:'scoped',context:'test',binary:async()=>'/docker',get:async()=>({item:{name:'test'}}),command:async(args)=>{calls.push(args);return JSON.stringify({Running:true,StartedAt:new Date().toISOString()});},...overrides};
 const launch=(binary,args,options)=>{calls.push(args);assert.equal(options.env.DOCKER_HOST,'');const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.exitCode=null;c.signalCode=null;c.kill=()=>{c.killed=true;c.signalCode='SIGTERM';c.emit('close',null);};children.push(c);return c;};
 const subscription=subscribeEnvironmentLogs({docker,owner:'a',id:'b',prefix:'owned',send:x=>events.push(x),launch});
 return {subscription,calls,events,children};
}
test('single follow replays history then appends decoded lines without re-fetching',async()=>{
 const f=fixture();await f.subscription.ready;
 assert.equal(f.children.length,2);assert.equal(f.calls.filter(a=>a[0]==='logs').length,0);
 assert.deepEqual(f.calls[1].slice(0,6),['--host','scoped','logs','--follow','--timestamps','--since']);assert.ok(Number.isFinite(Date.parse(f.calls[1][6])));assert.equal(f.calls[1].at(-1),'owned-worker');
 const c=f.children[0];c.stdout.write('2026-10-18T00:00:00Z INFO history\n');await pause();
 const chinese=Buffer.from('2026-10-18T00:00:01Z INFO 新日志 password=secret\n');
 c.stdout.write(chinese.subarray(0,30));c.stdout.write(chinese.subarray(30));c.stderr.write('2026-10-18T00:00:02Z ERROR tail');c.stderr.end();await pause();
 const rows=f.events.flatMap(e=>e.entries||[]);assert.equal(rows.length,3);assert.match(rows[1].message,/新日志/);assert.ok(!rows[1].message.includes('secret'));assert.deepEqual(rows.map(r=>r.sequence),[1,2,3]);
 f.subscription.stop();assert.ok(f.children.every(c=>c.killed));const count=f.events.length;c.stdout.write('late\n');await pause();assert.equal(f.events.length,count);
});
test('closing during asynchronous setup prevents starting a follower',async()=>{
 let release;const f=fixture({binary:()=>new Promise(r=>{release=r;})});await pause();f.subscription.stop();release('/docker');await f.subscription.ready;assert.equal(f.children.length,0);
});
test('external source uses registered endpoint and reports stream end',async()=>{
 const f=fixture({get:async()=>({item:{external:{id:'registered',endpoint:'remote'}}})});await f.subscription.ready;
 assert.equal(f.children.length,1);assert.equal(f.calls[1][1],'remote');assert.equal(f.calls[1].at(-1),'registered');
 f.children[0].emit('close',1);assert.ok(f.events.some(e=>e.state==='ended'));assert.ok(f.events.some(e=>e.notice));f.subscription.stop();
});
test('a burst above 1000 lines is delivered without dropping entries',async()=>{
 const f=fixture();await f.subscription.ready;try{f.children[0].stdout.write(Array.from({length:1500},(_,i)=>'2026-10-18T00:00:00Z INFO line '+i+'\n').join(''));await pause();const rows=f.events.flatMap(e=>e.entries||[]);assert.equal(rows.length,1500);assert.match(rows[0].message,/line 0$/);assert.match(rows.at(-1).message,/line 1499$/);}finally{f.subscription.stop();}
});
