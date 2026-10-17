import test from 'node:test';
import assert from 'node:assert/strict';
import {planImageCleanup,applyImageCleanup} from '../../../src/features/environments/image-maintenance.mjs';
const img=(n,kind='worker')=>({Id:'sha256:'+String(n).padStart(64,'0'),RepoTags:[`kuneco-${kind}:`+String(n).padStart(20,'0')],Created:`2026-10-${String(n).padStart(2,'0')}T00:00:00Z`,Size:100});
test('retains two latest of each kind, all container references and shared tags',()=>{
 const images=[img(1),img(2),img(3),img(4),img(5),img(6),img(7,'gateway'),img(8,'gateway'),img(9,'gateway')];
 images[1].RepoTags.push('unrelated:keep');
 images[2].RepoDigests=['example@sha256:abc'];
 const result=planImageCleanup(images,[{Image:images[3].Id}]);
 assert.deepEqual(result.candidates.map(i=>i.id),[images[0].Id,images[6].Id]);
 assert.equal(result.retained.length,7);
});
test('ignores foreign repositories, latest and malformed tags',()=>{
 const images=[img(1),img(2)];images.push({...img(3),RepoTags:['other:abc']},{...img(4),RepoTags:['kuneco-worker:latest']});
 assert.deepEqual(planImageCleanup(images,[]).candidates,[]);
});
function mock(images,containers=[],daemon='test') {
 const calls=[];
 return {calls,command:async args=>{
  calls.push(args);
  if(args[0]==='info')return daemon;
  if(args[0]==='ps')return containers.map((_,i)=>String(i)).join('\n');
  if(args[1]==='ls')return images.map(i=>i.Id).join('\n');
  if(args[0]==='container')return JSON.stringify([containers[Number(args[2])]]);
  if(args[1]==='inspect')return JSON.stringify(images.filter(i=>i.Id===args[2]));
  if(args[1]==='rm')return '';
  throw Error('unexpected');
 }};
}
test('apply revalidates references and skips a newly used candidate',async()=>{
 const images=[img(1),img(2),img(3)], preview={version:1,daemonId:'test',...planImageCleanup(images,[])};
 const m=mock(images,[{Image:images[0].Id}]);
 const result=await applyImageCleanup(m.command,preview);
 assert.equal(result.skipped.length,1);assert.equal(m.calls.some(a=>a[1]==='rm'),false);
});
test('apply deletes only reviewed immutable IDs without force or volume commands',async()=>{
 const images=[img(1),img(2),img(3)], preview={version:1,daemonId:'test',...planImageCleanup(images,[])};
 const m=mock(images);assert.equal((await applyImageCleanup(m.command,preview)).removed.length,1);
 assert.deepEqual(m.calls.filter(a=>a[1]==='rm'),[['image','rm',images[0].Id]]);
});
test('apply refuses a different daemon and an invalid preview',async()=>{
 const images=[img(1),img(2),img(3)],preview={version:1,daemonId:'other',...planImageCleanup(images,[])};
 await assert.rejects(applyImageCleanup(mock(images).command,preview),/daemon changed/);
 await assert.rejects(applyImageCleanup(mock(images).command,{}),/Invalid/);
});

test('same-repository local digest is eligible; foreign digest remains protected',()=>{
 const images=[img(1),img(2),img(3)];
 images[0].RepoDigests=['kuneco-worker@'+images[0].Id];
 assert.equal(planImageCleanup(images,[]).candidates.length,1);
 images[0].RepoDigests.push('shared@'+images[0].Id);
 assert.equal(planImageCleanup(images,[]).candidates.length,0);
});
