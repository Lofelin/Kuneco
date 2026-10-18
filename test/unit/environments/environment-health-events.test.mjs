import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {observeEnvironmentHealth} from '../../../src/features/environments/environment-health-events.mjs';
test('health watcher captures initial state and scoped changes without output or foreign attributes',async()=>{
 const records=[],calls=[];const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.killed=true;};child.signalCode='SIGTERM';
 const journal={record:async(...args)=>records.push(args)};
 const docker={sourceRoot:'/tmp',endpoint:'scoped',context:'test',get:async()=>({item:{}}),binary:async()=>'/docker',command:async()=>JSON.stringify({Running:true,Health:{Status:'healthy',Log:[{Output:'secret'}]}})};
 const monitor=observeEnvironmentHealth({docker,owner:'a',id:'one',prefix:'scope',journal,launch:(_binary,args)=>{calls.push(args);return child;}});
 await monitor.ready;assert.equal(records.length,2);assert.ok(calls[0].includes('container=scope-worker'));
 const event=(name,action)=>JSON.stringify({Action:action,Actor:{Attributes:{name,secret:'never'}}})+'\n';
 child.stdout.write(event('scope-worker','health_status: unhealthy'));child.stdout.write(event('foreign-worker','health_status: unhealthy'));assert.equal(records.length,3);assert.equal(records[2][2].level,'ERROR');assert.ok(!JSON.stringify(records).includes('secret'));
 monitor.stop();child.stdout.write(event('scope-worker','health_status: healthy'));assert.equal(records.length,3);assert.ok(child.killed);
});
test('completed checks produce DEBUG once, preserve failed exit codes, and stop collecting',async()=>{
 const records=[];let calls=0,checks=[];
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};child.signalCode='SIGTERM';
 const docker={sourceRoot:'/tmp',endpoint:'scoped',get:async()=>({item:{external:{id:'one'}}}),binary:async()=>'/docker',command:async()=>{calls++;return JSON.stringify({Running:true,Health:{Status:'healthy',Log:checks}});}};
 const monitor=observeEnvironmentHealth({docker,owner:'a',id:'one',journal:{record:async(...args)=>records.push(args)},launch:()=>child,checkIntervalMs:10});
 try{
  await monitor.ready;assert.equal(records.filter(r=>r[2].level==='DEBUG').length,0);
  checks=[{Start:'2026-10-18T00:00:00.000Z',End:'2026-10-18T00:00:00.100Z',ExitCode:0,Output:'private token'}];
  await new Promise(r=>setTimeout(r,45));assert.equal(records.filter(r=>r[2].level==='DEBUG').length,1);
  checks.push({Start:'2026-10-18T00:00:01.000Z',End:'2026-10-18T00:00:01.200Z',ExitCode:1,Output:'private token'});
  await new Promise(r=>setTimeout(r,35));const debug=records.filter(r=>r[2].level==='DEBUG');assert.equal(debug.length,2);assert.match(debug[1][2].message,/result=failed.*exit_code=1/);assert.match(debug[0][2].message,/duration_ms=100/);assert.ok(!JSON.stringify(records).includes('private token'));
  monitor.stop();const before=calls;await new Promise(r=>setTimeout(r,35));assert.equal(calls,before);
 }finally{monitor.stop();}
});
test('disabling health DEBUG keeps health transition alerts',async()=>{
 const rows=[];const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};child.signalCode='SIGTERM';
 const docker={sourceRoot:'/tmp',endpoint:'scoped',get:async()=>({item:{external:{id:'one'}}}),binary:async()=>'/docker',command:async()=>JSON.stringify({Running:true,Health:{Status:'healthy',Log:[{Start:'2026-10-18T00:00:00Z',End:'2026-10-18T00:00:01Z',ExitCode:0}]}})};
 const monitor=observeEnvironmentHealth({docker,owner:'a',id:'one',journal:{record:async(...args)=>rows.push(args[2])},launch:()=>child,getPreferences:()=>({environmentHealthDebug:false})});
 try{await monitor.ready;assert.ok(!rows.some(row=>row.level==='DEBUG'));child.stdout.write(JSON.stringify({Action:'health_status: unhealthy',Actor:{ID:'one'}})+'\n');assert.ok(rows.some(row=>row.level==='ERROR'));}finally{monitor.stop();}
});
