import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DockerEnvironments,resourcePrefix} from '../../src/features/environments/docker-environments.mjs';
import {ContainerBrowserEngine,ensureContainerBrowserImage} from '../../src/features/browser/container-browser-engine.mjs';
import {createContainerBrowserNetwork} from '../../src/features/browser/container-browser-network.mjs';
const manager=new DockerEnvironments({directory:'/tmp/kuneco-browser-modes-fixture',sourceRoot:fileURLToPath(new URL('../../',import.meta.url)),encrypt:x=>x,decrypt:x=>x});
const owner='browser-modes-'+randomUUID(),environmentId=randomUUID(),prefix=resourcePrefix(owner,environmentId),network=prefix+'-private';
const image=await ensureContainerBrowserImage(manager);let engine,transport;
try{
 await manager.command(['network','create','--internal','--label','app=dingtu',network]);
 await manager.command(['volume','create',prefix+'-worker-work']);
 await manager.command(['run','--rm','--network','none','--mount',`type=volume,src=${prefix}-worker-work,dst=/workspace`,'--entrypoint','sh',image,'-c','chown 1000:1000 /workspace']);
 const fixture=`const http=require('http');const server=http.createServer((req,res)=>{if(req.headers['proxy-authorization']!=='Basic '+Buffer.from('workspace:fixture-token').toString('base64')){res.writeHead(407,{'proxy-authenticate':'Basic realm=fixture'});return res.end();}res.end('<title>PROXY_FIXTURE</title>PROXY_FIXTURE');});server.on('connect',(req,socket)=>{socket.write('HTTP/1.1 200 Connection Established\\r\\n\\r\\n');socket.once('data',()=>socket.end('HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\nContent-Length: 13\\r\\nConnection: close\\r\\n\\r\\nPROXY_FIXTURE'));});server.listen(8080,'0.0.0.0');`;
 await manager.command(['run','-d','--name',prefix+'-proxy','--network',network,'--entrypoint','node',image,'-e',fixture]);
 const ip=(await manager.command(['inspect','--format',`{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,prefix+'-proxy'])).trim();
 async function start(mode,proxy={ip,token:'fixture-token'}){
  await engine?.close();transport=await createContainerBrowserNetwork(manager,{owner,environmentId,mode,image,proxy});
  engine=new ContainerBrowserEngine(manager,{owner,environmentId,gatewayIP:transport.gatewayIP,token:transport.token,timezone:'UTC',locale:'en-US',allowRequest:async()=>true});engine.transport=transport;await engine.start();
  const info=JSON.parse(await manager.command(['inspect','--format','{{json .}}',engine.name]));assert.deepEqual(Object.keys(info.NetworkSettings.Networks),[network]);assert.equal(info.HostConfig.Privileged,false);assert.equal(info.HostConfig.ReadonlyRootfs,true);
  const {targetId}=await engine.command('Target.createTarget',{url:'about:blank'});const {sessionId}=await engine.command('Target.attachToTarget',{targetId,flatten:true});await engine.command('Page.enable',{},sessionId);return sessionId;
 }
 async function visit(sessionId,url){const nav=await engine.command('Page.navigate',{url},sessionId);if(nav.errorText)throw Error(nav.errorText);let body='';for(let i=0;i<100;i++){body=(await engine.command('Runtime.evaluate',{expression:'document.body?.innerText||""',returnByValue:true},sessionId)).result?.value||'';if(body&&!body.includes('This site can’t be reached'))return body;await new Promise(r=>setTimeout(r,100));}throw Error('Page body timeout '+url);}
 let session=await start('proxy');const identity=(await engine.command('Runtime.evaluate',{expression:'JSON.stringify({ua:navigator.userAgent,platform:navigator.platform,language:navigator.language,brands:navigator.userAgentData?.brands,webdriver:navigator.webdriver})',returnByValue:true},session)).result.value;assert.doesNotMatch(JSON.parse(identity).ua,/HeadlessChrome/);assert.match(JSON.parse(identity).platform,/Linux/);console.log('NATIVE_DISPLAY_BROWSER_IDENTITY',identity);assert.match(await visit(session,'http://neverssl.com/'),/PROXY_FIXTURE/);await engine.command('Runtime.evaluate',{expression:'localStorage.setItem("mode-fixture","preserved")'},session);console.log('PROXY_REAL_CHROMIUM_PASS');
 session=await start('mixed');assert.match(await visit(session,'http://neverssl.com/'),/PROXY_FIXTURE/);assert.equal(transport.route('neverssl.com'),'proxy');assert.equal((await engine.command('Runtime.evaluate',{expression:'localStorage.getItem("mode-fixture")',returnByValue:true},session)).result.value,'preserved');console.log('MIXED_PROXY_FIRST_PROFILE_PRESERVED_PASS');
 session=await start('direct');const direct=await visit(session,'https://api.ipify.org/?format=json');assert.match(direct,/"ip"/);console.log('DIRECT_REAL_CHROMIUM_PASS',direct.trim());
 assert.equal((await engine.command('Runtime.evaluate',{expression:'JSON.stringify({platform:navigator.platform,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,language:navigator.language})',returnByValue:true},session)).result.value.includes('Linux'),true);
 await engine.close();await manager.command(['stop','-t','1',prefix+'-proxy']);
 session=await start('mixed');const fallback=await visit(session,'https://api.ipify.org/?format=json');assert.match(fallback,/"ip"/);assert.equal(transport.route('api.ipify.org'),'direct');console.log('MIXED_REAL_FALLBACK_PASS',fallback.trim());
 const blocked=await visit(session,'http://127.0.0.1:8080');assert.match(blocked,/Destination blocked|Connection failed/);console.log('PRIVATE_TARGET_DENIED');
 console.log('CONTAINER_BROWSER_THREE_MODES_INTEGRATION_PASS');
}finally{
 await engine?.close();await transport?.close();
 for(const args of [['rm','-f',prefix+'-proxy'],['rm','-f',prefix+'-browser'],['volume','rm',prefix+'-browser-home'],['volume','rm',prefix+'-worker-work'],['network','rm',network],['network','rm',prefix+'-browser-egress']])try{await manager.command(args);}catch{}
}
