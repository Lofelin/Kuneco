import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureAccountBackend} from '../../../src/app/start-backend.mjs';
test('reuse ready backend without launching another process',async()=>{
 const result=await ensureAccountBackend({probe:async()=>true,launch:()=>assert.fail('must not launch')});assert.equal(result.reused,true);
});
test('wait for newly started backend readiness',async()=>{
 let probes=0,launches=0;
 const result=await ensureAccountBackend({probe:async()=>++probes===3,launch:async()=>{launches++;return {pid:123,logPath:'test.log',error:()=>null};},pollMs:1});
 assert.equal(result.started,true);assert.equal(launches,1);assert.equal(probes,3);
});
test('surface backend process failure instead of opening desktop',async()=>{
 await assert.rejects(ensureAccountBackend({probe:async()=>false,launch:async()=>({error:()=> 'exit 1',logPath:'test.log'})}),/exit 1.*test.log/);
});
test('remote account server does not start local backend',async()=>{
 const result=await ensureAccountBackend({serverURL:'https://accounts.example.com',probe:()=>assert.fail('no local probe'),launch:()=>assert.fail('no launch')});assert.equal(result.external,true);
});
