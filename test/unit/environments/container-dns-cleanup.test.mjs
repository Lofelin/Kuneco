import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {directDNSRelay} from '../../../src/features/chat/container-chat-network.mjs';
test('direct DNS TCP relay closes both sockets on peer closure and idle timeout',()=>{
 for(const trigger of ['client','upstream','timeout']){
  let accept,timeout;
  const socket=()=>Object.assign(new EventEmitter(),{destroyed:false,pipe(other){return other;},destroy(){this.destroyed=true;},setTimeout(ms,fn){assert.equal(ms,10000);timeout=fn;}});
  const client=socket(),upstream=socket();const listener=()=>Object.assign(new EventEmitter(),{listen(){},bind(){}});
  vm.runInNewContext(directDNSRelay,{process:{argv:['node','192.0.2.1'],exit(){throw Error('unexpected exit');}},setTimeout,clearTimeout,require:name=>({fs:{},dgram:{createSocket:listener},net:{connect:()=>upstream,createServer:fn=>{accept=fn;return listener();}}})[name]});
  accept(client);if(trigger==='timeout')timeout();else (trigger==='client'?client:upstream).emit('close');
  assert.equal(client.destroyed,true);assert.equal(upstream.destroyed,true);
 }
});
