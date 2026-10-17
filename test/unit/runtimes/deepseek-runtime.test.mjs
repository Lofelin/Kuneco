import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {configureDeepSeek,runDeepSeekCLI,requestDeepSeek} from '../../../src/features/runtimes/deepseek-runtime.mjs';
import {runDeepSeek} from '../../../src/features/runtimes/deepseek-runner.mjs';
import {validateSessionOptions} from '../../../src/features/chat/session-options.mjs';

test('DeepSeek configuration validates first, protects credentials, and returns only model metadata',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-deepseek-'));
 try{
  const result=await configureDeepSeek(directory,{apiKey:'fixture-private-key'},async route=>{assert.equal(route,'/models');return {data:[{id:'deepseek-fixture',name:'Fixture'}]};});
  assert.equal(result.model,'deepseek-fixture');assert.ok(!JSON.stringify(result).includes('fixture-private-key'));
  assert.equal((await stat(path.join(directory,'credentials.json'))).mode & 0o777,0o600);
  await assert.rejects(configureDeepSeek(directory,{apiKey:'replacement-private-key'},async()=>{throw new Error('API Key 无效');}),/无效/);
  assert.equal(JSON.parse(await readFile(path.join(directory,'credentials.json'),'utf8')).apiKey,'fixture-private-key');
  const info=await runDeepSeekCLI('info',{}, {directory});assert.equal(info.id,'deepseek');assert.ok(!JSON.stringify(info).includes('fixture-private-key'));
  assert.equal((await runDeepSeekCLI('auth',{}, {directory})).state,'signed-in');
  const calls=[],sessionId='cdbe55c5-66ba-4607-88f0-a58cd65a6746';
  const request=async(proxy,key,route,body)=>{assert.equal(key,'fixture-private-key');assert.equal(route,'/chat/completions');calls.push(body);return {choices:[{message:{content:'模拟回复'}}]};};
  await runDeepSeekCLI('chat',{sessionId,prompt:'第一条'}, {directory,request});
  await runDeepSeekCLI('chat',{sessionId,prompt:'第二条'}, {directory,request});
  assert.deepEqual(calls[1].messages.map(m=>m.content),['第一条','模拟回复','第二条']);
  const file=path.join(directory,sessionId+'.json'),before=await readFile(file,'utf8');
  await assert.rejects(runDeepSeekCLI('chat',{sessionId,prompt:'失败消息'}, {directory,request:async()=>{throw new Error('断线');}}),/断线/);
  assert.equal(await readFile(file,'utf8'),before);
  await assert.rejects(runDeepSeekCLI('chat',{sessionId:'../../bad',prompt:'x'}, {directory,request}),/无效/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('DeepSeek has no direct-network fallback without an HTTP proxy',async()=>{
 await assert.rejects(requestDeepSeek('', 'fixture-key','/models'),/代理/);
 await assert.rejects(requestDeepSeek('https://127.0.0.1:1','fixture-key','/models'),/HTTP 代理/);
});
test('DeepSeek runner passes only session data, delivers response and handles cancellation',async()=>{
 const makeChild=()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',1);return child;};
 const child=makeChild(),controller=new AbortController();let input='',answer='';child.stdin.on('data',c=>input+=c);
 const completed=runDeepSeek({spawnProcess:options=>{assert.equal(options.command,'node');assert.deepEqual(options.args,['/home/node/.local/lib/dingtu/deepseek.mjs','chat']);return child;},sessionId:'fixture-session',prompt:'hello',signal:controller.signal,onText:text=>answer=text});
 child.stdout.write(JSON.stringify({text:'reply'}));child.emit('close',0);await completed;
 assert.equal(answer,'reply');assert.equal(JSON.parse(input).prompt,'hello');assert.ok(!input.includes('apiKey'));
 const cancelledChild=makeChild();const cancelled=runDeepSeek({spawnProcess:()=>cancelledChild,prompt:'cancel',signal:controller.signal,onText:()=>assert.fail()});controller.abort();cancelledChild.emit('close',1);await assert.rejects(cancelled,/取消/);
 assert.equal(validateSessionOptions({engine:'deepseek',model:'deepseek-fixture'}).engine,'deepseek');
});

test('DeepSeek HTTPS goes through authenticated CONNECT and verifies its TLS certificate',async()=>{
 const {execFileSync,spawn}=await import('node:child_process');
 const https=await import('node:https'),http=await import('node:http'),net=await import('node:net');
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-deepseek-tls-'));
 let target,proxy;const sockets=new Set();
 const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(directory,'key.pem'),'-out',path.join(directory,'cert.pem'),'-days','1','-subj','/CN=api.deepseek.com','-addext','subjectAltName=DNS:api.deepseek.com'],{stdio:'ignore'});
  let apiAuth='',proxyAuth='',destination='',tunnels=0,mutations=0;
  target=https.createServer({key:await readFile(path.join(directory,'key.pem')),cert:await readFile(path.join(directory,'cert.pem'))},(req,res)=>{apiAuth=req.headers.authorization;if(req.url==='/upgrade'){res.writeHead(101,{connection:'Upgrade',upgrade:'fixture'});res.flushHeaders();return;}if(req.url==='/chat/completions'){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'finished'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return;}if(req.method==='POST'){mutations++;req.socket.destroy();return;}assert.equal(req.url,'/models');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'deepseek-fixture'}]}));});
  const targetPort=await listen(target);proxy=http.createServer();
  proxy.on('connect',(req,client,head)=>{tunnels++;destination=req.url;proxyAuth=req.headers['proxy-authorization'];const upstream=net.connect(targetPort,'127.0.0.1',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});sockets.add(client);sockets.add(upstream);client.on('error',()=>{});upstream.on('error',()=>{});});
  const proxyPort=await listen(proxy);
  const script=`import {requestDeepSeek,closeDeepSeekConnections} from ${JSON.stringify(new URL('../../../src/features/runtimes/deepseek-runtime.mjs',import.meta.url).href)}; const request=()=>requestDeepSeek('http://proxy-user:proxy-pass@127.0.0.1:${proxyPort}','fixture-api-key','/models');await request();console.log(JSON.stringify(await request()));const streamed=await requestDeepSeek('http://proxy-user:proxy-pass@127.0.0.1:${proxyPort}','fixture-api-key','/chat/completions',{stream:true},{timeouts:{body:200}});(await import('node:assert/strict')).default.equal(streamed.choices[0].message.content,'finished');await (await import('node:assert/strict')).default.rejects(requestDeepSeek('http://proxy-user:proxy-pass@127.0.0.1:${proxyPort}','fixture-api-key','/upgrade',{stream:true},{timeouts:{total:500}}),e=>e.code==='REQUEST_UPGRADE_UNSUPPORTED');await (await import('node:assert/strict')).default.rejects(requestDeepSeek('http://proxy-user:proxy-pass@127.0.0.1:${proxyPort}','fixture-api-key','/models',{mutation:true}));closeDeepSeekConnections();`;
  const run=extra=>new Promise(resolve=>{const child=spawn(process.execPath,['--input-type=module','-e',script],{env:{...process.env,...extra}});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.once('close',code=>resolve({code,out,err}));});
  const success=await run({NODE_EXTRA_CA_CERTS:path.join(directory,'cert.pem')});assert.equal(success.code,0,success.err);assert.equal(JSON.parse(success.out).data[0].id,'deepseek-fixture');
  assert.equal(mutations,1,'failed POST must never be replayed');assert.equal(tunnels,3,'models and stream reuse one tunnel; DONE and rejected upgrade retire their sockets without replay');assert.equal(destination,'api.deepseek.com:443');assert.equal(proxyAuth,'Basic '+Buffer.from('proxy-user:proxy-pass').toString('base64'));assert.equal(apiAuth,'Bearer fixture-api-key');
  const untrusted=await run({NODE_EXTRA_CA_CERTS:''});assert.notEqual(untrusted.code,0);assert.ok(!untrusted.err.includes('fixture-api-key'));assert.ok(!untrusted.err.includes('proxy-pass'));
 }finally{for(const socket of sockets)socket.destroy();target?.close();proxy?.close();await rm(directory,{recursive:true,force:true});}
});

test('DeepSeek container installation sends the secret only over stdin and never uses npm packages',async()=>{
 const {DockerEnvironments}=await import('../../../src/features/environments/docker-environments.mjs');
 const manager=new DockerEnvironments({directory:'/unused',sourceRoot:path.resolve('.')});const calls=[];
 manager.get=async()=>({item:{}});manager.update=async()=>{};manager.exec=async(owner,id,args,options)=>{assert.equal(owner,'owner');assert.equal(id,'container');calls.push({args,options});return '';};manager.runRuntimeInstaller=async(owner,id,args,options)=>{calls.push({args,options});return '';};manager.runtimeInfo=async()=>({runtimes:[{id:'deepseek'}]});
 const result=await manager.installRuntime('owner','container','deepseek',{apiKey:'fixture-secret-only-stdin',model:'deepseek-v4-pro'});
 assert.equal(result.runtimes[0].id,'deepseek');assert.equal(calls.length,2);assert.equal(JSON.parse(calls[1].options.input).model,'deepseek-v4-pro');
 assert.ok(!JSON.stringify(calls.map(c=>c.args)).includes('fixture-secret-only-stdin'));
 assert.ok(!calls.some(c=>c.args.includes('npm')));assert.equal(JSON.parse(calls[1].options.input).apiKey,'fixture-secret-only-stdin');
});

test('Runtime display metadata is environment scoped and survives detection; failed installation leaves it unchanged',async()=>{
 const {DockerEnvironments}=await import('../../../src/features/environments/docker-environments.mjs');
 const manager=new DockerEnvironments({directory:'/unused',sourceRoot:path.resolve('.')});
 const item={name:'fixture-environment',runtimeMetadata:{codex:{name:'原有 Codex'}}};let fail=false;
 manager.get=async()=>({item,prefix:'fixture'});manager.update=async(owner,id,patch)=>{assert.equal(owner,'owner');assert.equal(id,'environment');Object.assign(item,patch);};
 manager.runRuntimeInstaller=async()=>{if(fail)throw new Error('安装失败');return '';};manager.command=async()=> 'true';manager.detectCommands=async()=>({runtimes:[{id:'cc',name:'Claude Code',version:'fixture'},{id:'codex',name:'Codex',version:'fixture'}],checkedAt:'fixture'});
 const result=await manager.installRuntime('owner','environment','cc',{name:'我的 Claude',description:'项目助手'});
 assert.equal(result.runtimes[0].name,'我的 Claude');assert.equal(result.runtimes[0].description,'项目助手');assert.equal(result.runtimes[1].name,'原有 Codex');
 const addedAt=result.runtimes[0].addedAt;assert.ok(Number.isFinite(Date.parse(addedAt)));
 await assert.rejects(manager.installRuntime('owner','environment','cc',{name:'我的 Claude'}),/已添加/);assert.equal(item.runtimeMetadata.cc.addedAt,addedAt);assert.equal(item.runtimeMetadata.cc.description,'项目助手');
 const detected=await manager.runtimeInfo('owner','environment',true);assert.equal(detected.runtimes[0].name,'我的 Claude');
 fail=true;await assert.rejects(manager.installRuntime('owner','environment','qwen',{name:'失败名称'}),/失败/);assert.equal(item.runtimeMetadata.cc.name,'我的 Claude');
 await assert.rejects(manager.installRuntime('owner','environment','cc',{name:''}),/名称/);
});


test('Runtime installer has direct download network, scoped volume and cleanup on failure',async()=>{
 const {DockerEnvironments,runtimeInstallerArguments}=await import('../../../src/features/environments/docker-environments.mjs');
 const {RUNTIME_INSTALL_COMMANDS}=await import('../../../src/features/runtimes/runtime-install-config.mjs');
 const args=runtimeInstallerArguments({name:'fixture-installer',prefix:'fixture',args:['bash','-o','pipefail','-c',RUNTIME_INSTALL_COMMANDS.cc]});
 assert.ok(args.includes('bridge'));assert.ok(args.includes('1000:1000'));assert.ok(args.includes('--read-only'));
 assert.deepEqual(args.filter(a=>a.startsWith('type=volume')),['type=volume,src=fixture-worker-home,dst=/home/node']);
 assert.ok(!args.some(a=>a.includes('docker.sock') || a==='--privileged'));
 for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])assert.ok(args.includes(key+'='));
 assert.equal(args.at(-1),'npm install -g @anthropic-ai/claude-code');assert.equal(RUNTIME_INSTALL_COMMANDS.codex,'npm install -g @openai/codex');
 for(const created of [false,true]){
  const manager=new DockerEnvironments({directory:'/unused',sourceRoot:path.resolve('.')});const calls=[];
  const failure=new Error('fixture download failed');let present=created,name;
  manager.get=async()=>({item:{imageName:'fixture-image'},prefix:'fixture'});
  manager.command=async args=>{
   calls.push(args);
   if(args[0]==='run'){name=args[args.indexOf('--name')+1];throw failure;}
   if(args[0]==='inspect'){if(!present)throw new Error('No such container');return JSON.stringify({Id:'fixture-installer-id',Config:{Labels:{app:'dingtu-installer','io.kuneco.environment':'fixture'}}});}
   if(args[0]==='ps')return present?(args.includes('{{.Names}}')?name:'fixture-installer-id'):'';
   if(args[0]==='stop')return '';
   if(args[0]==='rm'){present=false;return 'fixture-installer-id';}
   throw new Error('Unexpected Docker command: '+args.join(' '));
  };
  await assert.rejects(manager.runRuntimeInstaller('owner','id',['npm','--version']),error=>error===failure);
  assert.equal(manager.directTasks.size,0);
  assert.ok(calls[0].includes('io.kuneco.environment=fixture'));
  const mutations=calls.filter(args=>['stop','rm'].includes(args[0]));
  assert.deepEqual(mutations,created?[['stop','-t','3','fixture-installer-id'],['rm','-f','fixture-installer-id']]:[]);
  assert.ok(!calls.flat().includes('-v'));
 }
 await assert.rejects(requestDeepSeek('', 'fixture-key','/chat/completions',{messages:[]},{installation:true}),/代理/);
});

test('DeepSeek selected model persists, is used by default, and unsupported selection preserves credentials',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-model-selection-'));
 try{
  const request=async()=>({data:[{id:'deepseek-flash'},{id:'deepseek-v4-pro'}]});
  await configureDeepSeek(directory,{apiKey:'fixture-key',model:'deepseek-v4-pro'},request);
  const info=await runDeepSeekCLI('info',{}, {directory});assert.equal(info.model,'deepseek-v4-pro');
  await runDeepSeekCLI('chat',{sessionId:'12345678-1234-1234-1234-123456789012',prompt:'hello'},{directory,request:async(proxy,key,route,body)=>{assert.equal(body.model,'deepseek-v4-pro');return {choices:[{message:{content:'fixture'}}]};}});
  await assert.rejects(configureDeepSeek(directory,{apiKey:'another-key',model:'unsupported'},request),/不支持/);
  assert.equal((await runDeepSeekCLI('info',{}, {directory})).model,'deepseek-v4-pro');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('DeepSeek explicit direct chat is passed per request and does not change the proxy default',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-chat-mode-'));
 try{
  await configureDeepSeek(directory,{apiKey:'fixture-key'},async()=>({data:[{id:'fixture-model'}]}));
  const modes=[];const request=async(_proxy,_key,_route,_body,options)=>{modes.push(options.direct);return {choices:[{message:{content:'fixture reply'}}]};};
  const input={sessionId:'12345678-1234-1234-1234-123456789abc',prompt:'fixture'};
  await runDeepSeekCLI('chat',{...input,networkMode:'direct'},{directory,request});
  await runDeepSeekCLI('chat',input,{directory,request});
  assert.deepEqual(modes,[true,true,false,false]);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('DeepSeek SSE emits text before completion across fragmented UTF-8 frames',async()=>{
 const {readDeepSeekStream}=await import('../../../src/features/runtimes/deepseek-runtime.mjs');
 const response=new PassThrough(),parts=[];
 const result=readDeepSeekStream(response,text=>parts.push(text));
 const frame=Buffer.from('data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\n');
 for(const byte of frame)response.write(Buffer.from([byte]));
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(parts,['你好']);
 response.end('data: {"choices":[{"delta":{"content":"世界"}}]}\n\ndata: [DONE]\n\n');
 assert.equal((await result).choices[0].message.content,'你好世界');
 const broken=new PassThrough(),failure=readDeepSeekStream(broken);broken.end('data: {"choices":[]}\n\n');
 await assert.rejects(failure,/中断/);
});

test('DeepSeek runner forwards fragmented delta records before process exit without duplication',async()=>{
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',1);
 const parts=[];const completed=runDeepSeek({spawnProcess:()=>child,prompt:'fixture',onText:text=>parts.push(text)});
 child.stdout.write('{"type":"del');child.stdout.write('ta","text":"第一段"}\n');
 assert.deepEqual(parts,['第一段']);
 child.stdout.write('{"type":"delta","text":"第二段"}\n{"type":"done","usage":{"total_tokens":5}}\n');child.emit('close',0);
 assert.deepEqual(await completed,{total_tokens:5});assert.deepEqual(parts,['第一段','第二段']);
});

test('DeepSeek installation without a model keeps every available model for per-chat selection',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-all-models-'));
 try{
  const models=['fixture-fast','fixture-reasoning'];
  await configureDeepSeek(directory,{apiKey:'fixture-key'},async()=>({data:models.map(id=>({id}))}));
  const info=await runDeepSeekCLI('info',{}, {directory});
  assert.deepEqual(info.models.map(item=>item.model),models);
  await runDeepSeekCLI('chat',{sessionId:'12345678-1234-1234-1234-123456789012',prompt:'hello',model:models[1]},{directory,request:async(_proxy,_key,_route,body)=>{assert.equal(body.model,models[1]);return {choices:[{message:{content:'fixture'}}]};}});
  assert.deepEqual((await runDeepSeekCLI('info',{}, {directory})).models,info.models);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('DeepSeek admission bounds asynchronous CONNECT handshakes and queued mutations',async()=>{
 const http=await import('node:http');const {requestDeepSeek,closeDeepSeekConnections}=await import('../../../src/features/runtimes/deepseek-runtime.mjs');
 const proxy=http.createServer(),sockets=new Set();let connects=0;
 proxy.on('connect',(_req,socket)=>{connects++;sockets.add(socket);socket.resume();socket.on('end',()=>socket.destroy());socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});
 await new Promise(r=>proxy.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+proxy.address().port;
 const results=[];const controller=new AbortController();
 const start=(options={})=>{const p=requestDeepSeek(url,'fixture-key','/chat/completions',{mutation:true},{timeouts:{tunnel:5000,...options.timeouts},...options}).then(()=>({ok:true}),e=>({code:e.code,name:e.name,phase:e.phase}));results.push(p);return p;};
 try{
  for(let i=0;i<4;i++)start();start({signal:controller.signal});for(let i=0;i<15;i++)start({timeouts:{queue:80,tunnel:5000}});
  assert.equal((await start()).code,'REQUEST_BUSY');controller.abort();
  await new Promise(r=>setTimeout(r,130));assert.equal(connects,4,'handshakes must be bounded before async Agent callback');
  assert.ok((await Promise.all(results.slice(5,20))).every(r=>r.code==='REQUEST_TIMEOUT'&&r.phase==='queue'));
  closeDeepSeekConnections();assert.ok((await Promise.all(results)).every(r=>!r.ok));
  await new Promise(r=>setTimeout(r,30));assert.equal(sockets.size,0);assert.equal(connects,4,'cancelled and expired POSTs must never dispatch or retry');
 }finally{closeDeepSeekConnections();for(const socket of sockets)socket.destroy();await new Promise(r=>proxy.close(r));}
});

test('DeepSeek worker sync includes the shared request admission dependency',async()=>{
 const {DockerEnvironments}=await import('../../../src/features/environments/docker-environments.mjs');
 const manager=new DockerEnvironments({directory:'/unused',sourceRoot:path.resolve('.')});let files;
 manager.exec=async(_owner,_id,_args,options)=>{files=JSON.parse(options.input);};
 await manager.syncDeepSeekSource('fixture-owner','fixture-environment');
 assert.ok(files['dingtu/deepseek.mjs'].includes("../proxy/request-admission.mjs"));
 assert.ok(files['proxy/request-admission.mjs'].includes('export class BoundedRequests'));
});
