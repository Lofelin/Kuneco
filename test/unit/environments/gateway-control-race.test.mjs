import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';

const source=(await readFile(new URL('../../../docker/runtime/gateway.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 const instances=[],process=new EventEmitter();let serverClosed=false;
 class ProxyGateway {
  constructor(config){this.config=config;this.token=config.id;this.status={state:'blocked'};this.monitoring=0;this.stops=0;instances.push(this);}
  async start(){this.config.entered?.resolve();await this.config.start?.promise;this.listening=true;return this;}
  async stop(){this.stops++;this.listening=false;this.status={state:'blocked'};}
  block(){this.status={state:'blocked'};}
  async verify(){this.config.verifyEntered?.resolve();await this.config.verify?.promise;return this.status;}
  async detectRegion(){return 'US';}
  startMonitoring(){this.monitoring++;}
 }
 const http={createServer:()=>({listen(){},close(){serverClosed=true;},closeIdleConnections(){}})};
 const context=vm.createContext({ProxyGateway,http,process});
 vm.runInContext(source+'\nglobalThis.control=control;globalThis.drained=()=>mutations;',context);
 return {control:context.control,instances,process,drained:context.drained,closed:()=>serverClosed};
}
for(const action of ['stop','block'])test(`${action} invalidates a pending connect and drains its late listener`,async()=>{
 const f=fixture(),start=deferred(),entered=deferred();
 const connect=f.control('connect',{config:{id:'first',start,entered}});const rejected=assert.rejects(connect,/失效/);
 await entered.promise;const stop=f.control(action);start.resolve();await rejected;await stop;
 assert.equal(f.instances[0].listening,false);
 assert.equal((await f.control('status')).state,'blocked');
});
test('new connect supersedes pending connect and retains only the latest listener',async()=>{
 const f=fixture(),start=deferred(),entered=deferred();
 const first=f.control('connect',{config:{id:'first',start,entered}});const rejected=assert.rejects(first,/失效/);
 await entered.promise;const second=f.control('connect',{config:{id:'second'}});start.resolve();await rejected;
 assert.equal((await second).token,'second');assert.equal(f.instances[0].listening,false);assert.equal(f.instances[1].listening,true);
});
test('late verification cannot restart monitoring after stop or on a replacement gateway',async()=>{
 for(const action of ['stop','connect']){
  const f=fixture(),verify=deferred(),verifyEntered=deferred();
  await f.control('connect',{config:{id:'first',verify,verifyEntered}});
  const pending=f.control('verify');const rejected=assert.rejects(pending,/失效/);await verifyEntered.promise;
  await f.control(action,{config:{id:'second'}});verify.resolve();await rejected;
  assert.equal(f.instances[0].monitoring,0);assert.equal(f.instances.at(-1).monitoring,0);
 }
});
test('SIGTERM drains startup before stopping and rejects subsequent mutations',async()=>{
 const f=fixture(),start=deferred(),entered=deferred();
 const connect=f.control('connect',{config:{id:'first',start,entered}});const rejected=assert.rejects(connect,/失效/);
 await entered.promise;f.process.emit('SIGTERM');assert.equal(f.closed(),true);
 await assert.rejects(f.control('connect',{config:{id:'late'}}),/失效/);
 start.resolve();await rejected;await f.drained();assert.equal(f.instances[0].listening,false);
});
test('status stays responsive during startup and verification waits for its listener',async()=>{
 const f=fixture(),start=deferred(),entered=deferred(),verifyEntered=deferred();
 const connect=f.control('connect',{config:{id:'first',start,entered,verifyEntered}});
 await entered.promise;let verifying=false;verifyEntered.promise.then(()=>{verifying=true;});
 const verify=f.control('verify');assert.equal((await f.control('status')).state,'blocked');
 assert.equal(verifying,false);start.resolve();await connect;await verify;
 assert.equal(verifying,true);assert.equal(f.instances[0].monitoring,1);
});
