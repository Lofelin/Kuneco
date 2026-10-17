import test from 'node:test';
import assert from 'node:assert/strict';
import {DockerEnvironments,ContainerGateway} from '../../../src/features/environments/docker-environments.mjs';

function deferred(){let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};}
async function fixture(pausedStage,{running=false}={}){
  const entered=deferred(),paused=deferred(),calls=[];let runningChecks=0,current=true;
  const manager={
    get:async()=>({item:{}}),
    ensureGateway:async()=>({prefix:'fixture',name:'fixture-gateway',network:'fixture-net'}),
    rpc:async(_owner,_id,action)=>action==='connect'?{token:'fixture-token'}:{state:'ready',ip:'198.51.100.24'},
    command:async args=>{
      if(args.includes('{{json .NetworkSettings.Ports}}'))return '{"8080/tcp":[{"HostPort":"1234"}]}';
      if(args.some(value=>value.includes('IPAddress')))return '172.20.0.2';
      const stage=args[0]==='inspect'&&args.length===2?'inspect':args.includes('{{.State.Running}}')?(++runningChecks===1?'running':'final-running'):args[0];
      calls.push(stage);
      if(stage===pausedStage){entered.resolve();await paused.promise;}
      return stage==='running'?(running?'true':'false'):stage==='final-running'?'true':'';
    },
    exec:async()=>{calls.push('write-token');},
  };
  const gateway=await DockerEnvironments.prototype.connect.call(manager,'fixture-owner','fixture-id',{},null,async()=>{});
  return {gateway,entered,paused,calls,isCurrent:()=>current,invalidate:()=>{current=false;}};
}

for(const [stage,running] of [['inspect',false],['start',false],['running',true]]){
  test(`worker generation cancellation during ${stage} prevents subsequent startup mutations`,async()=>{
    const f=await fixture(stage,{running});
    const starting=f.gateway.startWorker({isCurrent:f.isCurrent});
    // Observe rejection before releasing the paused operation, avoiding a
    // transient unhandled rejection even when the guard throws immediately.
    const rejected=assert.rejects(starting);
    await f.entered.promise;const before=[...f.calls];f.invalidate();f.paused.resolve();await rejected;
    assert.deepEqual(f.calls,before,'no later command may be dispatched by an obsolete verification');
    assert.ok(!f.calls.includes('write-token'),'an obsolete gateway must not overwrite worker proxy credentials');
    if(stage!=='start')assert.ok(!f.calls.includes('start'),'do not start a worker after verification becomes stale');
    await f.gateway.stop();
  });
}

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
