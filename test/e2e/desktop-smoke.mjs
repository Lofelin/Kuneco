import {verifyWorkspace} from './scenarios/workspace.mjs';
import {verifyBrowserSecurity} from './scenarios/browser-security.mjs';
import {verifyBrowserNavigation} from './scenarios/browser-navigation.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyComponents} from './scenarios/components.mjs';
import {verifyChatInteraction} from './scenarios/chat-interaction.mjs';
import {verifyTurnChangeCard} from './scenarios/turn-change-card.mjs';
import {createBrowserFixture} from './fixtures/browser-services.mjs';
import {createConsoleFixture} from './fixtures/console-service.mjs';
import {createQuitFixture} from './fixtures/quit-service.mjs';
import {verifyDialogRegression} from './scenarios/dialog-regression.mjs';
import {verifyBrowserRegression,verifyContainerBrowserRegression} from './scenarios/browser-regression.mjs';
import {verifyChatRegression,chatRegressionMapping} from './scenarios/chat-regression.mjs';
import {verifyControlsRegression,verifyQuitControlsRegression,controlsRegressionCoverage} from './scenarios/controls-regression.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));

// Old ad hoc modes used removed controls and must not silently run another suite.
const legacyMode = Object.keys(process.env).find(key => /^WORKSPACE_TEST_.*_ONLY$/.test(key) && process.env[key]);
if (legacyMode) throw new Error(`${legacyMode} 已停用；运行 npm run test:desktop，真实容器使用 npm run test:docker / test:console。`);
const passwordUsers=new Map(),passwordTokens=new Map();let passwordRound=0;
let accountRound=0,accountChallenge,accountRevoked=new Set();const accountProxies=new Map();const accountChats=new Map();const accountChatObjects=new Map();const accountProfiles=new Map();const accountRuntimes=new Map();
let browserFixture;
const accountFixture=http.createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;res.setHeader('content-type','application/json');
 const rawToken=req.headers.authorization?.replace('Bearer ','');const token=passwordTokens.get(rawToken)||rawToken;
 if(req.url==='/health'){res.end(JSON.stringify({ok:true,database:'postgresql'}));}
 else if(req.url==='/v1/auth/password'){const value=JSON.parse(body);let user=passwordUsers.get(value.username);if(value.password!==value.confirmPassword || (user && user.password!==value.password)){res.writeHead(400);res.end('{"error":"用户名或密码错误"}');return;}if(!user){user={id:String(passwordUsers.size+1),password:value.password};passwordUsers.set(value.username,user);}const issued='password-token-'+(++passwordRound);passwordTokens.set(issued,'fixture-account-'+user.id);res.end(JSON.stringify({token:issued}));}
 else if(req.url==='/v1/auth/google/start'){accountRound++;accountChallenge=JSON.parse(body).challenge;res.end(JSON.stringify({flowId:String(accountRound),authorizationUrl:`http://127.0.0.1:${accountFixture.address().port}/v1/auth/google/authorize?flow=${accountRound}`}));}
 else if(req.url==='/v1/auth/google/poll'){await new Promise(resolve=>setTimeout(resolve,700));res.end(JSON.stringify({status:'complete',token:'fixture-account-'+accountRound}));}
 else if(!token || accountRevoked.has(rawToken)){res.writeHead(401);res.end('{"error":"signed-out"}');}
 else if(req.url==='/v1/me'){const id=token.replace('fixture-account-','');res.end(JSON.stringify({id,name:'测试用户 '+id,email:`user${id}@example.test`,loginIp:'203.0.113.99',loginIpSource:'client_direct_probe',...accountProfiles.get(token)}));}
 else if(req.url==='/v1/me/profile'){accountProfiles.set(token,{...accountProfiles.get(token),...JSON.parse(body)});res.end('{}');}
 else if(req.url==='/v1/me/avatar'){res.writeHead(404);res.end('{}');}
 else if(req.url==='/v1/me/proxy'){if(req.method==='PUT'){accountProxies.set(token,JSON.parse(body));res.end('{"saved":true}');}else res.end(JSON.stringify({proxy:accountProxies.get(token) || null}));}
 else if(req.url.startsWith('/v1/me/local-environment') && req.method==='DELETE'){accountProxies.delete(token);accountRuntimes.delete(token+':'+new URL(req.url,'http://fixture.test').searchParams.get('host'));res.end('{"deleted":true}');}
 else if(req.url.startsWith('/v1/me/runtimes')){if(req.method==='PUT'){const registry=JSON.parse(body);accountRuntimes.set(token+':'+registry.hostName,registry);res.end('{"saved":true}');}else{const host=new URL(req.url,'http://fixture.test').searchParams.get('host');res.end(JSON.stringify({registry:accountRuntimes.get(token+':'+host)||null}));}}
 else if(req.url.startsWith('/v1/me/chat-objects/')){const key=token+':'+req.url;if(req.method==='PUT'){accountChatObjects.set(key,JSON.parse(body));res.end('{}');}else if(accountChatObjects.has(key))res.end(JSON.stringify(accountChatObjects.get(key)));else{res.writeHead(404);res.end('{"error":"missing fixture object"}');}}
 else if(req.url==='/v1/me/chats'){if(req.method==='PUT'){const next=JSON.parse(body),old=accountChats.get(token) || {revision:0};if(old.revision!==next.revision){res.writeHead(409);res.end('{"error":"conflict"}');}else{accountChats.set(token,{revision:old.revision+1,payload:next.payload});res.end(JSON.stringify({revision:old.revision+1}));}}else res.end(JSON.stringify(accountChats.get(token) || {revision:0,payload:null}));}
 else if(req.url==='/v1/auth/logout'){accountRevoked.add(rawToken);res.end('{"ok":true}');}
 else if(browserFixture && await browserFixture.route(req,res,token,body)){}
 else{res.writeHead(404);res.end(JSON.stringify({error:'Unsupported fixture route: '+req.url}));}
});
const sockets = new Set(); let child;let consoleFixture; let stderr='';let browserRequests = 0; let exitRequests = 0; let client; let popupPost = null; let fixtureExitIp = '203.0.113.23'; let acceptLanguages = [];
const stun = dgram.createSocket('udp4'); let stunPackets = 0; stun.on('message',()=>stunPackets++);
const temp = await realpath(await mkdtemp(path.join(tmpdir(), 'kuneco-desktop-')));
const realmProbe = () => {
  const context = new OffscreenCanvas(80, 20).getContext('2d');
  context.font = '20px monospace'; const base = context.measureText('mmmmmmmmmmlli').width;
  context.font = '20px "PingFang SC", monospace';
  let localAllowed = false; try { new FontFace('probe', 'local("PingFang SC")'); localAllowed = true; } catch {}
  let rtcBlocked = true; try { if (typeof RTCPeerConnection === 'function') { const pc = new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:3478'}]}); pc.close(); rtcBlocked = false; } } catch {}
  return { rtcAbsent: typeof RTCPeerConnection === 'undefined', installed: Boolean(globalThis.__workspacePolicyInstalled), font: context.font, sameWidth: context.measureText('mmmmmmmmmmlli').width === base, localAllowed, rtcBlocked };
};
const target = http.createServer((req, res) => {
  acceptLanguages.push(req.headers['accept-language']);
  if (req.url === '/privacy-frame') { browserRequests++; res.end(`<script>parent.postMessage({kind:'frame-proof',origin:location.hostname,result:(${realmProbe.toString()})()},'*')</script>`); }
  else if (req.url === '/privacy-worker.js' || req.url === '/privacy-nested.js' || req.url === '/privacy-module.js') { browserRequests++; res.setHeader('Content-Type','text/javascript'); res.end(`const result=(${realmProbe.toString()})();postMessage(result);${req.url === '/privacy-worker.js' ? "const child=new Worker('/privacy-nested.js');child.onmessage=e=>{postMessage({nested:e.data});child.terminate()}" : ''}`); }
  else if (req.url === '/privacy-shared.js') { browserRequests++; res.setHeader('Content-Type','text/javascript'); res.end(`const result=(${realmProbe.toString()})();onconnect=e=>{e.ports[0].postMessage(result)}`); }
  else if (req.url === '/privacy-sw.js') { browserRequests++; res.setHeader('Content-Type','text/javascript'); res.end(`const result=(${realmProbe.toString()})();addEventListener('install',e=>e.waitUntil(skipWaiting()));addEventListener('activate',e=>e.waitUntil(clients.claim()));addEventListener('message',e=>e.source.postMessage({kind:'sw-proof',result}));`); }
  else if (req.url === '/exit') { exitRequests++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ip: fixtureExitIp })); }
  else if (req.url === '/opener') { browserRequests++; res.end(`<title>模拟登录入口</title><form action='/popup-post' method='post' target='login-popup'><input name='code' value='fixture-code'></form><script>addEventListener('message',event=>{if(event.data==='fixture-callback')document.body.dataset.callback='received'})</script>`); }
  else if (req.url === '/popup-post') { browserRequests++; let body=''; req.on('data',chunk=>body+=chunk); req.on('end',()=>{ popupPost={method:req.method,body}; res.writeHead(302,{Location:'/popup-result'});res.end(); }); }
  else if (req.url === '/popup-result') { browserRequests++; res.end(`<title>模拟登录回调</title><script>setTimeout(()=>{if(window.opener)window.opener.postMessage('fixture-callback','*');window.close()},600)</script>`); }
  else if (req.url === '/slow') { browserRequests++; setTimeout(() => { if (!res.destroyed) res.end('<h1>慢页面</h1>'); }, 1500); }
  else if (req.url === '/redirect') { browserRequests++; res.writeHead(302, { Location: '/final' }); res.end(); }
  else { browserRequests++; res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>代理验收页面</title><body><h1>浏览器已通过模拟代理</h1><p>这是本机测试，不会登录账号或调用模型。</p></body></html>'); }
});
const proxy = http.createServer();
proxy.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); });
proxy.on('connect', (req, socket, head) => {
  if (req.headers['proxy-authorization'] !== `Basic ${Buffer.from('demo:secret').toString('base64')}`) { socket.end('HTTP/1.1 407 Authentication Required\r\n\r\n'); return; }
  const destination = new URL(`http://${req.url}`);
  if (!['fixture.invalid', 'frame.invalid'].includes(destination.hostname)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  const upstream = net.connect(target.address().port, '127.0.0.1', () => { socket.write('HTTP/1.1 200 OK\r\n\r\n'); if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket); });
  sockets.add(upstream); upstream.on('error', () => socket.destroy()); upstream.once('close', () => { sockets.delete(upstream); socket.destroy(); }); socket.once('close', () => upstream.destroy());
});
async function start(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 15000) { const deadline = Date.now() + timeout; let cause; while (Date.now() < deadline) { try { const value = await fn(); if (value) return value; } catch(error) { cause=error; } await pause(100); } throw new Error('桌面验收等待超时：'+String(fn).slice(0,200),{cause}); }
async function connectCDP(url) {
  const ws = new WebSocket(url); let id = 0; const pending = new Map();
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { const p = pending.get(message.id); pending.delete(message.id); clearTimeout(p?.timer); if (message.error) p?.reject(new Error(message.error.message)); else p?.resolve(message.result); } });
  ws.addEventListener('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('桌面调试连接已关闭'));}pending.clear();});
  return { close: () => ws.close(), call(method, params = {}) { const requestId = ++id; return new Promise((resolve, reject) => { const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('桌面CDP超时 '+method+' '+String(params?.expression||'').slice(0,180)));},20000);pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ id: requestId, method, params })); }); } };
}
function fixtureClient(url) { return { close() {}, call(method, params) { return evaluate('window.workspace.browserProbe('+JSON.stringify(url)+','+JSON.stringify(params)+','+JSON.stringify(method)+')'); } }; }
async function captureUI(){await pause(180);await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");return client.call('Page.captureScreenshot');}
async function evaluate(expression) { if(expression.startsWith('await '))expression='(async()=>{'+expression+'})()'; const value = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text); return value.result?.value; }
try {
 await rm(path.join(root,'artifacts/legacy-migration.json'),{force:true});
 browserFixture=createBrowserFixture({directory:temp,localURL:'http://fixture.invalid'});
 await start(accountFixture);await start(target);await start(proxy);await new Promise(resolve=>stun.bind(0,'127.0.0.1',resolve));
 const portFinder=net.createServer();await start(portFinder);const debugPort=portFinder.address().port;await new Promise(resolve=>portFinder.close(resolve));
 const bin=path.join(temp,'fixture-bin');await mkdir(bin);
 // Deterministic local CLI: discovery/auth/protocol only; never call a real AI provider.
 const modelControl=path.join(temp,'model-control.json');await writeFile(modelControl,JSON.stringify({}));
 const mock=`#!/usr/bin/env node
if(process.argv.includes('--version')){console.log('codex fixture 1.0');process.exit(0);}
if(process.argv[2]==='login'){console.log('Logged in using ChatGPT');process.exit(0);}
if(process.argv[2]==='app-server'){let cwd;require('readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 if(m.method==='initialize')console.log(JSON.stringify({id:m.id,result:{userAgent:'kuneco-desktop-fixture'}}));
 else if(m.method==='model/list'){const fs=require('fs'),config=JSON.parse(fs.readFileSync(process.env.WORKSPACE_TEST_MODEL_CONTROL,'utf8'));fs.appendFileSync(process.env.WORKSPACE_TEST_MODEL_CONTROL+'.requests','model/list\\n');setTimeout(()=>console.log(JSON.stringify({id:m.id,result:{data:config.catalog||[{id:'desktop-fixture-model',model:'desktop-fixture-model',displayName:'Desktop fixture model',hidden:false,isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'medium',description:'Fixture default'},{reasoningEffort:'high',description:'Fixture high'}],defaultReasoningEffort:'medium'}],nextCursor:null}})),config.delayMs||0);}
 else if(m.method==='thread/start'||m.method==='thread/resume'){cwd=m.params.cwd;console.log(JSON.stringify({id:m.id,result:{thread:{id:'turn-card-fixture-thread'}}}));}
 else if(m.method==='turn/start'){
  if(require(${JSON.stringify(path.join(root,'test/e2e/scenarios/chat-regression-cli.cjs'))})({message:m,cwd,threadId:'turn-card-fixture-thread',emit:value=>console.log(JSON.stringify(value))}))return;
  if(JSON.parse(require('fs').readFileSync(process.env.WORKSPACE_TEST_MODEL_CONTROL,'utf8')).holdAll){console.log(JSON.stringify({id:m.id,result:{turn:{id:'held-turn'}}}));setInterval(()=>{},1000);return;}
  const threadId='turn-card-fixture-thread',turnId='turn-card-fixture-turn';console.log(JSON.stringify({id:m.id,result:{turn:{id:turnId}}}));
  const changes=[];if(m.params.input.some(i=>i.type==='text'&&i.text.includes('KUNECO_TURN_CARD_E2E'))){for(const letter of ['a','b','c','d']){const path=require('path').join(cwd,'fixture-'+letter+'.txt'),before='before '+letter+'\\n',after='after '+letter+'\\n';if(require('fs').readFileSync(path,'utf8')!==before)throw Error('unexpected fixture content');require('fs').writeFileSync(path,after);changes.push({path,before,after,beforeExists:true,afterExists:true});}}
  if(changes.length)console.log(JSON.stringify({method:'item/completed',params:{threadId,item:{id:'turn-card-edit',type:'fileChange',changes}}}));
  console.log(JSON.stringify({method:'item/completed',params:{threadId,item:{id:'turn-card-answer',type:'agentMessage',text:'已完成本地夹具文件修改。'}}}));
  console.log(JSON.stringify({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}}));
 }
 else console.log(JSON.stringify({id:m.id,error:{code:-32601,message:'Unsupported fixture method: '+m.method}}));
});}
else {process.stdin.resume();process.stdin.on('end',()=>{let control={};try{control=JSON.parse(require('fs').readFileSync(process.env.WORKSPACE_TEST_MODEL_CONTROL,'utf8'));}catch{}if(control.holdAll){console.log(JSON.stringify({type:'thread.started',thread_id:'quit-automation-fixture'}));setInterval(()=>{},1000);return;}console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'fixture response'}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));});}
`;
 await writeFile(path.join(bin,'codex'),mock,{mode:0o700});
 child=spawn(process.execPath,['src/app/start.mjs',`--remote-debugging-port=${debugPort}`,'--test-fixture','--enable-automation','--site-per-process','--unsafely-treat-insecure-origin-as-secure=http://fixture.invalid,http://frame.invalid'],{cwd:root,env:{...process.env,WORKSPACE_TEST_MODEL_CONTROL:modelControl,WORKSPACE_TEST_AUTH_ONLY:'',PATH:bin+path.delimiter+process.env.PATH,WORKSPACE_ACCOUNT_SERVER_URL:`http://127.0.0.1:${accountFixture.address().port}`,WORKSPACE_TEST_PROBE_URL:'http://fixture.invalid/exit',WORKSPACE_TEST_HOME_URL:'http://fixture.invalid/home',WORKSPACE_TEST_ENV:JSON.stringify({timeZone:'America/New_York',languages:['en-US']}),WORKSPACE_TEST_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>process.stdout.write(chunk));
 child.stderr.on('data',chunk=>stderr+=chunk);
 const page=await until(async()=>(await fetch(`http://127.0.0.1:${debugPort}/json`).then(r=>r.json())).find(p=>p.url.includes('src/index.html')));
 const version=await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(response=>response.json());
 const browserClient=await connectCDP(version.webSocketDebuggerUrl);
 try{const identity=await browserClient.call('Browser.getBrowserCommandLine');if(process.platform==='darwin')assert.match(identity.arguments[0],/Kuneco[.]app\/Contents\/MacOS\/Kuneco$/);assert.ok(identity.arguments.includes('.'));await mkdir(path.join(root,'artifacts'),{recursive:true});await writeFile(path.join(root,'artifacts/desktop-launch.json'),JSON.stringify({entry:'src/app/start.mjs',executable:identity.arguments[0],page:page.url},null,2));}finally{browserClient.close();}
 client=await connectCDP(page.webSocketDebuggerUrl);
 await until(()=>evaluate("performance.getEntriesByName('chat-records-ready').length>0"));
 const context={evaluate,until,client,temp,proxyPort:proxy.address().port,fixtureClient,debugPort,realmProbe,stun,acceptLanguages,getStderr:()=>stderr,getStunPackets:()=>stunPackets,getPopupPost:()=>popupPost,getBrowserRequests:()=>browserRequests,getExitRequests:()=>exitRequests,setExitIP:value=>fixtureExitIp=value,accountProfiles,accountChats,accountChatObjects,captureUI,browserRegressionFixture:browserFixture.api};
 await verifyWorkspace(context,async()=>{await verifyBrowserSecurity(context);await verifyBrowserNavigation(context);},async()=>verifyChatInteraction(context),async()=>verifyComponents(context));
 await verifyTurnChangeCard(context);
 context.controlsFixture={models:{
  async configure(value){await writeFile(modelControl,JSON.stringify({catalog:value.models,delayMs:value.delayMs}));},
  async requests(){try{return (await readFile(modelControl+'.requests','utf8')).trim().split('\n').filter(Boolean).length;}catch{return 0;}},
  async restore(){await writeFile(modelControl,'{}');},
 }};
 consoleFixture=createConsoleFixture(context);
 await consoleFixture.prepare();await evaluate("workspace.dockerEnvironments('select',{id:null})");
 context.controlsFixture.console={...consoleFixture,prepare:async()=>{const value=await consoleFixture.prepare();await verifyContainerBrowserRegression(context);return value;}};
 context.controlsFixture.quit=createQuitFixture({evaluate,until,client,modelControl,child,directory:temp});
 console.log('Regression stage: chat state/history/drafts');await verifyChatRegression(context);
 console.log('Regression stage: browser library/settings');await verifyBrowserRegression(context);
 console.log('Regression stage: global controls/console');await verifyControlsRegression(context);
 console.log('Regression stage: all mounted dialogs');await verifyDialogRegression(context);
 console.log('Regression stage: final real quit guard');const quitEvidence=await verifyQuitControlsRegression(context);
 assert.doesNotMatch(stderr,/UnhandledPromiseRejection|uncaughtException/);
 await writeFile(path.join(root,'artifacts/legacy-migration.json'),JSON.stringify({passed:true,at:new Date().toISOString(),chat:chatRegressionMapping,controls:controlsRegressionCoverage,quitEvidence,dialogs:'dialog-regression.mjs all real mounted dialogs',browser:'browser-regression.mjs BL-01..10, BS-01..06, BL-03-container-ui + IPC'},null,2));
 console.log('PASS 完整桌面验收：组件与布局、运行时与会话、通知持久化、代理导入与固定出口、浏览器隔离/导航/弹窗/断网、账号隔离。仅本地夹具，未调用真实账号或模型。');
} catch(error){
 console.error('Desktop application diagnostics:\n'+stderr);
 if(client){try{const screenshot=await client.call('Page.captureScreenshot');await mkdir(path.join(root,'artifacts'),{recursive:true});await writeFile(path.join(root,'artifacts/desktop-failure.png'),Buffer.from(screenshot.data,'base64'));}catch{}}
 throw error;
} finally {
 browserFixture?.api.releaseCookies();await consoleFixture?.cleanup().catch(error=>{console.error('Test-owned console cleanup failed:',error.message);process.exitCode=1;});
 accountFixture.close();stun.close();client?.close();child?.kill('SIGTERM');
 if(child&&child.exitCode===null)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(3000)]);
 for(const socket of sockets)socket.destroy();
 target.closeAllConnections();await new Promise(resolve=>target.close(resolve));await new Promise(resolve=>accountFixture.close(resolve));await new Promise(resolve=>proxy.close(resolve));
 await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
