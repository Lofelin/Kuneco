import {verifyWorkspace} from './scenarios/workspace.mjs';
import {verifyBrowserSecurity} from './scenarios/browser-security.mjs';
import {verifyBrowserNavigation} from './scenarios/browser-navigation.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';

// Old ad hoc modes used removed controls and must not silently run another suite.
const legacyMode = Object.keys(process.env).find(key => /^WORKSPACE_TEST_.*_ONLY$/.test(key) && process.env[key]);
if (legacyMode) throw new Error(`${legacyMode} 已停用；运行 npm run test:desktop，真实容器使用 npm run test:docker / test:console。`);
const passwordUsers=new Map(),passwordTokens=new Map();let passwordRound=0;
let accountRound=0,accountChallenge,accountRevoked=new Set();const accountProxies=new Map();const accountChats=new Map();const accountProfiles=new Map();const accountRuntimes=new Map();
const accountFixture=http.createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;res.setHeader('content-type','application/json');
 const rawToken=req.headers.authorization?.replace('Bearer ','');const token=passwordTokens.get(rawToken)||rawToken;
 if(req.url==='/v1/auth/password'){const value=JSON.parse(body);let user=passwordUsers.get(value.username);if(value.password!==value.confirmPassword || (user && user.password!==value.password)){res.writeHead(400);res.end('{"error":"用户名或密码错误"}');return;}if(!user){user={id:String(passwordUsers.size+1),password:value.password};passwordUsers.set(value.username,user);}const issued='password-token-'+(++passwordRound);passwordTokens.set(issued,'fixture-account-'+user.id);res.end(JSON.stringify({token:issued}));}
 else if(req.url==='/v1/auth/google/start'){accountRound++;accountChallenge=JSON.parse(body).challenge;res.end(JSON.stringify({flowId:String(accountRound),authorizationUrl:`http://127.0.0.1:${accountFixture.address().port}/v1/auth/google/authorize?flow=${accountRound}`}));}
 else if(req.url==='/v1/auth/google/poll'){await new Promise(resolve=>setTimeout(resolve,700));res.end(JSON.stringify({status:'complete',token:'fixture-account-'+accountRound}));}
 else if(!token || accountRevoked.has(rawToken)){res.writeHead(401);res.end('{"error":"signed-out"}');}
 else if(req.url==='/v1/me'){const id=token.replace('fixture-account-','');res.end(JSON.stringify({id,name:'测试用户 '+id,email:`user${id}@example.test`,loginIp:'203.0.113.99',loginIpSource:'client_direct_probe',...accountProfiles.get(token)}));}
 else if(req.url==='/v1/me/profile'){accountProfiles.set(token,{...accountProfiles.get(token),...JSON.parse(body)});res.end('{}');}
 else if(req.url==='/v1/me/avatar'){res.writeHead(404);res.end('{}');}
 else if(req.url==='/v1/me/proxy'){if(req.method==='PUT'){accountProxies.set(token,JSON.parse(body));res.end('{"saved":true}');}else res.end(JSON.stringify({proxy:accountProxies.get(token) || null}));}
 else if(req.url.startsWith('/v1/me/local-environment') && req.method==='DELETE'){accountProxies.delete(token);accountRuntimes.delete(token+':'+new URL(req.url,'http://fixture.test').searchParams.get('host'));res.end('{"deleted":true}');}
 else if(req.url.startsWith('/v1/me/runtimes')){if(req.method==='PUT'){const registry=JSON.parse(body);accountRuntimes.set(token+':'+registry.hostName,registry);res.end('{"saved":true}');}else{const host=new URL(req.url,'http://fixture.test').searchParams.get('host');res.end(JSON.stringify({registry:accountRuntimes.get(token+':'+host)||null}));}}
 else if(req.url==='/v1/me/chats'){if(req.method==='PUT'){const next=JSON.parse(body),old=accountChats.get(token) || {revision:0};if(old.revision!==next.revision){res.writeHead(409);res.end('{"error":"conflict"}');}else{accountChats.set(token,{revision:old.revision+1,payload:next.payload});res.end(JSON.stringify({revision:old.revision+1}));}}else res.end(JSON.stringify(accountChats.get(token) || {revision:0,payload:null}));}
 else if(req.url==='/v1/auth/logout'){accountRevoked.add(rawToken);res.end('{"ok":true}');}
});
const sockets = new Set(); let child; let browserRequests = 0; let exitRequests = 0; let client; let popupPost = null; let fixtureExitIp = '203.0.113.23'; let acceptLanguages = [];
const stun = dgram.createSocket('udp4'); let stunPackets = 0; stun.on('message',()=>stunPackets++);
const temp = await mkdtemp(path.join(tmpdir(), 'fixed-egress-desktop-'));
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
async function until(fn, timeout = 15000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { try { const value = await fn(); if (value) return value; } catch {} await pause(100); } throw new Error('桌面验收等待超时'); }
async function connectCDP(url) {
  const ws = new WebSocket(url); let id = 0; const pending = new Map();
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { const p = pending.get(message.id); pending.delete(message.id); if (message.error) p?.reject(new Error(message.error.message)); else p?.resolve(message.result); } });
  return { close: () => ws.close(), call(method, params = {}) { const requestId = ++id; return new Promise((resolve, reject) => { pending.set(requestId, { resolve, reject }); ws.send(JSON.stringify({ id: requestId, method, params })); }); } };
}
function fixtureClient(url) { return { close() {}, call(method, params) { return evaluate('window.workspace.browserProbe('+JSON.stringify(url)+','+JSON.stringify(params)+','+JSON.stringify(method)+')'); } }; }
async function captureUI(){await pause(180);await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");return client.call('Page.captureScreenshot');}
async function evaluate(expression) { if(expression.startsWith('await '))expression='(async()=>{'+expression+'})()'; const value = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text); return value.result?.value; }
try {
 await start(accountFixture);await start(target);await start(proxy);await new Promise(resolve=>stun.bind(0,'127.0.0.1',resolve));
 const portFinder=net.createServer();await start(portFinder);const debugPort=portFinder.address().port;await new Promise(resolve=>portFinder.close(resolve));
 const bin=path.join(temp,'fixture-bin');await mkdir(bin);
 // Deterministic local CLI: discovery/auth/protocol only; never call a real AI provider.
 const mock=`#!/usr/bin/env node
if(process.argv.includes('--version')){console.log('codex fixture 1.0');process.exit(0);}
if(process.argv[2]==='login'){console.log('Logged in using ChatGPT');process.exit(0);}
if(process.argv[2]==='app-server'){require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id)console.log(JSON.stringify({id:m.id,result:m.method==='model/list'?{data:[]}:{}}));});}
else {process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'fixture response'}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));});}
`;
 await writeFile(path.join(bin,'codex'),mock,{mode:0o700});
 let stderr='';
 child=spawn(electron,['.',`--remote-debugging-port=${debugPort}`,'--test-fixture','--site-per-process','--unsafely-treat-insecure-origin-as-secure=http://fixture.invalid,http://frame.invalid',...(process.platform==='darwin'?['-AppleLanguages','(en-US)']:[])],{cwd:process.cwd(),env:{...process.env,WORKSPACE_TEST_AUTH_ONLY:'',PATH:bin+path.delimiter+process.env.PATH,WORKSPACE_ACCOUNT_SERVER_URL:`http://127.0.0.1:${accountFixture.address().port}`,WORKSPACE_TEST_PROBE_URL:'http://fixture.invalid/exit',WORKSPACE_TEST_HOME_URL:'http://fixture.invalid/home',WORKSPACE_TEST_ENV:JSON.stringify({timeZone:'America/New_York',languages:['en-US']}),WORKSPACE_TEST_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 child.stderr.on('data',chunk=>stderr+=chunk);
 const page=await until(async()=>(await fetch(`http://127.0.0.1:${debugPort}/json`).then(r=>r.json())).find(p=>p.url.includes('src/index.html')));
 client=await connectCDP(page.webSocketDebuggerUrl);
 await until(()=>evaluate("performance.getEntriesByName('chat-records-ready').length>0"));
 const context={evaluate,until,client,temp,proxyPort:proxy.address().port,fixtureClient,debugPort,realmProbe,stun,acceptLanguages,getStderr:()=>stderr,getStunPackets:()=>stunPackets,getPopupPost:()=>popupPost,getBrowserRequests:()=>browserRequests,getExitRequests:()=>exitRequests,setExitIP:value=>fixtureExitIp=value,accountProfiles,accountChats,captureUI};
 await verifyWorkspace(context,async()=>{await verifyBrowserSecurity(context);await verifyBrowserNavigation(context);});
 assert.doesNotMatch(stderr,/UnhandledPromiseRejection|uncaughtException/);
 console.log('PASS 完整桌面验收：组件与布局、运行时与会话、通知持久化、代理导入与固定出口、浏览器隔离/导航/弹窗/断网、账号隔离。仅本地夹具，未调用真实账号或模型。');
} finally {
 accountFixture.close();stun.close();client?.close();child?.kill('SIGTERM');
 if(child&&child.exitCode===null)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(3000)]);
 for(const socket of sockets)socket.destroy();
 target.closeAllConnections();await new Promise(resolve=>target.close(resolve));await new Promise(resolve=>accountFixture.close(resolve));await new Promise(resolve=>proxy.close(resolve));
 await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
