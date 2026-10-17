import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Writable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {listCodexModels} from '../../../src/features/runtimes/codex-runner.mjs';
test('reads all pages, excludes hidden and retired models, keeps older selectable models',async()=>{
 const child=new EventEmitter();child.stdout=new PassThrough();child.kill=()=>{};const calls=[];
 child.stdin=new Writable({write(bytes,encoding,done){const msg=JSON.parse(bytes.toString());calls.push(msg);let result;
 if(msg.method==='initialize')result={};
 if(msg.method==='model/list')result=msg.params.cursor?{data:[{model:'older',displayName:'Older',upgradeInfo:{retirementAt:null}},{model:'hidden',hidden:true},{model:'retired',upgradeInfo:{retirementAt:'2020-01-01'}}],nextCursor:null}:{data:[{model:'latest'}],nextCursor:'page2'};
 if(result)queueMicrotask(()=>child.stdout.write(JSON.stringify({id:msg.id,result})+'\n'));done();}});
 const result=await listCodexModels('codex',null,()=>child);
 assert.deepEqual(result.map(x=>x.model),['latest','older']);assert.equal(calls.filter(x=>x.method==='model/list').length,2);assert.equal(calls[1].method,'initialized');
});

test('model reasoning capabilities come only from runtime descriptors',async()=>{
 const child=new EventEmitter();child.stdout=new PassThrough();child.kill=()=>{};
 child.stdin=new Writable({write(bytes,encoding,done){const msg=JSON.parse(bytes.toString());let result;
 if(msg.method==='initialize')result={};
 if(msg.method==='model/list')result={data:[
  {model:'capable',supportedReasoningEfforts:[{reasoningEffort:'low',description:'Quick'},{reasoningEffort:'high',description:'Thorough'},{reasoningEffort:'bad"value'}],defaultReasoningEffort:'high'},
  {model:'unknown',defaultReasoningEffort:'high'},
  {model:'inconsistent',supportedReasoningEfforts:[{reasoningEffort:'low'}],defaultReasoningEffort:'max'}
 ]};
 if(result)queueMicrotask(()=>child.stdout.write(JSON.stringify({id:msg.id,result})+'\n'));done();}});
 const result=await listCodexModels('codex',null,()=>child);
 assert.deepEqual(result[0].supportedReasoningEfforts,[{reasoningEffort:'low',description:'Quick'},{reasoningEffort:'high',description:'Thorough'}]);
 assert.equal(result[0].defaultReasoningEffort,'high');
 assert.deepEqual(result[1].supportedReasoningEfforts,[]);assert.equal(result[1].defaultReasoningEffort,null);
 assert.equal(result[2].defaultReasoningEffort,null);
});
