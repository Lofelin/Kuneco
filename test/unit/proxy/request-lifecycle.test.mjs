import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {directRequest} from '../../../src/features/account/account-client.mjs';
import {ProxyGateway} from '../../../src/features/proxy/proxy.mjs';
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const timed=phase=>e=>e.code==='REQUEST_TIMEOUT'&&e.phase===phase;

test('queue deadline cancels before dispatch and never replays a POST',async()=>{
 let hits=0,seen;const received=new Promise(r=>seen=r);const server=http.createServer(()=>{hits++;seen();});const port=await listen(server);
 const agent=new http.Agent({keepAlive:true,maxSockets:1}),controller=new AbortController();
 const first=directRequest(`http://127.0.0.1:${port}`,{agent,signal:controller.signal}).catch(e=>e);
 try{await received;const start=Date.now();await assert.rejects(directRequest(`http://127.0.0.1:${port}`,{agent,method:'POST',body:{mutation:true},timeouts:{queue:80}}),timed('queue'));assert.ok(Date.now()-start<1000);assert.equal(hits,1);controller.abort();await first;await delay(20);assert.equal(hits,1);}
 finally{controller.abort();agent.destroy();server.closeAllConnections();server.close();}
});
test('DNS/connect and TLS stalls have separate deadlines',async()=>{
 const agent=new http.Agent({lookup:()=>{}});
 try{await assert.rejects(directRequest('http://stall.invalid',{agent,timeouts:{connect:80,total:1000}}),timed('connect'));}finally{agent.destroy();}
 const sockets=new Set();const server=net.createServer(s=>{sockets.add(s);s.on('error',()=>{});});const port=await listen(server);
 try{await assert.rejects(directRequest(`https://127.0.0.1:${port}`,{timeouts:{tls:80,total:1000}}),timed('tls'));}finally{for(const s of sockets)s.destroy();server.close();}
});
test('headers and body idle deadlines, healthy slow bodies, and cancellation',async()=>{
 let mutations=0;const server=http.createServer((req,res)=>{
  if(req.method==='POST')mutations++;
  if(req.url==='/headers')return;
  res.writeHead(200);res.write('a');if(req.url==='/body')return;
  let n=0;const timer=setInterval(()=>{res.write('b');if(++n===6){clearInterval(timer);res.end();}},20);res.once('close',()=>clearInterval(timer));
 });const port=await listen(server),url=`http://127.0.0.1:${port}`;
 try{
  await assert.rejects(directRequest(url+'/headers',{method:'POST',body:{mutation:true},timeouts:{headers:80}}),timed('headers'));assert.equal(mutations,1);
  await assert.rejects(directRequest(url+'/body',{timeouts:{body:80}}),timed('body'));
  assert.equal((await directRequest(url+'/slow',{timeouts:{body:80,total:1000}})).data.length,7);
  const c=new AbortController();const pending=directRequest(url+'/body',{signal:c.signal});setTimeout(()=>c.abort(),30);await assert.rejects(pending,e=>e.name==='AbortError');
 }finally{server.closeAllConnections();server.close();}
});
test('proxy CONNECT stall timeout and cancellation destroy pending sockets without direct fallback',async()=>{
 let connects=0;const peers=new Set();const upstream=http.createServer();upstream.on('connect',(_req,s)=>{connects++;peers.add(s);s.on('error',()=>{});s.on('close',()=>peers.delete(s));});
 const port=await listen(upstream);const g=await new ProxyGateway({protocol:'http',host:'127.0.0.1',port},{timeout:1000}).start();
 try{
  await assert.rejects(g.readText('https://target.invalid',{timeouts:{tunnel:80,total:1000}}),timed('tunnel'));
  const c=new AbortController(),pending=g.readText('https://target.invalid',{signal:c.signal});setTimeout(()=>c.abort(),30);await assert.rejects(pending,e=>e.name==='AbortError');
  await delay(30);assert.equal(g.sockets.size,0);assert.equal(connects,2);assert.equal(g.pendingRequests.size,0);
 }finally{await g.stop();for(const s of peers)s.destroy();upstream.close();}
});

test('DeepSeek CONNECT timeout and cancellation are bounded without request replay',async()=>{
 const {requestDeepSeek,closeDeepSeekConnections}=await import('../../../src/features/runtimes/deepseek-runtime.mjs');
 let connects=0;const peers=new Set();const upstream=http.createServer();upstream.on('connect',(_req,s)=>{connects++;peers.add(s);s.on('error',()=>{});s.on('close',()=>peers.delete(s));});
 const port=await listen(upstream),proxy=`http://127.0.0.1:${port}`;
 try{
  await assert.rejects(requestDeepSeek(proxy,'fixture-key','/chat/completions',{stream:true},{timeouts:{tunnel:80}}),timed('tunnel'));
  const c=new AbortController(),pending=requestDeepSeek(proxy,'fixture-key','/chat/completions',{stream:true},{signal:c.signal});setTimeout(()=>c.abort(),30);
  await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(connects,2);
 }finally{closeDeepSeekConnections();for(const s of peers)s.destroy();upstream.close();}
});
