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
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});

for(const engine of ['native','gost'])test(`${engine}: HTTPS IP target validates its own IP SAN rather than localhost or proxy identity`,{skip:engine==='gost'&&!existsSync(gostBinary)},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'kuneco-target-identity-'));
  try{
    for(const [label,san,valid] of [['ip','IP:127.0.0.1',true],['localhost','DNS:localhost',false],['proxy','DNS:proxy.fixture.invalid',false]]){
      const keyFile=path.join(directory,`${label}.key`),certFile=path.join(directory,`${label}.pem`);
      execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj',`/CN=${label}`,'-addext',`subjectAltName=${san}`],{stdio:'ignore'});
      const key=await readFile(keyFile),cert=await readFile(certFile),peers=new Set();let hits=0,tunnels=0;
      const track=socket=>{peers.add(socket);socket.on('error',()=>{});socket.once('close',()=>peers.delete(socket));};
      const target=https.createServer({key,cert},(_req,res)=>{hits++;res.end('target reached');});target.on('connection',track);const targetPort=await listen(target);
      const proxy=http.createServer();proxy.on('connection',track);
      proxy.on('connect',(req,client,head)=>{
        assert.equal(req.url,`127.0.0.1:${targetPort}`);tunnels++;
        const remote=net.connect(targetPort,'127.0.0.1',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);client.pipe(remote);remote.pipe(client);});track(remote);
        remote.once('error',()=>client.destroy());remote.once('close',()=>client.destroy());client.once('close',()=>remote.destroy());
      });
      const proxyPort=await listen(proxy);
      const gateway=await new ProxyGateway({protocol:'http',host:'127.0.0.1',port:proxyPort},{allowLocalTargets:true,ca:cert,timeout:1000,gostBinary:engine==='gost'?gostBinary:null}).start();
      try{
        // Only target identity varies; its self-signed CA is explicitly trusted.
        // A target TLS failure must neither poison the gateway nor replay traffic.
        gateway.status.state='ready';
        if(valid){assert.equal(await gateway.readText(`https://127.0.0.1:${targetPort}/`),'target reached');assert.equal(hits,1);}
        else{await assert.rejects(gateway.readText(`https://127.0.0.1:${targetPort}/`),error=>error.code==='ERR_TLS_CERT_ALTNAME_INVALID'&&error.proxyScope==='target');assert.equal(hits,0);}
        assert.equal(tunnels,1);assert.equal(gateway.status.state,'ready');assert.equal(gateway.pendingRequests.size,0);assert.equal(gateway.status.capacity.probes.active,0);
      }finally{await gateway.stop();for(const peer of peers)peer.destroy();await Promise.all([proxy,target].map(server=>new Promise(resolve=>server.close(resolve))));}
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
