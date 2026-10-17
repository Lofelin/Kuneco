import test from 'node:test';import assert from 'node:assert/strict';import {once} from 'node:events';import {DockerEnvironments} from '../../../src/features/environments/docker-environments.mjs';
const prefix='dingtu-fixture',item={};
test('direct tasks use isolated transient execution while proxy tasks stay in the worker',async()=>{
 const m=new DockerEnvironments({sourceRoot:process.cwd()});const calls=[];m.get=async()=>({prefix,item});m.binary=async()=>'/usr/bin/true';m.exec=async()=> 'http://fixture';m.command=async args=>{calls.push(args);if(args[0]==='network')return JSON.stringify({Internal:false,Driver:'bridge',Labels:{app:'dingtu-direct','io.kuneco.environment':prefix}});if(args[0]==='image'&&args.includes('{{json .}}'))return JSON.stringify({Id:'sha256:fixture'});if(args.includes('{{.Id}}'))return 'a'.repeat(64);if(args[0]==='inspect')throw Error('missing');return '';};
 for(const [mode,spawn] of [['direct',await m.directChatSpawner('owner','env')],['proxy',await m.spawner('owner','env')]]){
  const c=spawn({command:'node',args:['--version']});assert.ok(c.spawnargs.includes('LANG=C.UTF-8'));assert.ok(c.spawnargs.includes('LC_ALL=C.UTF-8'));assert.equal(c.spawnargs.includes('run'),mode==='direct');assert.equal(c.spawnargs.includes('exec'),mode==='proxy');assert.ok(c.spawnargs.includes('1000:1000'));if(mode==='direct'){assert.ok(c.spawnargs.includes(prefix+'-direct-egress'));assert.ok(c.spawnargs.includes('--rm'));}else assert.ok(c.spawnargs.includes('a'.repeat(64)));await once(c,'close');
 }
 assert.ok(!calls.some(a=>a[0]==='network'&&a[1]==='connect'));
 m.exec=async()=>'';await assert.rejects(m.spawner('owner','env'),/代理尚未就绪/);
});
test('proxy reconnect keeps a running worker and updates gateway credentials without destroying temporary state',async()=>{
 const m=new DockerEnvironments({sourceRoot:process.cwd()});const calls=[],writes=[];m.get=async()=>({prefix,item});m.ensureGateway=async()=>({prefix,name:prefix+'-gateway',network:prefix+'-private'});m.rpc=async(_o,_i,action)=>action==='connect'?{token:'fixture-token'}:{};
 m.command=async args=>{calls.push(args);if(args.includes('{{json .NetworkSettings.Ports}}'))return JSON.stringify({'8080/tcp':[{HostPort:'1234'}]});if(args.includes('{{.State.Running}}'))return 'true';if(args.includes('--format'))return '172.19.0.2';return '{}';};m.exec=async(_o,_i,args,options)=>writes.push(options.input);m.prepareWorker=async({assertCurrent})=>assertCurrent();
 const adapter=await m.connect('owner','11111111-1111-1111-1111-111111111111',{host:'fixture'},null);await adapter.startWorker();await adapter.startWorker();assert.ok(!calls.some(a=>a[0]==='rm'||a[0]==='run'||a[0]==='start'));assert.equal(writes.length,2);assert.ok(writes.every(v=>v.includes('fixture-token@172.19.0.2')));
});
