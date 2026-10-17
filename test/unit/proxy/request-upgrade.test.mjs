import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {existsSync} from 'node:fs';
import {ProxyGateway} from '../../../src/features/proxy/proxy.mjs';
import {AccountClient} from '../../../src/features/account/account-client.mjs';

const gostBinary=new URL('../../../vendor/gost/'+process.platform+'_'+(process.arch==='x64'?'amd64':process.arch)+'/gost',import.meta.url).pathname;
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
async function deadline(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('request did not settle')),2000);})]);}finally{clearTimeout(timer);}}
async function fixture(){
  const peers=new Set(),hits=new Map();let tunnels=0;
  const track=socket=>{peers.add(socket);socket.on('error',()=>{});socket.once('close',()=>peers.delete(socket));};
  const target=http.createServer((req,res)=>{
    hits.set(req.url,(hits.get(req.url)||0)+1);
    if(req.url==='/upgrade'){req.resume();req.once('end',()=>req.socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));return;}
    res.end(JSON.stringify({ip:'203.0.113.8'}));
  });target.on('connection',track);const port=await listen(target);
  const upstream=http.createServer();upstream.on('connection',track);
  upstream.on('connect',(req,client,head)=>{
    assert.equal(req.url,`127.0.0.1:${port}`);tunnels++;
    const remote=net.connect(port,'127.0.0.1',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);client.pipe(remote);remote.pipe(client);});track(remote);
    client.once('close',()=>remote.destroy());remote.once('close',()=>client.destroy());
  });const proxyPort=await listen(upstream);
  return {url:`http://127.0.0.1:${port}`,hits,get tunnels(){return tunnels;},config:{protocol:'http',host:'127.0.0.1',port:proxyPort},async close(){for(const peer of peers)peer.destroy();await Promise.all([target,upstream].map(server=>new Promise(resolve=>server.close(resolve))));}};
}
for(const engine of ['native','gost'])test(`${engine}: unexpected upgrade releases probe and fresh verification capacity without blocking the route`,{skip:engine==='gost'&&!existsSync(gostBinary)},async()=>{
  const f=await fixture();const gateway=await new ProxyGateway(f.config,{allowLocalTargets:true,timeout:500,gostBinary:engine==='gost'?gostBinary:null}).start();
  try{
    await deadline(gateway.verify(f.url));assert.equal(gateway.status.state,'ready');
    await assert.rejects(deadline(gateway.readText(f.url+'/upgrade')),error=>error.code==='REQUEST_UPGRADE_UNSUPPORTED');
    assert.equal(gateway.status.capacity.probes.active,0);assert.equal(gateway.pendingRequests.size,0);
    const failed=await deadline(gateway.verify(f.url+'/upgrade'));
    assert.equal(failed.state,'ready');assert.equal(failed.verificationState,'unavailable');assert.equal(failed.probeFailures[0].code,'REQUEST_UPGRADE_UNSUPPORTED');
    assert.equal(gateway.status.capacity.verification.active,0);assert.equal(gateway.pendingRequests.size,0);assert.equal(gateway.verifying,null);
    assert.equal(f.hits.get('/upgrade'),2,'no replay of either failed request');
    assert.equal(await deadline(gateway.readText(f.url)),JSON.stringify({ip:'203.0.113.8'}));
    assert.equal((await deadline(gateway.verify(f.url))).verificationState,'verified');assert.equal(gateway.status.ip,'203.0.113.8');
    assert.equal(gateway.status.capacity.verification.active,0);assert.equal(gateway.status.capacity.probes.active,0);
    assert.ok(f.tunnels>=4,'all probes use the configured upstream');
  }finally{await gateway.stop();await f.close();}
});
test('account POST upgrade fails once and releases admission for the next request',async()=>{
  const f=await fixture();const account=new AccountClient({serverURL:f.url,environment:()=> 'isolated-test'});
  try{
    await assert.rejects(deadline(account.transport(f.url+'/upgrade',{method:'POST',body:{mutation:true},timeouts:{total:500}})),error=>error.code==='REQUEST_UPGRADE_UNSUPPORTED');
    assert.equal(f.hits.get('/upgrade'),1,'side-effect request must never replay');assert.equal(account.admission.active,0);assert.equal(account.pendingRequests.size,0);assert.equal(account.originActive.size,0);
    const next=await deadline(account.transport(f.url,{timeouts:{total:500}}));assert.equal(next.status,200);assert.equal(account.admission.active,0);assert.equal(f.hits.get('/upgrade'),1);
  }finally{account.closeConnections();await f.close();}
});
