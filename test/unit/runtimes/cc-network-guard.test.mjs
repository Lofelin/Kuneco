import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRestrictedCCSpawner,ccSandboxProfile} from '../../../src/features/runtimes/cc-network-guard.mjs';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const run= (spawnRestricted,code) => new Promise((resolve,reject)=> {
  const child=spawnRestricted({command:process.execPath,args:['--input-type=module','-e',code],cwd:process.cwd(),env:{PATH:process.env.PATH},signal:undefined});
  let stdout='';child.stdout.on('data',chunk=>stdout+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(stdout)):reject(new Error('Guard test exited '+code)));
});
test('CC网络守卫只允许本地代理TCP，清空代理变量也不能直连，DNS和UDP阻断且子进程继承',{skip:process.platform!=='darwin'},async()=>{
  let gatewayHits=0,directHits=0;
  const gateway=http.createServer((_req,res)=>{gatewayHits++;res.end('proxy-only');});
  const direct=http.createServer((_req,res)=>{directHits++;res.end('direct');});
  await listen(gateway);await listen(direct);
  const gatewayPort=gateway.address().port; const guarded=createRestrictedCCSpawner({port:gatewayPort});
  try {
    const code=`import net from 'node:net';import http from 'node:http';import dns from 'node:dns/promises';import dgram from 'node:dgram';import {spawnSync} from 'node:child_process';
      const tcp=(host,port)=>new Promise(resolve=>{const s=net.connect(port,host);s.on('connect',()=>{s.destroy();resolve('connected')});s.on('error',e=>resolve(e.code));s.setTimeout(2000,()=>{s.destroy();resolve('timeout')})});
      const proxy=await new Promise((resolve,reject)=>http.get('http://127.0.0.1:${gateway.address().port}/',r=>{let b='';r.on('data',x=>b+=x);r.on('end',()=>resolve(b))}).on('error',reject));
      const direct=await tcp('127.0.0.1',${direct.address().port});const external=await tcp('1.1.1.1',443);
      const udp=await new Promise(resolve=>{const s=dgram.createSocket('udp4');s.on('error',e=>{s.close();resolve(e.code)});s.send(Buffer.from('stun-probe'),${gateway.address().port},'127.0.0.1',e=>{s.close();resolve(e?.code||'sent')})});
      let dnsResult;try{await dns.resolve4('example.com');dnsResult='resolved'}catch(e){dnsResult=e.code}
      let lookupResult;try{await dns.lookup('example.com');lookupResult='resolved'}catch(e){lookupResult=e.code}
      const child=spawnSync(process.execPath,['--input-type=module','-e',"import net from 'node:net';const s=net.connect(${direct.address().port},'127.0.0.1');s.on('error',e=>console.log(e.code));s.on('connect',()=>{s.destroy();console.log('connected')})"],{encoding:'utf8',timeout:4000});
      console.log(JSON.stringify({proxy,direct,external,udp,dnsResult,lookupResult,descendant:child.stdout.trim()}));`;
    const result=await run(guarded,code);
    assert.equal(result.proxy,'proxy-only');
    for(const key of ['direct','external','udp','descendant']) assert.equal(result[key],'EPERM',JSON.stringify(result));
    assert.notEqual(result.dnsResult,'resolved');assert.notEqual(result.lookupResult,'resolved');
    assert.equal(gatewayHits,1);assert.equal(directHits,0);
    console.log('CC网络隔离实测：'+JSON.stringify(result));
    await new Promise(resolve=>gateway.close(resolve));
    const stopped=await run(guarded,`import net from 'node:net';const s=net.connect(${gatewayPort},'127.0.0.1');s.on('error',e=>console.log(JSON.stringify({error:e.code})));`);
    assert.equal(stopped.error,'ECONNREFUSED'); // Gateway unavailable: there is no alternative destination.
  } finally { gateway.closeAllConnections();gateway.close();direct.closeAllConnections();await new Promise(resolve=>direct.close(resolve)); }
});
test('无隔离支持、无效端口和门禁失败不会创建普通CC进程',()=>{
  assert.throws(()=>ccSandboxProfile('1234'));
  assert.throws(()=>createRestrictedCCSpawner({port:1234,platform:'linux'}));
  assert.throws(()=>createRestrictedCCSpawner({port:1234,canStart:()=>false})({command:'true',args:[],env:{}}));
});
