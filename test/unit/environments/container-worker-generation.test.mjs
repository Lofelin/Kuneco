import test from 'node:test';
import assert from 'node:assert/strict';
import {DockerEnvironments,ContainerGateway} from '../../../src/features/environments/docker-environments.mjs';

function deferred(){let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};}
test('worker startup cancellation prevents proxy credential writes',async()=>{
 const entered=deferred(),paused=deferred(),calls=[];let current=true;
 const manager=Object.assign(new DockerEnvironments({sourceRoot:process.cwd()}),{get:async()=>({item:{}}),ensureGateway:async()=>({prefix:'fixture',name:'fixture-gateway',network:'fixture-net'}),rpc:async()=>({token:'fixture-token'}),command:async args=>args.includes('{{json .NetworkSettings.Ports}}')?'\{"8080/tcp":[{"HostPort":"1234"}]}':'172.20.0.2',prepareWorker:async({assertCurrent})=>{entered.resolve();await paused.promise;assertCurrent();},exec:async()=>calls.push('write-token')});
 const gateway=await DockerEnvironments.prototype.connect.call(manager,'owner','11111111-1111-1111-1111-111111111111',{},null);
 const starting=gateway.startWorker({isCurrent:()=>current});const rejected=assert.rejects(starting);
 await entered.promise;current=false;paused.resolve();await rejected;assert.deepEqual(calls,[]);
});

test('container verification supplies a live generation guard to worker startup',async()=>{
  const pending=deferred(),entered=deferred();let isCurrent;
  const manager={rpc:async()=>({state:'ready',ip:'198.51.100.24'})};
  const gateway=new ContainerGateway(manager,'fixture-owner','fixture-id',1234,'fixture-token',async()=>{});
  gateway.startWorker=async options=>{isCurrent=options?.isCurrent;entered.resolve();await pending.promise;};
  const verifying=gateway.verify();await entered.promise;
  assert.equal(typeof isCurrent,'function');assert.equal(isCurrent(),true);
  await gateway.stop();assert.equal(isCurrent(),false,'stop invalidates the guard held by an in-flight worker startup');
  pending.resolve();await verifying;assert.equal(gateway.status.state,'blocked');
});
