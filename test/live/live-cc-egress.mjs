// Opt-in network acceptance, not a Claude model request. Credentials stay in memory.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {ProxyGateway,proxyEnvironment} from '../../src/features/proxy/proxy.mjs';
import {parseIproyalExport} from '../../src/features/proxy/iproyal-import.mjs';
import {createRestrictedCCSpawner} from '../../src/features/runtimes/cc-network-guard.mjs';
const config=parseIproyalExport(await readFile(process.argv[2],'utf8')).entries[0];
const gateway=await new ProxyGateway(config).start();
try {
  const status=await gateway.verify();assert.equal(status.state,'ready');
  const spawnRestricted=createRestrictedCCSpawner({port:gateway.port,canStart:()=>gateway.status.state==='ready'});
  const code=`import{ProxyGateway}from './src/proxy.mjs';const p=new URL(process.env.WORKSPACE_PROXY);const nested=new ProxyGateway({protocol:'http',host:p.hostname,port:Number(p.port),username:decodeURIComponent(p.username),password:decodeURIComponent(p.password)});try{let ip;try{ip=JSON.parse(await nested.readText('https://api.ipify.org?format=json')).ip}catch{ip=(await nested.readText('https://checkip.amazonaws.com/')).trim()}console.log(JSON.stringify({ip}))}finally{for(const s of nested.sockets)s.destroy()}`;
  const result=await new Promise((resolve,reject)=>{
    const child=spawnRestricted({command:process.execPath,args:['--input-type=module','-e',code],cwd:process.cwd(),env:{...proxyEnvironment(process.env,gateway.url),WORKSPACE_PROXY:gateway.url}});
    let output='';const timeout=setTimeout(()=>child.kill('SIGTERM'),35000);child.stdout.on('data',chunk=>output+=chunk);child.on('error',reject);child.on('exit',exit=>{clearTimeout(timeout);exit===0?resolve(JSON.parse(output)):reject(new Error('Restricted egress probe failed'))});
  });
  assert.equal(result.ip,status.ip);
  const report={at:new Date().toISOString(),gatewayIp:status.ip,restrictedProcessIp:result.ip,source:status.probeSource,scope:'Same macOS sandbox and local gateway used by app-launched CC; network probe only, no model/account request'};
  await writeFile('artifacts/cc-egress-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await gateway.stop();}
