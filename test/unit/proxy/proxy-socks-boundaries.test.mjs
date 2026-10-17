import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {ProxyGateway} from '../../../src/features/proxy/proxy.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await wait(5);}assert.fail('fixture did not settle');}
async function fixture(mode='stall',options={}){
 const sockets=new Set();let attempts=0,commands=0;
 const server=net.createServer(s=>{
  attempts++;sockets.add(s);s.once('close',()=>sockets.delete(s));s.on('error',()=>{});let phase='hello',buffer=Buffer.alloc(0);
  s.on('data',data=>{
   buffer=Buffer.concat([buffer,data]);
   if(mode==='stall')return;
   if(phase==='hello'){
    if(buffer.length<2||buffer.length<2+buffer[1])return;
    buffer=buffer.subarray(2+buffer[1]);phase=mode==='auth'?'auth':'command';s.write(Buffer.from([5,mode==='auth'?2:0]));
   }
   if(phase==='auth'){
    if(buffer.length<2||buffer.length<3+buffer[1])return;
    const n=3+buffer[1]+buffer[2+buffer[1]];if(buffer.length<n)return;
    phase='done';s.end(Buffer.from([1,1]));return;
   }
   if(phase==='command'){
    if(buffer.length<5)return;const n=buffer[3]===1?10:buffer[3]===4?22:7+buffer[4];if(buffer.length<n)return;
    commands++;phase='done';s.end(Buffer.from([5,5,0,1,0,0,0,0,0,0]));
   }
  });
 });
 const port=await listen(server),g=await new ProxyGateway({protocol:'socks5',host:'127.0.0.1',port,username:'fixture',password:'not-a-real-secret'},{timeout:80,forwardingLimit:1,forwardingQueueLimit:2,targetQueueLimit:2,...options}).start();
 g.update({state:'ready',ip:'203.0.113.8',checkedAt:new Date().toISOString()});
 return {g,get attempts(){return attempts;},get commands(){return commands;},setMode(value){mode=value;},async close(){await g.stop();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
function connect(g){
 let request;const result=new Promise((resolve,reject)=>{
  request=http.request({host:'127.0.0.1',port:g.port,method:'CONNECT',path:'example.invalid:443',headers:{'proxy-authorization':`Basic ${Buffer.from(`workspace:${g.token}`).toString('base64')}`}});
  request.once('connect',(response,socket)=>{socket.destroy();resolve(response.statusCode);});request.once('error',reject);request.end();
 });return {request,result};
}
test('SOCKS CONNECT handshake timeout is classified and releases queued work without replay',async()=>{
 const f=await fixture();try{
  const a=connect(f.g),b=connect(f.g);await until(()=>f.g.status.capacity.forwarding.queued===1);
  assert.equal(await a.result,502);assert.equal(await b.result,502);
  await until(()=>f.g.status.capacity.forwarding.active===0);
  assert.equal(f.attempts,2);assert.equal(f.g.status.capacity.forwarding.queued,0);assert.equal(f.g.status.state,'ready');
  assert.equal(f.g.status.performance['connect.cold.timeout']?.count,2);
  assert.equal(f.g.status.lastFailure.code,'PROXY_TIMEOUT');assert.equal(f.g.status.lastFailure.phase,'tunnel');
 }finally{await f.close();}
});
test('SOCKS explicit authentication refusal quarantines without retrying credentials',async()=>{
 const f=await fixture('auth');try{
  assert.equal(await connect(f.g).result,502);await until(()=>f.g.status.capacity.forwarding.active===0);
  assert.equal(f.attempts,1);assert.equal(f.commands,0);assert.equal(f.g.quarantined,true);assert.equal(f.g.status.state,'blocked');assert.equal(f.g.status.lastFailure.code,'PROXY_AUTH_REQUIRED');assert.match(f.g.status.reason,/SOCKS5/);assert.ok(!JSON.stringify(f.g.status).includes('not-a-real-secret'));
  assert.equal(await connect(f.g).result,502);assert.equal(f.attempts,1);
 }finally{await f.close();}
});
test('SOCKS target refusal fails only that request and does not replay it',async()=>{
 const f=await fixture('refuse');try{
  assert.equal(await connect(f.g).result,502);assert.equal(f.attempts,1);assert.equal(f.commands,1);assert.equal(f.g.status.state,'ready');assert.equal(f.g.quarantined,false);
  assert.equal(f.g.status.lastFailure.code,'PROXY_TARGET_REFUSED');assert.equal(f.g.status.lastFailure.scope,'request');
  assert.equal(await connect(f.g).result,502);assert.equal(f.attempts,2);assert.equal(f.commands,2);
 }finally{await f.close();}
});
test('SOCKS client cancellation wins over later handshake timeout and removes queued work',async()=>{
 const f=await fixture('stall',{timeout:200});try{
  const a=connect(f.g),b=connect(f.g);const outcomes=Promise.allSettled([a.result,b.result]);
  await until(()=>f.attempts===1&&f.g.status.capacity.forwarding.queued===1);
  b.request.destroy(new Error('fixture cancellation'));a.request.destroy(new Error('fixture cancellation'));await outcomes;
  await until(()=>f.g.status.capacity.forwarding.active===0&&f.g.status.capacity.forwarding.queued===0);
  await wait(250);assert.equal(f.attempts,1);assert.equal(f.commands,0);assert.equal(f.g.status.state,'ready');assert.equal(f.g.status.lastFailure,undefined);
  assert.equal(f.g.status.performance['connect.cold.cancelled']?.count,1);assert.equal(f.g.status.performance['connect.cold.timeout'],undefined);
 }finally{await f.close();}
});
