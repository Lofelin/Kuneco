import test from 'node:test';
import assert from 'node:assert/strict';
import {validateContainerNetworks,ensurePrivateNetwork,removeAttemptContainer,ATTEMPT_LABEL} from '../../../src/features/environments/container-reliability.mjs';
const net=names=>({NetworkSettings:{Networks:Object.fromEntries(names.map(n=>[n,{}]))}});
test('worker and gateway reject missing or additional networks before reuse',()=>{
 validateContainerNetworks(net(['private']),'private');
 validateContainerNetworks(net(['private','bridge']),'private',{gateway:true});
 for(const names of [[],['bridge'],['private','bridge'],['private','other-account']])assert.throws(()=>validateContainerNetworks(net(names),'private'),/网络/);
 assert.throws(()=>validateContainerNetworks(net(['private','bridge','other-account']),'private',{gateway:true}),/网络/);
});
test('private network reuse fails closed on public network, foreign ownership or inspection outage',async()=>{
 for(const value of [{Internal:false,Driver:'bridge',Labels:{app:'dingtu'}},{Internal:true,Driver:'bridge',Labels:{}},null]){
  const calls=[];const manager={command:async a=>{calls.push(a);if(a[1]==='ls')return 'private';if(value===null)throw Error('inspect unavailable');return JSON.stringify(value);}};
  await assert.rejects(ensurePrivateNetwork(manager,'private'));
  assert.ok(!calls.some(a=>['create','rm','connect','disconnect'].includes(a[1])));
 }
});
test('failure cleanup only removes the immutable ID bearing this creation attempt label',async()=>{
 for(const own of [true,false]){
  const calls=[];const manager={command:async a=>{calls.push(a);return JSON.stringify({Id:'exact-id',Config:{Labels:{[ATTEMPT_LABEL]:own?'ours':'other'}}});}};
  if(own){await removeAttemptContainer(manager,'name','ours');assert.deepEqual(calls.at(-1),['rm','-f','exact-id']);}
  else{await assert.rejects(removeAttemptContainer(manager,'name','ours'),/保留/);assert.equal(calls.length,1);}
 }
});
test('gateway with persistent mounts is retained rather than silently upgraded',async()=>{
 const {DockerEnvironments}=await import('../../../src/features/environments/docker-environments.mjs');
 const manager=new DockerEnvironments({sourceRoot:process.cwd()}),calls=[];
 manager.get=async()=>({prefix:'fixture',item:{imageName:'base:1'}});
 manager.command=async a=>{
  calls.push(a);
  if(a[0]==='image')return a.includes('--format')?JSON.stringify({Id:'sha256:fixture',Architecture:'arm64'}):'cached';
  if(a[0]==='network')return JSON.stringify({Internal:true,Driver:'bridge',Labels:{app:'dingtu'}});
  if(a[0]==='inspect')return JSON.stringify({...net(['fixture-private','bridge']),Config:{Labels:{app:'dingtu'}},Mounts:[{Type:'volume',Name:'keep-data'}]});
  throw Error('unexpected mutation');
 };
 await assert.rejects(manager.prepareGateway('owner','id'),/额外数据挂载/);
 assert.ok(!calls.some(a=>['run','stop','rm','rename','start'].includes(a[0])));
});
