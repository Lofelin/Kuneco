import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectContainer} from '../../../src/features/environments/container-reliability.mjs';
import {DockerEnvironments} from '../../../src/features/environments/docker-environments.mjs';
import {gatewayImage} from '../../../src/features/environments/gateway-image.mjs';
import {readFile} from 'node:fs/promises';

test('inspection failure distinguishes missing container from daemon or existing-container failure',async()=>{
 for(const listing of ['owned','daemon-error','']){
  const manager={command:async args=>{if(args[0]==='inspect')throw Error('inspect failed');if(listing==='daemon-error')throw Error('daemon unavailable');return listing;}};
  if(listing)await assert.rejects(inspectContainer(manager,'owned'),/failed|unavailable/);
  else assert.equal(await inspectContainer(manager,'owned'),null);
 }
});
test('same-environment gateway preparation is serialized and rejected attempt releases queue',async()=>{
 const manager=new DockerEnvironments({});let active=0,peak=0,calls=0;
 manager.prepareGateway=async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,10));active--;if(++calls===1)throw Error('first failed');return 'ok';};
 const id='11111111-1111-1111-1111-111111111111';
 const first=assert.rejects(manager.ensureGateway('owner',id),/first failed/);
 const second=manager.ensureGateway('owner',id);await first;assert.equal(await second,'ok');assert.equal(peak,1);assert.equal(manager.gatewayPreparations.size,0);
});
test('gateway image build uses inspected immutable base ID even when tag changes',async()=>{
 let dockerfile;
 const manager={sourceRoot:process.cwd(),command:async args=>{
  if(args[0]==='image' && args.includes('--format'))return JSON.stringify({Id:'sha256:fixture',Architecture:'arm64'});
  if(args[0]==='image')throw Error('not cached');
  if(args[0]==='build')dockerfile=await readFile(args.at(-1)+'/Dockerfile','utf8');
 }};
 await gatewayImage(manager,'mutable:latest','native');assert.ok(dockerfile.startsWith('FROM sha256:fixture\n'));
});
test('gateway inspection failure cannot reach creation or cleanup of existing container',async()=>{
 const manager=new DockerEnvironments({sourceRoot:process.cwd()}),calls=[];
 manager.get=async()=>({prefix:'fixture',item:{imageName:'base:1'}});
 manager.command=async args=>{
  calls.push(args);
  if(args[0]==='image')return args.includes('--format')?JSON.stringify({Id:'sha256:fixture',Architecture:'arm64'}):'cached';
  if(args[0]==='network')return '{}';
  if(args[0]==='inspect')throw Error('temporary inspect failure');
  if(args[0]==='ps')return 'fixture-gateway';
  throw Error('unexpected mutation');
 };
 await assert.rejects(manager.prepareGateway('owner','id'),/temporary inspect/);
 assert.ok(!calls.some(args=>['run','rm','rename','stop','start'].includes(args[0])));
});
