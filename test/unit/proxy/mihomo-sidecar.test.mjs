import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {mihomoConfig,startMihomo,MIHOMO_VERSION} from '../../../src/features/proxy/mihomo-sidecar.mjs';
const upstream={protocol:'vless',host:'203.0.113.9',port:443,node:{type:'vless',server:'203.0.113.9',port:443,uuid:'test-user',tls:true,servername:'node.example',network:'ws','ws-opts':{path:'/tunnel',headers:{Host:'node.example'}}}};
test('Mihomo routes every request to exactly the chosen node without system listeners or fallback',()=>{
 const config=mihomoConfig(upstream,18080,'private-secret');
 assert.deepEqual(config.rules,['MATCH,kuneco-selected']);assert.equal(config.proxies.length,1);assert.equal(config.proxies[0].servername,'node.example');
 assert.equal(config.proxies[0].name,'kuneco-selected');assert.deepEqual(config['proxy-groups'],[]);
 assert.equal(config['allow-lan'],false);assert.equal(config['bind-address'],'127.0.0.1');assert.deepEqual(config.authentication,['kuneco:private-secret']);assert.deepEqual(config['skip-auth-prefixes'],[]);
 assert.equal(config.tun.enable,false);assert.equal(config.dns.enable,false);assert.equal(config['external-controller'],'');assert.equal(config.profile['store-selected'],false);
 assert.ok(!JSON.stringify(config).includes('DIRECT'));
});
test('untrusted subscription cannot inject routing, insecure TLS, or unresolved upstreams',()=>{
 for(const extra of [{'dialer-proxy':'DIRECT'},{'skip-cert-verify':true},{'proxy-groups':[]},{'interface-name':'en0'},{'ws-opts':{path:'/', 'dialer-proxy':'DIRECT'}}]){
  assert.throws(()=>mihomoConfig({...upstream,node:{...upstream.node,...extra}},18080,'secret'));
 }
 assert.throws(()=>mihomoConfig({...upstream,host:'node.example',node:{...upstream.node,server:'node.example'}},18080,'secret'));
 assert.throws(()=>mihomoConfig({...upstream,protocol:'http'},18080,'secret'));
 assert.throws(()=>mihomoConfig(upstream,18080,'bad\nsecret'));
});
test('SS and Hysteria2 preserve protocol authentication and TLS name',()=>{
 for(const [protocol,options] of [['ss',{cipher:'aes-256-gcm',password:'node-secret'}],['hysteria2',{password:'node-secret',sni:'node.example'}]]){
  const config=mihomoConfig({...upstream,protocol,node:{type:protocol,server:upstream.host,port:443,...options}},18080,'secret');
  assert.equal(config.proxies[0].type,protocol);assert.equal(config.proxies[0].password,'node-secret');
 }
});
async function fakeBinary(mode){
 const directory=await mkdtemp(path.join(tmpdir(),'kuneco-test-mihomo-'));
 const binary=path.join(directory,'mihomo');
 const source=`#!${process.execPath}\nconst fs=require('node:fs');const net=require('node:net');if(process.argv.includes('-v')){console.log('Mihomo Meta v${MIHOMO_VERSION} test');process.exit(0);}const file=process.argv[process.argv.indexOf('-f')+1];fs.writeFileSync(${JSON.stringify(path.join(directory,'config-path'))},file);${mode==='fail'?'process.exit(2);':`const c=JSON.parse(fs.readFileSync(file));net.createServer(s=>s.end()).listen(c.port,'127.0.0.1');`}`;
 await writeFile(binary,source,{mode:0o755});return {directory,binary};
}
test('lifecycle uses private file, minimal argv and environment, readiness, idempotent stop and cleanup',async()=>{
 const fake=await fakeBinary('ready');let exited=false;
 try{
  const result=await startMihomo(upstream,{binary:fake.binary,onExit:()=>{exited=true;}});
  assert.equal(result.config.host,'127.0.0.1');assert.equal(result.config.username,'kuneco');assert.ok(result.pid>0);
  const configPath=await readFile(path.join(fake.directory,'config-path'),'utf8');assert.equal((await stat(configPath)).mode&0o777,0o600);
  const config=JSON.parse(await readFile(configPath,'utf8'));assert.equal(config.authentication[0],`kuneco:${result.config.password}`);
  await Promise.all([result.stop(),result.stop()]);assert.equal(exited,false);
  await assert.rejects(stat(configPath),{code:'ENOENT'});
  await new Promise(resolve=>{const s=net.connect(result.config.port,'127.0.0.1');s.once('error',()=>{s.destroy();resolve();});s.once('connect',()=>{s.destroy();assert.fail('orphaned listener');});});
 }finally{await rm(fake.directory,{recursive:true,force:true});}
});
test('startup failure removes temporary credentials and invokes exit callback',async()=>{
 const fake=await fakeBinary('fail');let exited=false;
 try{
  await assert.rejects(startMihomo(upstream,{binary:fake.binary,onExit:()=>{exited=true;}}),/启动失败/);
  const configPath=await readFile(path.join(fake.directory,'config-path'),'utf8');await assert.rejects(stat(configPath),{code:'ENOENT'});assert.equal(exited,true);
 }finally{await rm(fake.directory,{recursive:true,force:true});}
});
test('ECH must carry pre-resolved configuration and cannot perform implicit bootstrap DNS',()=>{
 assert.throws(()=>mihomoConfig({...upstream,node:{...upstream.node,'ech-opts':{enable:true}}},18080,'secret'),/ECH/);
 assert.throws(()=>mihomoConfig({...upstream,node:{...upstream.node,'ech-opts':{enable:true,'query-server-name':'bootstrap.example'}}},18080,'secret'));
 const config=mihomoConfig({...upstream,node:{...upstream.node,'ech-opts':{enable:true,config:'AQIDBA=='}}},18080,'secret');
 assert.equal(config.proxies[0]['ech-opts'].config,'AQIDBA==');assert.equal(config.dns.enable,false);
});
test('unexpected process exit notifies owner and removes credentials',async()=>{
 const fake=await fakeBinary('ready');let notified;
 const exited=new Promise(resolve=>{notified=resolve;});
 try{
  const result=await startMihomo(upstream,{binary:fake.binary,onExit:notified});
  const configPath=await readFile(path.join(fake.directory,'config-path'),'utf8');process.kill(result.pid,'SIGTERM');await exited;
  await result.stop();await assert.rejects(stat(configPath),{code:'ENOENT'});
 }finally{await rm(fake.directory,{recursive:true,force:true});}
});
test('relay emits exactly two isolated fixed outbounds with no groups or fallback',()=>{
 const relay={...upstream.node,name:'untrusted-rule-name'};
 const node={type:'hysteria2',server:upstream.host,port:443,password:'hy-secret',sni:'example.com',fingerprint:'ab'.repeat(32),relay};
 const config=mihomoConfig({...upstream,protocol:'hysteria2',node},18080,'secret');
 assert.equal(config.proxies.length,2);assert.equal(config.proxies[0]['dialer-proxy'],'kuneco-relay');assert.equal(config.proxies[1].name,'kuneco-relay');assert.equal(config.proxies[0].fingerprint,node.fingerprint);assert.equal(config.proxies[0].relay,undefined);assert.deepEqual(config.rules,['MATCH,kuneco-selected']);assert.deepEqual(config['proxy-groups'],[]);
 assert.throws(()=>mihomoConfig({...upstream,protocol:'hysteria2',node:{...node,relay:{...relay,relay}}},18080,'secret'),/前置/);
 assert.throws(()=>mihomoConfig({...upstream,protocol:'hysteria2',node:{...node,relay:{...relay,tls:false}}},18080,'secret'),/前置/);
});
