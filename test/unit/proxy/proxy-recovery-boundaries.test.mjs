import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ProxyGateway} from '../../../src/features/proxy/proxy.mjs';
const gostBinary=new URL('../../../vendor/gost/'+process.platform+'_'+(process.arch==='x64'?'amd64':process.arch)+'/gost',import.meta.url).pathname;
const engines=['native',...(existsSync(gostBinary)?['gost']:[])];
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<200;i++){if(check())return;await delay(10);}assert.fail('condition did not settle');}
async function fixture({engine='native',tlsOptions,...options}={}){
 const peers=new Set();let failedProbe=false,blackhole=false,mutations=0,tunnels=0;
 const track=s=>{peers.add(s);s.on('error',()=>{});s.once('close',()=>peers.delete(s));return s;};
 const target=http.createServer((req,res)=>{
  if(req.method==='POST')mutations++;
  req.resume();
  if(req.url==='/mutation'&&blackhole)return;
  if(failedProbe&&req.url==='/exit'){res.writeHead(503);res.end();return;}
  res.end(JSON.stringify({ip:'203.0.113.8'}));
 });target.on('connection',track);const targetPort=await listen(target);
 const upstream=tlsOptions?https.createServer(tlsOptions):http.createServer();upstream.on('connection',track);
 upstream.on('connect',(_req,client,head)=>{
  tunnels++;const remote=track(net.connect(targetPort,'127.0.0.1',()=>{
   client.write('HTTP/1.1 200 OK\r\n\r\n');if(head.length)remote.write(head);client.pipe(remote);remote.pipe(client);
  }));client.once('close',()=>remote.destroy());remote.once('close',()=>client.destroy());
 });const port=await listen(upstream);
 const gateway=await new ProxyGateway({protocol:tlsOptions?'https':'http',host:'127.0.0.1',port},{timeout:1000,allowLocalTargets:true,ca:tlsOptions?.cert,...options,gostBinary:engine==='gost'?gostBinary:null}).start();
 const url=`http://127.0.0.1:${targetPort}`;
 return {gateway,url,get mutations(){return mutations;},get tunnels(){return tunnels;},probeFailure(v){failedProbe=v;},blackhole(v){blackhole=v;},async close(){await gateway.stop();for(const s of peers)s.destroy();await Promise.all([upstream,target].map(server=>new Promise(r=>server.close(r))));}};
}
function request(g,url,method='GET'){
 return new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:g.port,path:url,method,headers:{'proxy-authorization':`Basic ${Buffer.from(`workspace:${g.token}`).toString('base64')}`}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));res.once('error',reject);});
  req.once('error',reject);req.setTimeout(3000,()=>req.destroy(new Error('fixture deadline')));req.end(method==='POST'?'mutation':undefined);
 });
}
test('equivalent IPv6 exit and region representations preserve the pin; a different address quarantines',async()=>{
 const g=new ProxyGateway({protocol:'http',host:'127.0.0.1',port:12345},{expectedIp:'2001:0DB8:0:0:0:0:0:1'});
 try{
  g.readText=async()=>JSON.stringify({ip:'2001:db8::1'});
  await g.verify('https://fixture.invalid/exit');assert.equal(g.status.state,'ready');assert.equal(g.quarantined,false);
  g.readText=async()=>JSON.stringify({ip:'2001:0db8:0000:0000:0000:0000:0000:0001',country:'US'});
  assert.equal(await g.detectRegion('https://fixture.invalid/region'),'US');
  g.readText=async()=>JSON.stringify({ip:'2001:db8::2'});
  await g.verify('https://fixture.invalid/exit');assert.equal(g.status.state,'blocked');assert.equal(g.quarantined,true);
 }finally{await g.stop();}
});
test('GOST recovery clears crash budget after delayed successful verification',{skip:!existsSync(gostBinary)},async()=>{
 const f=await fixture({engine:'gost',coreRetryBase:20,coreRetryMax:50,coreStableMs:50,retryBase:10000,healthInterval:10000});
 try{
  await f.gateway.verify(f.url+'/exit');f.probeFailure(true);process.kill(f.gateway.sidecar.pid,'SIGKILL');
  await until(()=>f.gateway.coreAttempts===1&&f.gateway.coreAvailable&&f.gateway.status.verificationState==='unavailable');
  await delay(100);assert.equal(f.gateway.status.state,'blocked');assert.equal(f.gateway.coreAttempts,1);
  f.probeFailure(false);await f.gateway.checkNow();assert.equal(f.gateway.status.state,'ready');
  await until(()=>f.gateway.coreAttempts===0);assert.equal(f.gateway.status.coreAttempts,0);
 }finally{await f.close();}
});
for(const engine of engines)test(`${engine}: target blackhole times out once and a new request recovers without replay`,async()=>{
 const f=await fixture({engine,responseHeadersTimeout:80});
 try{
  await f.gateway.verify(f.url+'/exit');f.blackhole(true);
  assert.equal(await request(f.gateway,f.url+'/mutation','POST'),504);assert.equal(f.mutations,1);assert.equal(f.gateway.status.state,'ready');
  f.blackhole(false);assert.equal(await request(f.gateway,f.url+'/exit'),200);
  await delay(100);assert.equal(f.mutations,1);assert.equal(f.gateway.status.capacity.forwarding.active,0);
  assert.equal(f.gateway.status.capacity.verification.active,0);
 }finally{await f.close();}
});
for(const engine of engines)test(`${engine}: SOCKS authentication failure and stalled handshake cancellation cannot reach target`,async()=>{
 let mode='reject',attempts=0,hits=0;const peers=new Set();
 const target=http.createServer((_req,res)=>{hits++;res.end('unexpected direct request');});const targetPort=await listen(target);
 const proxy=net.createServer(s=>{attempts++;peers.add(s);s.on('error',()=>{});s.once('close',()=>peers.delete(s));s.once('data',()=>{if(mode==='reject')s.end(Buffer.from([5,255]));});});const port=await listen(proxy);
 const g=await new ProxyGateway({protocol:'socks5',host:'127.0.0.1',port,username:'fixture',password:'fixture'},{timeout:1000,allowLocalTargets:true,gostBinary:engine==='gost'?gostBinary:null}).start();
 try{
  await assert.rejects(g.readText(`http://127.0.0.1:${targetPort}/`,{timeouts:{total:500}}));assert.equal(hits,0);
  mode='stall';const c=new AbortController(),pending=g.readText(`http://127.0.0.1:${targetPort}/`,{signal:c.signal});
  await until(()=>attempts>=2);c.abort();await assert.rejects(pending,e=>e.name==='AbortError');
  await until(()=>g.pendingRequests.size===0&&g.sockets.size===0);assert.equal(hits,0);assert.equal(g.status.capacity.probes.active,0);
 }finally{await g.stop();for(const s of peers)s.destroy();await Promise.all([proxy,target].map(server=>new Promise(r=>server.close(r))));}
});
test('native and GOST HTTPS upstreams validate the configured CA without direct fallback',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kuneco-upstream-tls-'));
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
  const tlsOptions={key:await readFile(path.join(dir,'key.pem')),cert:await readFile(path.join(dir,'cert.pem'))};
  for(const engine of engines){
   const f=await fixture({engine,tlsOptions});
   try{
    assert.equal((await f.gateway.verify(f.url+'/exit')).state,'ready');assert.equal(await request(f.gateway,f.url+'/exit'),200);assert.ok(f.tunnels>=2);
    const untrusted=await new ProxyGateway(f.gateway.config,{timeout:500,allowLocalTargets:true,gostBinary:engine==='gost'?gostBinary:null}).start();
    try{const before=f.tunnels;assert.equal((await untrusted.verify(f.url+'/exit')).state,'blocked');assert.equal(f.tunnels,before,'untrusted TLS must never establish a tunnel');}finally{await untrusted.stop();}
   }finally{await f.close();}
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
