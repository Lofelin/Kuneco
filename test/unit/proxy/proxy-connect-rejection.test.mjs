import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import {ProxyGateway} from '../../../src/features/proxy/proxy.mjs';

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function deadline(promise,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),1000);})]);}finally{clearTimeout(timer);}}
async function settled(check){for(let i=0;i<50;i++){if(check())return;await delay(10);}assert.ok(check(),'resources did not settle');}
async function fixture({ready=true,limit=1}={}){
  const upstreamSockets=new Set();
  const proxy=http.createServer();proxy.on('connection',socket=>{upstreamSockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>upstreamSockets.delete(socket));});
  proxy.on('connect',(_req,socket)=>socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  const port=await listen(proxy);
  const gateway=await new ProxyGateway({protocol:'http',host:'127.0.0.1',port},{allowLocalTargets:true,timeout:100,forwardingLimit:limit,forwardingQueueLimit:0}).start();
  if(ready)gateway.status={state:'ready',checkedAt:new Date().toISOString()};
  const clients=[];
  return {gateway,clients,async cleanup(){for(const client of clients)client.destroy();await gateway.stop();for(const socket of upstreamSockets)socket.destroy();await new Promise(resolve=>proxy.close(resolve));}};
}
async function rejected(f,{auth=true,target='example.test:443'}={}){
  const socket=net.connect({host:'127.0.0.1',port:f.gateway.port,allowHalfOpen:true});f.clients.push(socket);socket.on('error',()=>{});
  let response='';socket.on('data',chunk=>{response+=chunk;});
  await new Promise(resolve=>socket.once('connect',resolve));
  const credentials=auth?`Proxy-Authorization: Basic ${Buffer.from(`workspace:${f.gateway.token}`).toString('base64')}\r\n`:'';
  const ended=new Promise(resolve=>socket.once('end',resolve));
  socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: example.test:443\r\n${credentials}\r\n`);
  await deadline(ended,'CONNECT rejection response did not finish');
  assert.ok(response.endsWith('\r\n\r\n'),'response headers must be fully delivered before destruction');
  assert.match(response,/Connection: close/i);
  await settled(()=>f.gateway.sockets.size===0);
  assert.equal(f.gateway.status.capacity.forwarding.queued,0);
  return response;
}

for(const [name,options,status] of [
  ['unauthenticated',{auth:false},407],
  ['blocked gateway',{ready:false},502],
  ['invalid target',{target:'example.test:443/path'},502],
  ['upstream refusal',{},502],
])test(`rejected CONNECT ${name} closes a client that never returns FIN`,async()=>{
  const f=await fixture({ready:options.ready!==false});
  try{assert.match(await rejected(f,options),new RegExp(`^HTTP/1\\.1 ${status} `));assert.equal(f.gateway.status.capacity.forwarding.active,0);}
  finally{await f.cleanup();}
});

test('queue-full CONNECT rejection closes the socket without releasing another request slot',async()=>{
  const f=await fixture();let release;
  try{
    release=await f.gateway.forwarding.acquire(undefined,'occupied');
    assert.match(await rejected(f),/^HTTP\/1\.1 503 /);
    assert.equal(f.gateway.status.capacity.forwarding.active,1,'rejection must not release someone else\'s admission');
    release();release=null;assert.equal(f.gateway.status.capacity.forwarding.active,0);
  }finally{release?.();await f.cleanup();}
});

test('healthy CONNECT preserves a delayed reply after the client half-closes',async()=>{
  const targetSockets=new Set();const target=net.createServer({allowHalfOpen:true},socket=>{targetSockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>targetSockets.delete(socket));socket.on('data',()=>{});socket.once('end',()=>setTimeout(()=>socket.end('delayed reply'),30));});
  const targetPort=await listen(target),proxySockets=new Set();
  const proxy=http.createServer();proxy.on('connect',(_req,client)=>{
    const remote=net.connect(targetPort,'127.0.0.1',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');client.pipe(remote);remote.pipe(client);});
    for(const socket of [client,remote]){proxySockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>proxySockets.delete(socket));}
    client.once('close',()=>remote.destroy());remote.once('close',()=>client.destroy());
  });
  const port=await listen(proxy),gateway=await new ProxyGateway({protocol:'http',host:'127.0.0.1',port},{allowLocalTargets:true}).start();gateway.status={state:'ready',checkedAt:new Date().toISOString()};
  let client;
  try{
    client=net.connect(gateway.port,'127.0.0.1');client.on('error',()=>{});let response='';
    const closed=new Promise(resolve=>client.once('close',resolve));
    client.on('data',chunk=>{response+=chunk;if(response.includes('\r\n\r\n')&&!client.writableEnded)client.end('request payload');});
    await new Promise(resolve=>client.once('connect',resolve));
    client.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: localhost\r\nProxy-Authorization: Basic ${Buffer.from(`workspace:${gateway.token}`).toString('base64')}\r\n\r\n`);
    await deadline(closed,'half-close reply did not finish');
    assert.match(response,/^HTTP\/1\.1 200 /);assert.ok(response.endsWith('delayed reply'));
    await settled(()=>gateway.sockets.size===0);assert.equal(gateway.status.capacity.forwarding.active,0);
  }finally{client?.destroy();await gateway.stop();for(const socket of [...proxySockets,...targetSockets])socket.destroy();await Promise.all([new Promise(resolve=>proxy.close(resolve)),new Promise(resolve=>target.close(resolve))]);}
});
