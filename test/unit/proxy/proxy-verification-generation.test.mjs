import test from 'node:test';
import assert from 'node:assert/strict';
import {ProxyGateway} from '../../../src/features/proxy/proxy.mjs';

const ip='198.51.100.24';
const probe='http://verification.invalid/';
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
  const entered=deferred(),saved=deferred();let saves=0;
  const gateway=new ProxyGateway({protocol:'http',host:'127.0.0.1',port:1},{expectedIp:ip,onVerified:()=>{if(++saves===1){entered.resolve();return saved.promise;}}});
  // Isolate the asynchronous persistence boundary; no real network is accessed.
  gateway.readText=async()=>JSON.stringify({ip});
  return {gateway,entered,saved};
}

for(const generation of ['block','core']){
  for(const outcome of ['resolve','reject']){
    test(`verification ${outcome} from stale ${generation} generation cannot reopen or quarantine gateway`,async()=>{
      const {gateway,entered,saved}=fixture();
      try{
        const verifying=gateway.verify(probe);
        await entered.promise;
        if(generation==='core')gateway.coreGeneration++;
        const reason=generation==='core'?'new core awaiting verification':'offline signal paused traffic';
        if(generation==='core')gateway.update({state:'blocked',reason});
        else gateway.block(reason,{recoverable:true});
        if(outcome==='resolve')saved.resolve();else saved.reject(new Error('old persistence failed'));
        await verifying;
        assert.equal(gateway.status.state,'blocked');
        assert.equal(gateway.status.reason,reason,'stale persistence must not replace the newer lifecycle status');
        assert.equal(gateway.quarantined,false,'stale persistence errors must not quarantine the current lifecycle');
        assert.equal(gateway.status.ip,ip,'the fixed exit pin remains unchanged');
        assert.equal(gateway.verifying,null,'finished stale verification must relinquish its in-flight guard');
        const recovered=await gateway.verify(probe);
        assert.equal(recovered.state,'ready','a fresh explicit verification can recover the current lifecycle');
        assert.equal(recovered.ip,ip);
        assert.equal(recovered.verificationState,'verified');
      }finally{saved.resolve();await gateway.stop();}
    });
  }
}

test('current-generation persistence rejection still quarantines the gateway',async()=>{
  const {gateway,entered,saved}=fixture();
  try{
    const verifying=gateway.verify(probe);await entered.promise;
    saved.reject(new Error('current persistence failed'));await verifying;
    assert.equal(gateway.status.state,'blocked');assert.equal(gateway.quarantined,true);
    assert.match(gateway.status.reason,/固定出口记录保存失败/);
    assert.equal(gateway.status.ip,ip);
  }finally{saved.resolve();await gateway.stop();}
});
