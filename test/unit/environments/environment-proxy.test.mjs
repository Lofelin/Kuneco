import test from 'node:test';
import assert from 'node:assert/strict';
import {connectEnvironmentProxy} from '../../../src/features/environments/environment-proxy.mjs';
test('connects using target saved credentials and requires verified ready status',async()=>{
 const config={host:'192.0.2.1',password:'target-secret'};let received;
 const result=await connectEnvironmentProxy(config,{connect:async value=>{received=value;return {state:'ready'};},block:()=>assert.fail('unexpected block')});
 assert.deepEqual(received,config);assert.notEqual(received,config);assert.equal(result.state,'ready');assert.ok(!JSON.stringify(result).includes('target-secret'));
});
test('missing proxy never attempts a connection',async()=>{
 let reason;const result=await connectEnvironmentProxy({}, {connect:()=>assert.fail('unexpected connect'),block:value=>{reason=value;}});
 assert.equal(result.state,'unconfigured');assert.equal(reason,result.reason);
});
for(const mode of ['throw','blocked'])test('failed proxy '+mode+' remains blocked and returns a switch outcome',async()=>{
 let reason;const result=await connectEnvironmentProxy({host:'192.0.2.2'},{connect:async()=>{if(mode==='throw')throw new Error('连接超时');return {state:'blocked',reason:'出口不匹配'};},block:value=>{reason=value;}});
 assert.equal(result.state,'blocked');assert.equal(reason,result.reason);assert.match(reason,/自动连接失败/);
});

import {restoreSelectedEnvironment} from '../../../src/features/environments/environment-proxy.mjs';
test('startup resumes saved environment before connecting its proxy',async()=>{
 const calls=[];
 const result=await restoreSelectedEnvironment({owner:'owner',id:'saved',ensureEngine:async(o,id)=>calls.push(['engine',o,id]),activate:async(o,id)=>calls.push(['activate',o,id]),connectProxy:async()=>{calls.push(['proxy']);return {state:'ready'};}});
 assert.deepEqual(calls,[['engine','owner','saved'],['activate','owner','saved'],['proxy']]);assert.equal(result.state,'ready');
});
test('startup with no signed-in account or selected environment does nothing',async()=>{
 const unexpected=()=>assert.fail('unexpected startup operation');
 for(const context of [{owner:null,id:'saved'},{owner:'owner',id:null,localEnabled:false}]){
  assert.equal((await restoreSelectedEnvironment({...context,ensureEngine:unexpected,activate:unexpected,connectProxy:unexpected})).state,'skipped');
 }
});
test('startup activation failure prevents proxy connection',async()=>{
 await assert.rejects(restoreSelectedEnvironment({owner:'owner',id:'saved',ensureEngine:async()=>{},activate:async()=>{throw new Error('start failed');},connectProxy:()=>assert.fail('unexpected connection')}),/start failed/);
});
