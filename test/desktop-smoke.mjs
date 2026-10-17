import {networkInterfaces} from 'node:os';
import {DockerEnvironments} from '../src/docker-environments.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile, access, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';

let externalUITestManager,externalUITestSource;const consoleFixtureEnvironments=[];
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
async function verifyContentTabMenu(blankChatTab){
  await evaluate("document.getElementById('languageSelect').value='zh-CN';document.querySelector('[data-tab-id=cc]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:430,clientY:35}))");
  assert.ok(await evaluate("document.getElementById('contentTabMenu').open && document.getElementById('contentTabMenuPin').textContent.includes('固定标签') && document.getElementById('contentTabMenuCloseOthers').textContent.includes('关闭其他标签')"),'标签右键显示中文菜单');
  await evaluate("document.getElementById('contentTabMenuCloseOthers').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true}))");
  assert.ok(await evaluate("document.getElementById('contentTabMenu').open"),'菜单内按下不会提前关闭');
  await evaluate("document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true,pointerType:'touch'}))");
  assert.ok(await evaluate("!document.getElementById('contentTabMenu').open"),'触控点击外部关闭菜单');
  await evaluate("document.querySelector('[data-tab-id=cc]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:430,clientY:35}))");
  await evaluate("document.body.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}))");
  assert.ok(await evaluate("!document.getElementById('contentTabMenu').open"),'鼠标点击外部关闭菜单');
  await evaluate("document.querySelector('[data-tab-id=cc]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:430,clientY:35}))");
  await evaluate("document.getElementById('contentTabMenuPin').click()");
  assert.ok(await evaluate("document.querySelector('[data-tab-id=cc]').classList.contains('pinned')"),'右键固定标签');
  await evaluate("document.getElementById('languageSelect').value='en-US';document.querySelector('[data-tab-id=cc]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:430,clientY:35}))");
  assert.ok(await evaluate("document.getElementById('contentTabMenuPin').textContent.includes('Unpin tab') && document.getElementById('contentTabMenuClose').textContent.includes('Close tab') && document.getElementById('contentTabMenuCloseOthers').textContent.includes('Close other tabs')"),'标签右键文案跟随界面语言');
  await until(()=>evaluate("(()=>{const rect=document.getElementById('contentTabMenu').shadowRoot.querySelector('[part=menu]').getBoundingClientRect();return Math.abs(rect.left-430)<12 && rect.top>=35 && rect.top<60})()"));
  assert.ok(await evaluate("(()=>{const menu=document.getElementById('contentTabMenu').shadowRoot.querySelector('[part=menu]').getBoundingClientRect(),item=document.getElementById('contentTabMenuCloseOthers').getBoundingClientRect();return menu.width<205 && item.left-menu.left>=5 && menu.right-item.right>=5;})()"),'菜单按最长文案收窄，悬停项两侧保留空隙');
  const tabMenuCapture=await captureUI();await writeFile('artifacts/content-tab-context-menu.png',Buffer.from(tabMenuCapture.data,'base64'));
  await evaluate("(async()=>{document.getElementById('contentTabMenu').open=false;while(document.querySelectorAll('.content-tab').length<10){const button=document.getElementById('newContentTab');await button.updateComplete;button.click();await new Promise(resolve=>requestAnimationFrame(resolve));}})()");
  await pause(250);
  assert.ok(await evaluate("(()=>{const strip=document.getElementById('contentTabs'),wrapper=document.querySelector('.content-tabs-viewport'),sidebar=document.querySelector('.sidebar');strip.scrollLeft=999999;return strip.scrollWidth>strip.clientWidth && Math.abs(wrapper.getBoundingClientRect().left-sidebar.getBoundingClientRect().right)<1 && strip.scrollLeft<=strip.scrollWidth-strip.clientWidth+1})()"),'标签溢出时滚动限制在一级导航右边缘之后');
  await evaluate("document.getElementById('contentTabs').scrollLeft=0");
  assert.ok(await evaluate("(()=>{const sidebar=document.querySelector('.sidebar').getBoundingClientRect(),el=document.elementFromPoint(sidebar.right-2,25);return !el?.closest('.content-tab')})()"),'横向滚动不会把标签画到一级导航上');
  await evaluate("document.querySelector('[data-tab-id=\"'+"+JSON.stringify(blankChatTab)+"+'\"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:600,clientY:35}));document.getElementById('contentTabMenuCloseOthers').click()");
  await until(()=>evaluate("document.querySelectorAll('.content-tab').length===2"));
  assert.ok(await evaluate("document.querySelector('[data-tab-id=cc]').classList.contains('pinned')"),'关闭其他标签保留固定标签');
  await evaluate("document.getElementById('languageSelect').value='zh-CN';document.querySelector('[data-tab-id=cc]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:430,clientY:35}));document.getElementById('contentTabMenuPin').click();document.querySelector('[data-tab-id=\"'+"+JSON.stringify(blankChatTab)+"+'\"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:600,clientY:35}));document.getElementById('contentTabMenuCloseOthers').click()");
  await until(()=>evaluate("document.querySelectorAll('.content-tab').length===1"));
  await evaluate("document.querySelector('.content-tab').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:430,clientY:35}))");
  assert.ok(await evaluate("document.getElementById('contentTabMenuClose').disabled && document.getElementById('contentTabMenuCloseOthers').disabled"),'右键不能关闭最后一个标签');
  await evaluate("document.getElementById('contentTabMenu').open=false");
}
try {
  await start(accountFixture);await start(target); await start(proxy); await new Promise(resolve=>stun.bind(0,'127.0.0.1',resolve));
  const portFinder = net.createServer(); await start(portFinder); const debugPort = portFinder.address().port; await new Promise(resolve => portFinder.close(resolve));
  const slowBin=path.join(temp,'slow-cli');await mkdir(slowBin);
  let originalCodex;for(const dir of (process.env.PATH || '').split(path.delimiter)){const file=path.join(dir,'codex');try{await access(file);originalCodex=file;break;}catch{}}
  if(originalCodex){const wrapper=path.join(slowBin,'codex');await writeFile(wrapper,'#!/usr/bin/env node\n'+`const fs=require('fs'),cp=require('child_process');const marker=${JSON.stringify(path.join(temp,'slow-info'))};if(process.argv[2]==='--version'&&!fs.existsSync(marker)){fs.writeFileSync(marker,'waiting');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,3500);fs.writeFileSync(marker+'-done','done');}const result=cp.spawnSync(${JSON.stringify(originalCodex)},process.argv.slice(2),{stdio:'inherit'});process.exit(result.status??1);`);await chmod(wrapper,0o755);}
  if(process.env.WORKSPACE_TEST_CHAT_NETWORK_ONLY){
   originalCodex=null;
   const mock=`#!/usr/bin/env node
const fs=require('fs');
if(process.argv.includes('--version')){console.log('codex chat-network-fixture');process.exit(0);}
if(process.argv[2]==='login'){console.log('Logged in using ChatGPT');process.exit(0);}
if(process.argv[2]==='app-server'){const rl=require('readline').createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);if(m.id)console.log(JSON.stringify({id:m.id,result:m.id===2?{data:[]}: {}}));});}
else {let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{fs.appendFileSync(${JSON.stringify(path.join(temp,'chat-launches'))},JSON.stringify({proxy:process.env.HTTP_PROXY || '',input})+'\\n');setTimeout(()=>{console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:process.env.HTTP_PROXY?'proxied fixture reply':'direct fixture reply'}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));},800);});}
`;
   await writeFile(path.join(slowBin,'codex'),mock,{mode:0o700});
  }
  let stderr = '';
  child = spawn(electron, ['.', `--remote-debugging-port=${debugPort}`, '--test-fixture', '--site-per-process', '--unsafely-treat-insecure-origin-as-secure=http://fixture.invalid,http://frame.invalid', ...(process.platform === 'darwin' ? ['-AppleLanguages', '(en-US)'] : [])], { cwd: process.cwd(), env: { ...process.env, PATH:slowBin+path.delimiter+process.env.PATH, WORKSPACE_ACCOUNT_SERVER_URL:`http://127.0.0.1:${accountFixture.address().port}`,WORKSPACE_TEST_PROBE_URL: 'http://fixture.invalid/exit', WORKSPACE_TEST_HOME_URL: 'http://fixture.invalid/home', WORKSPACE_TEST_ENV: JSON.stringify({timeZone:'America/New_York',languages:['en-US']}), WORKSPACE_TEST_DATA_DIR: temp }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', chunk => stderr += chunk);
  const pages = await until(async () => { const data = await fetch(`http://127.0.0.1:${debugPort}/json`).then(r => r.json()); return data.find(p => p.url.includes('src/index.html')); });
  client = await connectCDP(pages.webSocketDebuggerUrl);
  await until(()=>evaluate("performance.getEntriesByName('chat-records-ready').length>0"));
  const startup=await evaluate("({shell:performance.getEntriesByName('chat-shell-ready')[0].startTime,records:performance.getEntriesByName('chat-records-ready')[0].startTime})");
  assert.ok(startup.shell<1500 && startup.records<1500,'慢 CLI 检测不阻塞对话标签和记录恢复');
  if(originalCodex){await until(()=>readFile(path.join(temp,'slow-info')).then(()=>true,()=>false));await assert.rejects(readFile(path.join(temp,'slow-info-done')),'对话已可用时慢 CLI 仍未返回');}
  console.log('刷新后对话可见耗时：',JSON.stringify(startup));

  if(process.env.WORKSPACE_TEST_CHAT_NETWORK_ONLY){
   await mkdir('artifacts',{recursive:true});
   await evaluate("window.workspace.onEvent(e=>{if(e.type==='ccEnd')window.fixtureChatEnded=(window.fixtureChatEnded||0)+1;if(e.type==='ccError')window.fixtureChatError=e.data;if(e.type==='ccText')window.fixtureChatText=(window.fixtureChatText||'')+e.data;})");
   await evaluate('window.workspace.runtimeInfo({detect:true})');
   await evaluate("document.querySelector('[data-page=runtime]').click();document.getElementById('refreshRuntimes').click()");
   await until(()=>evaluate("!document.getElementById('refreshRuntimes').disabled"));
   await evaluate("document.querySelector('[data-page=cc]').click();document.getElementById('railNewSession').click()");
   await until(()=>evaluate("document.getElementById('newSessionDialog').open"));
   await evaluate("document.getElementById('runtimeEngine').value='codex';document.getElementById('runtimeEngine').dispatchEvent(new Event('change'));document.getElementById('chatNetworkMode').value='direct';document.getElementById('chatNetworkMode').dispatchEvent(new Event('change'))");
   await writeFile('artifacts/chat-network-create.png',Buffer.from((await captureUI()).data,'base64'));
   await evaluate("document.getElementById('createNewSession').click()");
   await until(()=>evaluate("!document.getElementById('newSessionDialog').open && document.querySelector('.chat-network-mode')?.getAttribute('aria-label')==='直连' && document.querySelector('.chat-network-mode wa-icon')?.src.endsWith('globe.svg')"));
   assert.equal(await evaluate("document.querySelector('.chat-item-detail').textContent.includes('Codex')"),false);
   assert.equal(await evaluate("document.getElementById('prompt').disabled"),false);
   const first=await evaluate('(async()=>{const s=await window.workspace.state();return s.activeAISessionId;})()');
   await evaluate("window.workspace.cc('direct fixture prompt')");await evaluate('window.workspace.disconnect()');
   await until(()=>evaluate("window.fixtureChatEnded===1 && window.fixtureChatText.includes('direct fixture reply')"));
   await evaluate("document.getElementById('railNewSession').click()");await until(()=>evaluate("document.getElementById('newSessionDialog').open"));
   await evaluate("document.getElementById('runtimeEngine').value='codex';document.getElementById('runtimeEngine').dispatchEvent(new Event('change'));document.getElementById('chatNetworkMode').value='proxy';document.getElementById('createNewSession').click()");
   await until(()=>evaluate("!document.getElementById('newSessionDialog').open && document.querySelectorAll('.chat-network-mode').length===2"));
   assert.equal(await evaluate("document.getElementById('prompt').disabled"),true);
   await assert.rejects(evaluate("window.workspace.cc('blocked fixture')"),/出口未通过验证/);
   await evaluate('window.workspace.connect('+JSON.stringify({protocol:'http',host:'127.0.0.1',port:proxy.address().port,username:'demo',password:'secret'})+',false)');
   await evaluate("window.workspace.cc('proxied fixture prompt')");
   await until(()=>evaluate("window.fixtureChatEnded===2 && window.fixtureChatText.includes('proxied fixture reply')"));
   await writeFile('artifacts/chat-network-list.png',Buffer.from((await captureUI()).data,'base64'));
   await evaluate("window.workspace.cc('proxy interruption fixture')");await evaluate('window.workspace.disconnect()');
   await until(()=>evaluate("window.fixtureChatEnded===3 && Boolean(window.fixtureChatError)"));
   await assert.rejects(evaluate("window.workspace.cc('blocked again')"),/出口未通过验证/);
   await evaluate("document.getElementById('sessionNetworkMode').value='auto';document.getElementById('sessionNetworkMode').dispatchEvent(new Event('change'))");
   await until(async()=>{const s=await evaluate('window.workspace.state()');return s.aiSessions.find(item=>item.id===s.activeAISessionId)?.networkMode==='auto';});
   await evaluate("window.fixtureChatText='';window.workspace.cc('automatic direct fixture')");
   await until(()=>evaluate("window.fixtureChatEnded===4 && window.fixtureChatText.includes('direct fixture reply')"));
   await evaluate('window.workspace.connect('+JSON.stringify({protocol:'http',host:'127.0.0.1',port:proxy.address().port,username:'demo',password:'secret'})+',false)');
   await evaluate("window.fixtureChatText='';window.workspace.cc('automatic proxy fixture')");
   await until(()=>evaluate("window.fixtureChatEnded===5 && window.fixtureChatText.includes('proxied fixture reply')"));
   await evaluate("window.workspace.cc('manual switch interruption fixture')");
   await evaluate("document.getElementById('sessionNetworkMode').value='direct';document.getElementById('sessionNetworkMode').dispatchEvent(new Event('change'))");
   await until(()=>evaluate("window.fixtureChatEnded===6 && !document.getElementById('sessionNetworkMode').disabled && document.getElementById('sessionNetworkMode').value==='direct'"));
   await evaluate("window.fixtureChatText='';window.workspace.cc('manual direct fixture')");
   await until(()=>evaluate("window.fixtureChatEnded===7 && window.fixtureChatText.includes('direct fixture reply')"));
   await writeFile('artifacts/chat-network-switch.png',Buffer.from((await captureUI()).data,'base64'));
   await evaluate("await window.workspace.sessionNetwork((await window.workspace.state()).activeAISessionId,'proxy')");
   const persisted=JSON.parse(await readFile(path.join(temp,'ai-sessions.json'),'utf8'));assert.equal(persisted.sessions.find(item=>item.id===first).networkMode,'direct');assert.ok(persisted.sessions.some(item=>item.networkMode==='proxy'));
   await evaluate("document.querySelector('[data-page=overview]').click();document.querySelector('[data-setting=browser]').click()");
   if(!process.env.WORKSPACE_TEST_CHAT_BADGE_ONLY){
   const browserGeometry=await evaluate("(()=>{const p=document.querySelector('[data-panel=browser]');return {margin:getComputedStyle(p.firstElementChild).marginTop,description:getComputedStyle(p.querySelector('.preference-description')).marginTop};})()");
   assert.deepEqual(browserGeometry,{margin:'0px',description:'12px'});
   await writeFile('artifacts/browser-settings-spacing.png',Buffer.from((await captureUI()).data,'base64'));
   }
   console.log('对话连接模式验收通过：创建选择、列表标记、品牌移除、直连请求、断开代理不取消直连、代理门禁、代理请求、模式持久化及设置间距。');
  }else if(process.env.WORKSPACE_TEST_BROWSER_MODE_ONLY){
   const directTarget=http.createServer((_req,res)=>res.end('<title>Direct browser verified</title><h1>Direct access</h1>'));
   await new Promise(resolve=>directTarget.listen(0,'0.0.0.0',resolve));
   try{
    const localIP=Object.values(networkInterfaces()).flat().find(item=>item.family==='IPv4' && !item.internal)?.address;
    assert.ok(localIP,'direct browser fixture requires a local network interface');
    const url=`http://${localIP}:${directTarget.address().port}/direct`;
    assert.equal((await evaluate('window.workspace.state()')).browser.mode,'proxy');
    await evaluate("document.querySelector('[data-page=overview]').click();document.querySelector('[data-setting=browser]').click()");
    await evaluate("document.getElementById('browserModeSelect').value='direct';document.getElementById('browserModeSelect').dispatchEvent(new Event('change',{bubbles:true}))");
    await until(()=>evaluate("document.getElementById('browserModeStatus').textContent.includes('已保存')"));
    assert.equal((await evaluate('window.workspace.state()')).browser.mode,'direct');
    assert.equal(JSON.parse(await readFile(path.join(temp,'browser-preferences.json'),'utf8')).mode,'direct');
    await mkdir('artifacts',{recursive:true});
    await writeFile('artifacts/browser-mode-settings.png',Buffer.from((await captureUI()).data,'base64'));
    await evaluate("document.querySelector('[data-page=browser]').click()");
    await evaluate('window.workspace.browser("navigate",'+JSON.stringify(url)+')');
    await until(async()=>{const state=await evaluate('window.workspace.state()');return state.browser.tabs.some(tab=>tab.title==='Direct browser verified' && !tab.loading);});
    assert.equal(browserRequests,0,'direct mode must not touch the upstream proxy fixture');
    await evaluate('window.workspace.disconnect()');
    await evaluate('window.workspace.browser("reload")');
    await until(async()=>{const state=await evaluate('window.workspace.state()');return state.browser.tabs.some(tab=>tab.title==='Direct browser verified' && !tab.loading);});
    const directPage=await until(async()=>{const list=await fetch(`http://127.0.0.1:${debugPort}/json`).then(r=>r.json());return list.find(p=>p.url===url);});
    const directClient=await connectCDP(directPage.webSocketDebuggerUrl);
    try{
     await until(async()=>{const value=await directClient.call('Runtime.evaluate',{expression:'document.visibilityState',returnByValue:true});return value.result.value==='visible';});
     await writeFile('artifacts/browser-mode-direct.png',Buffer.from((await directClient.call('Page.captureScreenshot')).data,'base64'));
    }finally{directClient.close();}
    await assert.rejects(evaluate("window.workspace.browserSettings('automatic')"),/未知浏览器连接方式/);
    await evaluate('window.workspace.connect('+JSON.stringify({protocol:'http',host:'127.0.0.1',port:proxy.address().port,username:'demo',password:'secret'})+',false)');
    const proxiedCount=browserRequests;
    await evaluate('window.workspace.browser("navigate",'+JSON.stringify(url+'?proxy-connected')+')');
    await until(async()=>{const state=await evaluate('window.workspace.state()');return state.browser.tabs.some(tab=>tab.url.endsWith('?proxy-connected') && tab.title==='Direct browser verified' && !tab.loading);});
    assert.equal(browserRequests,proxiedCount,'connecting the application proxy must not reroute direct browser traffic');
    await evaluate('window.workspace.disconnect()');
    // Restart the fixture process with the same data directory to verify loading.
    client.close();child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));
    child=spawn(electron,['.',`--remote-debugging-port=${debugPort}`,'--test-fixture',...(process.platform==='darwin'?['-AppleLanguages','(en-US)']:[])],{cwd:process.cwd(),env:{...process.env,WORKSPACE_TEST_PROBE_URL:'http://fixture.invalid/exit',WORKSPACE_TEST_HOME_URL:'http://fixture.invalid/home',WORKSPACE_ACCOUNT_SERVER_URL:`http://127.0.0.1:${accountFixture.address().port}`,WORKSPACE_TEST_ENV:JSON.stringify({timeZone:'America/New_York',languages:['en-US']}),WORKSPACE_TEST_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
    child.stderr.on('data',chunk=>stderr+=chunk);
    const restored=await until(async()=>{const pages=await fetch(`http://127.0.0.1:${debugPort}/json`).then(r=>r.json());return pages.find(p=>p.url.includes('src/index.html'));});
    client=await connectCDP(restored.webSocketDebuggerUrl);
    await until(()=>evaluate("performance.getEntriesByName('chat-records-ready').length>0"));
    assert.equal((await evaluate('window.workspace.state()')).browser.mode,'direct','restart restores direct setting');
    await evaluate('window.workspace.browser("navigate",'+JSON.stringify(url)+')');
    await until(async()=>{const state=await evaluate('window.workspace.state()');return state.browser.tabs.some(tab=>tab.title==='Direct browser verified' && !tab.loading);});
    await evaluate("window.workspace.browserSettings('proxy')");
    await assert.rejects(evaluate('window.workspace.browser("navigate",'+JSON.stringify(url)+')'),/出口未通过验证/);
    assert.equal(JSON.parse(await readFile(path.join(temp,'browser-preferences.json'),'utf8')).mode,'proxy');
    await evaluate('window.workspace.connect('+JSON.stringify({protocol:'http',host:'127.0.0.1',port:proxy.address().port,username:'demo',password:'secret'})+',false)');
    await evaluate('window.workspace.browser("navigate","http://fixture.invalid/page")');
    await until(async()=>{const state=await evaluate('window.workspace.state()');return state.browser.tabs.some(tab=>tab.url==='http://fixture.invalid/page' && !tab.loading && !tab.error);});
    assert.ok(browserRequests>proxiedCount,'proxy browser still uses the configured upstream');
    assert.equal((await evaluate("window.workspace.dnsProbe('example.com')")).blocked,true,'direct mode must not loosen Chromium DNS restrictions');
    await evaluate('window.workspace.disconnect()');
    await assert.rejects(evaluate('window.workspace.browser("navigate",'+JSON.stringify(url)+')'),/出口未通过验证/);
    console.log('浏览器连接模式验收通过：设置保存、无上游代理直连、本机出口、断开代理后仍可访问、重启后设置及访问恢复、切回代理后阻断。');
   }finally{directTarget.closeAllConnections();await new Promise(resolve=>directTarget.close(resolve));}
  }else if(process.env.WORKSPACE_TEST_WIZARD_ONLY){
   await mkdir('artifacts',{recursive:true});
   await until(()=>evaluate("document.body.classList.contains('auth-mode')"));
   await evaluate("(async()=>{document.getElementById('credentialPasswordChoice').click();document.getElementById('loginUsername').value='wizard';document.getElementById('loginPassword').value='fixture-password';document.getElementById('loginPasswordConfirm').value='fixture-password';await Promise.all([document.getElementById('loginUsername').updateComplete,document.getElementById('loginPassword').updateComplete,document.getElementById('loginPasswordConfirm').updateComplete]);document.getElementById('credentialForm').requestSubmit()})()");
   await until(()=>evaluate("document.body.classList.contains('environment-onboarding') && document.getElementById('accountName').textContent==='测试用户 1'"));
   assert.ok(await evaluate("!document.getElementById('setupNameStep').classList.contains('hidden') && document.getElementById('setupTypeStep').classList.contains('hidden') && document.getElementById('setupCreate').textContent.includes('下一步') && document.getElementById('setupCreate').disabled"),'第一步仅填名称，空名称禁用下一步');
   assert.ok(await evaluate("document.querySelectorAll('#setupIconGrid app-button').length>=50 && !!document.querySelector('#setupIconGrid [aria-pressed=true]')"),'新建默认随机图标并提供丰富图标库');
   await evaluate("document.querySelector('#setupIconGrid [data-icon=rocket]').click()");
   await evaluate("(async()=>{document.getElementById('setupEnvironmentName').value='三步测试';document.getElementById('setupEnvironmentName').dispatchEvent(new Event('input',{bubbles:true}));await document.getElementById('setupCreate').updateComplete;document.getElementById('setupCreate').click()})()");
   await until(()=>evaluate("!document.getElementById('setupTypeStep').classList.contains('hidden')"));
   assert.ok(await evaluate("window.workspace.dockerEnvironments('state').then(s=>!s.localEnabled && s.environments.length===0)"),'名称下一步不会创建环境');
   await evaluate("document.getElementById('setupPrevious').click()");
   assert.ok(await evaluate("document.getElementById('setupEnvironmentName').value==='三步测试' && !document.getElementById('setupNameStep').classList.contains('hidden')"),'返回保留名称');
   const nameCapture=await captureUI();await writeFile('artifacts/setup-step-name.png',Buffer.from(nameCapture.data,'base64'));
   await evaluate("(async()=>{await document.getElementById('setupCreate').updateComplete;document.getElementById('setupCreate').click()})()");
   const typeCapture=await captureUI();await writeFile('artifacts/setup-step-type.png',Buffer.from(typeCapture.data,'base64'));
   await evaluate("(async()=>{await document.getElementById('setupCreate').updateComplete;document.getElementById('setupCreate').click()})()");
   await until(()=>evaluate("!document.getElementById('setupDetectView').classList.contains('hidden')"));
   assert.ok(await evaluate("!document.getElementById('environmentCreatedDialog').open && window.workspace.dockerEnvironments('state').then(s=>!s.localEnabled && s.environments.length===0)"),'第三步预览不会提前创建环境');
   await evaluate("document.getElementById('setupPrevious').click()");
   assert.ok(await evaluate("!document.getElementById('setupTypeStep').classList.contains('hidden') && document.getElementById('setupEnvironmentName').value==='三步测试'"),'第三步返回保留配置');
   await evaluate("(async()=>{await document.getElementById('setupCreate').updateComplete;document.getElementById('setupCreate').click()})()");
   await until(()=>evaluate("!document.getElementById('setupFinish').disabled"),30000);
   const detectCapture=await captureUI();await writeFile('artifacts/setup-step-detect.png',Buffer.from(detectCapture.data,'base64'));
   await until(()=>evaluate("!document.getElementById('setupFinish').disabled"),30000);
   await evaluate("document.getElementById('setupFinish').click()");
   await until(()=>evaluate("!document.body.classList.contains('environment-onboarding') && document.getElementById('environmentCreatedDialog').open"));
   assert.ok(await evaluate("window.workspace.dockerEnvironments('state').then(s=>s.localEnabled && s.localName==='三步测试' && s.localIcon==='rocket')"),'最终按钮创建环境并保存名称和图标');
   const successCapture=await captureUI();await writeFile('artifacts/environment-created.png',Buffer.from(successCapture.data,'base64'));
   assert.ok(await evaluate("document.querySelectorAll('#environmentCreatedDialog [slot=footer]').length===1 && document.querySelector('#environmentTrigger wa-icon').src.endsWith('/rocket.svg')"),'仅保留知道了且当前环境显示所选图标');
   await evaluate("document.getElementById('environmentCreatedConfigure').click()");
   assert.ok(await evaluate("!document.getElementById('page-runtime').classList.contains('hidden')"),'运行时卡片跳转');
   await evaluate("document.getElementById('environmentCreatedDialog').open=true;document.getElementById('environmentCreatedProxy').click()");
   assert.ok(await evaluate("!document.getElementById('page-overview').classList.contains('hidden') && document.querySelector('[data-setting=proxy]').classList.contains('active')"),'代理卡片跳转');
   await evaluate("document.getElementById('newEnvironment').click()");
   await until(()=>evaluate("document.body.classList.contains('environment-onboarding') && !document.getElementById('setupNameStep').classList.contains('hidden')"));
   await evaluate("(async()=>{document.getElementById('setupEnvironmentName').value='Docker 测试';document.getElementById('setupEnvironmentName').dispatchEvent(new Event('input',{bubbles:true}));await document.getElementById('setupCreate').updateComplete;document.getElementById('setupCreate').click()})()");
   assert.ok(await evaluate("document.querySelector('[data-setup-type=local]').disabled && !document.querySelector('[data-setup-type=local]').classList.contains('hidden') && !document.getElementById('setupLocalExists').classList.contains('hidden') && document.getElementById('setupPrevious').closest('.setup-title-row')!==null"),'已有本机显示禁用标签且上一步在标题旁');
   assert.ok(await evaluate("!document.getElementById('setupTypeStep').classList.contains('hidden') && document.getElementById('setupTypeName').textContent==='Docker 容器' && document.getElementById('setupCreate').disabled"),'Docker第二步需要配置镜像后才可继续');
   await evaluate("document.getElementById('setupPrevious').click()");
   assert.ok(await evaluate("document.getElementById('setupEnvironmentName').value==='Docker 测试' && !document.getElementById('setupCreate').disabled"),'第一步不受镜像未配置约束');
   console.log('三步引导验收通过：名称独立、下一步无创建副作用、返回保留、类型配置门槛、创建前自动检测、第三步返回和最终创建弹窗。');
  }else if(process.env.WORKSPACE_TEST_LAYOUT_ONLY){
   await mkdir('artifacts',{recursive:true});
   await evaluate("document.getElementById('accountLogin').click()");await until(()=>evaluate("document.getElementById('accountName').textContent==='测试用户 1'"));
   await evaluate("document.querySelector('nav [data-page=runtime]').click()");
   await until(()=>evaluate("(()=>{if(document.getElementById('page-runtime').classList.contains('hidden')){document.querySelector('nav [data-page=runtime]').click();return false;}return !document.getElementById('runtimeEmptyState').classList.contains('hidden') && document.getElementById('configuredRuntimeStatus').textContent.length>0;})()"));
   for(const width of [1400,1050]){
    await client.call('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:false});await pause(120);
    const center=await evaluate("(()=>{const body=document.querySelector('.runtime-management').getBoundingClientRect(),parts=[...document.querySelector('#runtimeEmptyState').children].map(el=>el.getBoundingClientRect());return{width:body.width,height:body.height,dx:(Math.min(...parts.map(r=>r.left))+Math.max(...parts.map(r=>r.right))-body.left-body.right)/2,dy:(Math.min(...parts.map(r=>r.top))+Math.max(...parts.map(r=>r.bottom))-body.top-body.bottom)/2};})()");
    assert.ok(center.width>500 && center.height>500 && Math.abs(center.dx)<2 && Math.abs(center.dy)<2,'空状态在可用内容区居中 '+width+': '+JSON.stringify(center));
   }
   await client.call('Emulation.clearDeviceMetricsOverride');
   assert.ok(await evaluate("!document.querySelector('#runtimeEmptyState app-button') && !!document.getElementById('openRuntimeInstall')"),'移除空状态重复按钮，保留标题操作');
   const empty=await captureUI();await writeFile('artifacts/runtime-centered-empty.png',Buffer.from(empty.data,'base64'));
   await evaluate("document.querySelector('nav [data-page=environments]').click()");
   assert.ok(await evaluate("(()=>{const create=document.getElementById('newEnvironment').getBoundingClientRect(),remove=document.getElementById('deleteEnvironmentMenuTrigger');return create.right<=remove.getBoundingClientRect().left && getComputedStyle(remove.shadowRoot.querySelector('[part~=base]')).color==='rgb(220, 38, 38)' && getComputedStyle(remove.querySelector('wa-icon')).color==='rgb(220, 38, 38)';})()"),'删除按钮最右侧并使用红色图标和文案');
   await until(()=>evaluate("!!document.querySelector('.environment-identity')"));
   assert.ok(await evaluate("!document.getElementById('environmentCount') && (()=>{const head=document.querySelector('.environment-card-header').getBoundingClientRect(),facts=document.querySelector('.environment-inline-facts').getBoundingClientRect(),runtime=document.querySelector('.environment-inline-runtimes').getBoundingClientRect();return head.width>500 && facts.width>500 && runtime.top>facts.bottom && Math.abs(runtime.left-facts.left)<1;})()"),'环境主标题不显示数量，概览与运行时按上下分区布局');
   const env=await captureUI();await writeFile('artifacts/environment-header-actions.png',Buffer.from(env.data,'base64'));
   assert.ok(await evaluate("[...document.querySelectorAll('.content-page-header')].every(header=>!!header.querySelector('wa-icon:not(app-button wa-icon)'))"),'所有主内容标题具有图标');
   await evaluate("document.getElementById('accountSettings').click()");
   for(const [setting,icon] of Object.entries({profile:'user',preferences:'sliders-horizontal',proxy:'shield-check',activity:'activity',environment:'monitor'})){
    await evaluate("document.querySelector('[data-setting="+setting+"]').click()");
    assert.ok(await evaluate("document.getElementById('settingsTitleIcon').src.endsWith('/"+icon+".svg')"),'设置子页图标更新 '+setting);
   }
   await evaluate("document.querySelector('.content-tab').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:430,clientY:35}))");
   await until(()=>evaluate("document.getElementById('contentTabMenu').open"));
   const menuDocument=await client.call('DOM.getDocument'),menuNode=await client.call('DOM.querySelector',{nodeId:menuDocument.root.nodeId,selector:'#contentTabMenuClose'});
   await client.call('CSS.enable');await client.call('CSS.forcePseudoState',{nodeId:menuNode.nodeId,forcedPseudoClasses:['hover']});
   await until(()=>evaluate("getComputedStyle(document.getElementById('contentTabMenuClose')).backgroundColor==='rgb(254, 242, 242)'"));
   const hover=await captureUI();await writeFile('artifacts/content-tab-danger-hover.png',Buffer.from(hover.data,'base64'));
   await evaluate("document.getElementById('contentTabMenu').open=false");
   console.log('主内容布局验收通过：两种窗口宽度的空状态居中、重复按钮移除、删除操作顺序和颜色、主标题图标及设置动态标题。');
  }else{
  assert.ok(await evaluate(`!document.getElementById('toast').textContent.includes("Cannot access 'accountState'")`),'启动时没有账号状态初始化错误通知');
  const shellOrigin=await evaluate('performance.timeOrigin');
  for(const [key,code,modifiers,keyCode] of [['F5','F5',0,116],['r','KeyR',4,82],['r','KeyR',2,82],['r','KeyR',12,82],['e','KeyE',4,69]]){
   await Promise.race([client.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,windowsVirtualKeyCode:keyCode}),pause(150)]);await Promise.race([client.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers,windowsVirtualKeyCode:keyCode}),pause(150)]);
  }
  await pause(250);assert.equal(await evaluate('performance.timeOrigin'),shellOrigin,'应用外壳不会被刷新快捷键重载');
  if(process.env.WORKSPACE_TEST_AUTH_ONLY){
   await mkdir('artifacts',{recursive:true});
   await until(()=>evaluate("document.body.classList.contains('auth-mode')"));
   assert.ok(await evaluate("innerWidth<=900 && innerHeight<=760"),'未登录窗口缩小');
   assert.ok(await evaluate("getComputedStyle(document.getElementById('credentialForm')).display==='none' && !document.getElementById('credentialChoices').classList.contains('hidden')"),'默认仅显示登录方式选择');
   assert.ok(await evaluate("document.querySelector('#credentialGoogle img').complete && document.querySelector('#credentialGoogle img').naturalWidth>0"),'Google logo加载完成');
   const choiceCapture=await captureUI();await writeFile('artifacts/account-login-choices.png',Buffer.from(choiceCapture.data,'base64'));
   await evaluate("document.getElementById('credentialGoogle').click()");
   await until(()=>evaluate("!document.getElementById('credentialGoogleWaiting').classList.contains('hidden') && document.getElementById('credentialGoogle').loading && document.getElementById('credentialForm').classList.contains('hidden')"));
   const waitingCapture=await captureUI();await writeFile('artifacts/account-google-waiting.png',Buffer.from(waitingCapture.data,'base64'));
   await evaluate("document.getElementById('credentialCancel').click()");
   await until(()=>evaluate("!document.getElementById('credentialChoices').classList.contains('hidden') && !document.getElementById('credentialGoogle').loading"));
   await evaluate("document.getElementById('credentialPasswordChoice').click()");
   await evaluate("document.getElementById('loginUsername').value='shennong';document.getElementById('loginPassword').value='fixture-password';document.getElementById('loginPasswordConfirm').value='different';document.getElementById('loginPasswordConfirm').dispatchEvent(new Event('input',{bubbles:true}))");
   assert.equal(await evaluate("document.getElementById('credentialSubmit').disabled && document.getElementById('credentialConfirmHint').textContent.includes('不一致')"),true,'两次密码不一致时禁用提交并显示说明');
   await evaluate("document.getElementById('loginUsername').value='';document.getElementById('loginPassword').value='';document.getElementById('loginPasswordConfirm').value='';document.getElementById('loginPasswordConfirm').dispatchEvent(new Event('input',{bubbles:true}))");
   const authCapture=await captureUI();await writeFile('artifacts/account-login-screen.png',Buffer.from(authCapture.data,'base64'));
   const passwordLogin=async(name,password='fixture-password')=>{await evaluate(`(async()=>{document.getElementById('credentialPasswordChoice').click();document.getElementById('loginUsername').value=${JSON.stringify(name)};document.getElementById('loginPassword').value=${JSON.stringify(password)};document.getElementById('loginPasswordConfirm').value=${JSON.stringify(password)};document.getElementById('loginPassword').dispatchEvent(new Event('input',{bubbles:true}));await Promise.all([document.getElementById('loginUsername').updateComplete,document.getElementById('loginPassword').updateComplete,document.getElementById('loginPasswordConfirm').updateComplete]);document.getElementById('credentialForm').requestSubmit()})()`);};
   await passwordLogin('shennong');await until(()=>evaluate("document.getElementById('accountName').textContent==='测试用户 1'")).catch(async error=>{console.log('Auth diagnostic',await evaluate("({message:document.getElementById('credentialError').textContent,status:document.getElementById('accountName').textContent,valid:document.getElementById('credentialForm').checkValidity()})"));throw error;});
   await until(()=>evaluate("document.body.classList.contains('environment-onboarding')"));
   assert.ok(await evaluate("innerWidth>=1050 && !document.body.classList.contains('auth-mode')"),'登录后恢复工作窗口并进入环境引导');
   assert.equal(await evaluate("window.workspace.dockerEnvironments('state').then(s=>s.environments.length===0 && !s.localEnabled)"),true,'新账号没有其它用户环境');
   await until(()=>evaluate("document.getElementById('setupRuntimePreviewList').children.length===2"),20000);
   const previewCapture=await captureUI();await writeFile('artifacts/environment-runtime-preview.png',Buffer.from(previewCapture.data,'base64'));
   await evaluate("(async()=>{document.getElementById('setupEnvironmentName').value='神农环境';document.getElementById('setupEnvironmentName').dispatchEvent(new Event('input',{bubbles:true}));await document.getElementById('setupCreate').updateComplete;document.getElementById('setupCreate').click()})()");
   await until(()=>evaluate("!document.getElementById('setupDetectView').classList.contains('hidden')")).catch(async error=>{console.log('Create diagnostic',await evaluate("({message:document.getElementById('setupStatus').textContent,disabled:document.getElementById('setupCreate').disabled,name:document.getElementById('setupEnvironmentName').value,toast:document.getElementById('toast').textContent})"));throw error;});
   await evaluate("document.getElementById('setupDetect').click()");await until(()=>evaluate("!document.getElementById('setupFinish').disabled"));
   await evaluate("document.getElementById('setupFinish').click()");
   await evaluate("window.workspace.dockerEnvironments('create',{name:'持久容器配置'})");
   await evaluate("window.workspace.disconnect()");
   const ownerRecords=await evaluate("window.workspace.connectionRecords()");assert.ok(ownerRecords.length>0,'连接记录保存到当前账号');

   await evaluate("document.getElementById('accountLogout').click()");await until(()=>evaluate("document.body.classList.contains('auth-mode') && innerWidth<=900"));
   assert.equal(await evaluate("document.getElementById('loginPassword').value==='' && document.getElementById('loginPasswordConfirm').value===''"),true,'退出不保留两次密码');
   await passwordLogin('shennong','wrong-password');await until(()=>evaluate("document.getElementById('credentialError').textContent.includes('密码')"));
   assert.equal(await evaluate("document.body.classList.contains('auth-mode')"),true);
   await passwordLogin('shennong');await until(()=>evaluate("!document.body.classList.contains('auth-mode')"));
   assert.ok(await evaluate("window.workspace.dockerEnvironments('state').then(s=>s.localName==='神农环境' && s.environments.some(e=>e.name==='持久容器配置'))"),'重新登录恢复当前用户环境配置');
   assert.ok(await evaluate("window.workspace.runtimeInfo().then(s=>s.runtimes.length>0)"),'已保存运行时恢复到同一用户');
   assert.deepEqual(await evaluate("window.workspace.connectionRecords()"),ownerRecords,'重新登录恢复同一账号的连接记录');

   await evaluate("(async()=>{const state=await window.workspace.dockerEnvironments('state');const item=state.environments.find(e=>e.name==='持久容器配置');await window.workspace.dockerEnvironments('delete',{id:item.id,name:item.name})})()");
   await evaluate("document.getElementById('accountLogout').click()");await until(()=>evaluate("document.body.classList.contains('auth-mode')"));
   await passwordLogin('nuwa');await until(()=>evaluate("document.body.classList.contains('environment-onboarding') && !document.body.classList.contains('auth-mode')"));
   assert.equal(await evaluate("window.workspace.dockerEnvironments('state').then(s=>!s.localEnabled && s.environments.length===0)"),true,'第二账号环境隔离');
   assert.deepEqual(await evaluate("window.workspace.connectionRecords()"),[],'第二账号不会看到第一账号的连接记录');

   await evaluate("document.getElementById('setupAccountLogout').click()");await until(()=>evaluate("document.body.classList.contains('auth-mode') && innerWidth<=900"));
   assert.equal(await evaluate("window.workspace.accountState().then(s=>s.user===null)"),true,'引导页退出同样清除登录并进入登录页');
   await evaluate("document.getElementById('credentialGoogle').click()");
   await until(()=>evaluate("!document.body.classList.contains('auth-mode') && document.getElementById('accountName').textContent==='测试用户 2'"));
   await evaluate("document.getElementById('setupAccountLogout').click()");
   await until(()=>evaluate("document.body.classList.contains('auth-mode') && !document.getElementById('credentialChoices').classList.contains('hidden')"));
   console.log('账号界面验收通过：自动注册、密码校验、两个退出入口、窗口缩放、运行时预览、用户环境隔离及重新登录恢复。');
  }else{
  if(process.env.WORKSPACE_TEST_SETUP_ONLY){
   await mkdir('artifacts',{recursive:true});await evaluate("document.getElementById('accountLogin').click()");await until(()=>evaluate("document.getElementById('accountName').textContent==='测试用户 1'"));
   {await evaluate("document.getElementById('newContentTab').click()");const blank=await evaluate("document.querySelector('.content-tab.active').dataset.tabId");await verifyContentTabMenu(blank);}
   await evaluate("document.getElementById('accountTrigger').click()");await until(()=>evaluate("document.getElementById('accountMenu').open"));await pause(250);
   const expandedMenu=await evaluate("(()=>{const sidebar=document.querySelector('.sidebar').getBoundingClientRect(),menu=document.getElementById('accountMenu').shadowRoot.querySelector('[part=menu]').getBoundingClientRect();return{width:menu.width,sidebar:sidebar.width,left:menu.left-sidebar.left,right:document.querySelector('.content-layout').getBoundingClientRect().left-menu.right}})()");
   assert.ok(expandedMenu.width<expandedMenu.sidebar && Math.abs(expandedMenu.left-expandedMenu.right)<1,'展开时头像浮层不超过一级导航且左右对称: '+JSON.stringify(expandedMenu));
   const actionAlignment=await evaluate("(()=>{const nodes=[document.querySelector('#toggleSidebar wa-icon'),document.querySelector('#environmentTrigger wa-icon:last-child'),document.getElementById('proxyQuickToggle')];return nodes.map(node=>{const r=node.getBoundingClientRect();return r.left+r.width/2})})()");
   assert.ok(Math.max(...actionAlignment)-Math.min(...actionAlignment)<1,'顶部收起按钮与环境箭头及代理按钮纵向对齐: '+actionAlignment);
   const expandedCapture=await captureUI();await writeFile('artifacts/account-menu-expanded.png',Buffer.from(expandedCapture.data,'base64'));
   await evaluate("document.getElementById('accountMenu').open=false");await pause(250);
   const collapseMotion=await evaluate(`new Promise(resolve=>{const nodes=[document.querySelector('#environmentTrigger wa-icon'),document.querySelector('.sidebar nav>.nav wa-icon'),document.getElementById('accountAvatar'),document.getElementById('proxyStatusIcon'),document.querySelector('.content-tab')],samples=[];const sample=()=>samples.push(nodes.map(node=>{const r=node.getBoundingClientRect();return r.x+r.width/2}));sample();document.getElementById('toggleSidebar').click();const start=performance.now();function frame(){sample();if(performance.now()-start<380)requestAnimationFrame(frame);else resolve(samples)}requestAnimationFrame(frame)})`);
   const tabPositions=collapseMotion.map(row=>row[4]),tabDistance=Math.abs(tabPositions.at(-1)-tabPositions[0]);
   assert.ok(tabDistance>1 && tabPositions.some(x=>x<tabPositions[0]-1 && x>tabPositions.at(-1)+1),'收起时标签存在连续过渡的中间位置');
   assert.ok(tabPositions.every((x,i)=>i===0||Math.abs(x-tabPositions[i-1])<tabDistance*.45),'收起时标签无单帧位置跳跃');
   for(let icon=0;icon<4;icon++){const positions=collapseMotion.map(row=>row[icon]);assert.ok(positions.every((x,i)=>i===0||x<=positions[i-1]+1),'收起图标连续向左移动，无先跳到侧栏中央: '+positions.join(','));}
   await until(()=>evaluate("document.querySelector('.sidebar').getBoundingClientRect().width===45"));
   assert.equal(await evaluate("getComputedStyle(document.querySelector('.app-toolbar')).left"),'136px','收起后顶部三个按钮保持展开时的位置');
   const collapsedCenters=await evaluate("(()=>{const side=document.querySelector('.sidebar').getBoundingClientRect(),nodes=[document.querySelector('#environmentTrigger wa-icon'),document.querySelector('.sidebar nav>.nav wa-icon'),document.getElementById('accountAvatar'),document.getElementById('proxyStatusIcon')];return nodes.map(node=>{const r=node.getBoundingClientRect();return r.x+r.width/2-(side.x+side.width/2)})})()");
   assert.ok(await evaluate("Math.abs(document.querySelector('.content-layout').getBoundingClientRect().left-document.querySelector('.sidebar').getBoundingClientRect().right)<1"),'收起后内容边缘没有额外留白，图标左右视觉距离一致');
   assert.ok(collapsedCenters.every(offset=>Math.abs(offset)<1),'环境、导航、头像图标与45px栏中心对齐: '+collapsedCenters);
   await evaluate("document.getElementById('accountTrigger').click()");await until(()=>evaluate("document.getElementById('accountMenu').open"));await pause(250);
   const collapsedMenu=await evaluate("(()=>{const rail=document.querySelector('.conversation-rail').getBoundingClientRect(),menu=document.getElementById('accountMenu').shadowRoot.querySelector('[part=menu]').getBoundingClientRect();return{left:menu.left-rail.left,right:rail.right-menu.right}})()");
   assert.ok(collapsedMenu.left>=0 && collapsedMenu.right>=0,'收起时头像菜单显示在二级导航内: '+JSON.stringify(collapsedMenu));
   const collapsedCapture=await captureUI();await writeFile('artifacts/account-menu-collapsed.png',Buffer.from(collapsedCapture.data,'base64'));
   await evaluate("document.getElementById('accountMenu').open=false");await pause(250);const expandedTabMotion=await evaluate(`new Promise(resolve=>{const node=document.querySelector('.content-tab'),positions=[],sample=()=>{const r=node.getBoundingClientRect();positions.push(r.left+r.width/2)};sample();document.getElementById('toggleSidebar').click();const start=performance.now();function frame(){sample();if(performance.now()-start<380)requestAnimationFrame(frame);else resolve(positions)}requestAnimationFrame(frame)})`);
   const expandDistance=Math.abs(expandedTabMotion.at(-1)-expandedTabMotion[0]);
   assert.ok(expandedTabMotion.some(x=>x>expandedTabMotion[0]+1 && x<expandedTabMotion.at(-1)-1) && expandedTabMotion.every((x,i)=>i===0||Math.abs(x-expandedTabMotion[i-1])<expandDistance*.45),'展开时标签连续过渡，无单帧位置跳跃');
   await until(()=>evaluate("document.querySelector('.sidebar').getBoundingClientRect().width===252"));
   await evaluate("document.getElementById('accountSettings').click();document.querySelector('[data-setting=environment]').click()");
   const centered=await evaluate("(()=>{const content=document.querySelector('.settings-content').getBoundingClientRect(),head=document.querySelector('.settings-page-heading').getBoundingClientRect(),body=document.querySelector('.settings-body').getBoundingClientRect();return{head:head.x+head.width/2,body:body.x+body.width/2,center:content.x+content.width/2,width:body.width}})()");
   assert.ok(Math.abs(centered.head-centered.center)<1 && Math.abs(centered.body-centered.center)<1 && centered.width<=752,'系统环境标题和内容在同一居中容器');
   assert.equal(await evaluate("document.getElementById('environmentResultBadge').textContent"),'通过');
   assert.equal(await evaluate("getComputedStyle(document.getElementById('environmentResultBadge')).backgroundColor"),'rgba(0, 0, 0, 0)','状态标签宿主无嵌套色块');
   const centeredCapture=await captureUI();await writeFile('artifacts/system-environment-centered.png',Buffer.from(centeredCapture.data,'base64'));

  }else{
  await until(() => evaluate("Boolean(document.getElementById('railNewSession'))"));
  await until(()=>evaluate("document.getElementById('railNewSession').disabled && document.getElementById('sessionList').children.length===0"));
  assert.equal((await evaluate('window.workspace.runtimeInfo()')).runtimes.length,0,'未检测不会自动扫描运行时');
  assert.equal(await evaluate("window.workspace.newSession({engine:'codex',model:null}).then(()=>false,()=>true)"),true,'未检测时IPC也禁止新建对话');
  await evaluate("document.getElementById('refreshRuntimes').click()");
  await until(()=>evaluate("!document.getElementById('railNewSession').disabled && !document.getElementById('refreshRuntimes').disabled"));
  await evaluate("document.getElementById('railNewSession').click()");
  await until(()=>evaluate("document.getElementById('newSessionDialog').open"));
  await evaluate("document.getElementById('createNewSession').click()");
  await until(()=>evaluate("document.getElementById('sessionList').children.length===1"));
  assert.equal(await evaluate("document.querySelectorAll('button,input,select,textarea,dialog').length"),0,'应用外层控件全部来自组件库');
  await evaluate(`document.fonts.load('14px "Inter Variable"')`);
  assert.equal(await evaluate(`document.fonts.check('14px "Inter Variable"')`),true,'应用字体来自本地 Inter');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.sidebar')).width"),'252px','侧栏加宽');
  await until(()=>evaluate("document.querySelector('[data-page=cc] wa-icon').shadowRoot.querySelector('svg')!==null"));
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-page=cc] wa-icon')).width"),'16px','统一导航图标尺寸');
  assert.equal(await evaluate("document.getElementById('themeToggle')===null && document.getElementById('themeSelect').closest('[data-panel=preferences]')!==null"),true,'主题仅位于设置偏好设置');
  assert.equal(await evaluate("document.getElementById('newSession')===null && document.querySelector('[data-setting=ai]')===null && document.querySelector('.session-list-heading').textContent==='最近对话' && document.querySelector('.rail-heading strong').textContent==='对话'"),true,'一级无新会话，二级标题与最近对话准确');
  assert.equal(await evaluate("[...document.querySelectorAll('.settings-group-title')].map(el=>el.textContent).join(',')"),'个人,代理,设备');
  assert.equal(await evaluate("document.querySelectorAll('.settings-group-divider').length"),2);
  assert.equal(await evaluate("document.getElementById('proxySummary').dataset.state"),'blocked');
  assert.equal(await evaluate("document.getElementById('prompt').disabled"),true,'无代理时禁止输入');
  assert.equal(await evaluate("getComputedStyle(document.getElementById('send').shadowRoot.querySelector('[part~=base]')).borderTopLeftRadius"),'50%','发送按钮为圆形');
  assert.equal(await evaluate("document.getElementById('proxySummaryIP').classList.contains('hidden') && document.querySelector('.proxy-detail-line').classList.contains('hidden')"),true);
  assert.equal(await evaluate("document.querySelector('#sessionList small')===null && document.querySelector('#sessionList wa-dropdown')===null && document.querySelector('#sessionList .session-archive').textContent==='' && getComputedStyle(document.getElementById('chatStorageStatus')).display==='none'"),true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.app-toolbar')).left"),'136px');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.settings-content')).scrollbarWidth"),'none');
  const initialSession=(await evaluate('window.workspace.state()')).selectedEngine;
  await evaluate("document.getElementById('railNewSession').click()");
  await until(()=>evaluate("document.getElementById('newSessionDialog').open"));
  const beforeCancel=(await evaluate('window.workspace.state()')).aiSessions.length;
  await evaluate("document.getElementById('cancelNewSession').click()");
  assert.equal((await evaluate('window.workspace.state()')).aiSessions.length,beforeCancel,'取消不会创建会话');
  await until(()=>evaluate("!document.getElementById('newSessionDialog').open"));
  const beforeTabCount=await evaluate("document.querySelectorAll('.content-tab').length");
  await evaluate("document.getElementById('newContentTab').click()");
  assert.equal(await evaluate("document.querySelectorAll('.content-tab').length"),beforeTabCount+1,'加号打开新的对话标签');
  assert.equal(await evaluate("document.getElementById('newSessionDialog').open"),false,'新标签不弹出创建会话对话框');
  assert.equal((await evaluate('window.workspace.state()')).aiSessions.length,beforeCancel,'新标签不创建对话会话');
  await evaluate("document.querySelector('.content-tab.active .content-tab-close').click()");
  await until(()=>evaluate("document.querySelectorAll('.content-tab').length==="+beforeTabCount));
  await evaluate("await (async()=>{document.getElementById('railNewSession').click();while(!document.getElementById('newSessionDialog').open)await new Promise(r=>setTimeout(r,20));})();document.getElementById('runtimeEngine').value='codex';await document.getElementById('runtimeEngine').updateComplete;document.getElementById('runtimeEngine').dispatchEvent(new Event('change'));document.getElementById('codexModelSelect').value='gpt-5.5'");
  const newChatCapture=await captureUI();await writeFile('artifacts/new-chat-runtime.png',Buffer.from(newChatCapture.data,'base64'));
  await evaluate("document.getElementById('createNewSession').click()");
  await until(()=>evaluate("document.getElementById('sessionList').children.length===2 && document.getElementById('runtimeScope').textContent.includes('Codex')")).catch(async error=>{throw new Error(error.message+' '+JSON.stringify(await evaluate("({count:document.getElementById('sessionList').children.length,engine:document.getElementById('runtimeEngine').value,scope:document.getElementById('runtimeScope').textContent,status:document.getElementById('newSessionStatus').textContent,dialog:document.getElementById('newSessionDialog').open,toast:document.getElementById('toast').textContent})")))});
  const newestID=(await evaluate('window.workspace.state()')).activeAISessionId;
  assert.equal(await evaluate("document.querySelector('#sessionList .session-row').classList.contains('active')"),true,'最新对话置顶');
  assert.equal((await evaluate('window.workspace.state()')).project,'','新会话不要求项目');
  assert.equal((await evaluate('window.workspace.state()')).codexModel,'gpt-5.5','模型保存在新会话');
  await until(()=>evaluate("document.getElementById('aiAuthStatus').textContent.includes('已登录')"));
  await evaluate("document.querySelector('#sessionList .session-row:not(.active)').click()");
  await until(async()=> (await evaluate('window.workspace.state()')).selectedEngine===initialSession);
  assert.equal(await evaluate("document.getElementById('send').disabled"), true);
  await mkdir('artifacts',{recursive:true});
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.conversation-rail')).display"),'flex');
  assert.equal(await evaluate("document.getElementById('menuCreateEnvironment')===null && typeof document.getElementById('newEnvironment').onclick==='function'"),true,'创建环境仅保留在环境页面');
  await evaluate("document.querySelector('.sidebar .nav[data-page=environments]').click()");
  await until(()=>evaluate("!document.getElementById('page-environments').classList.contains('hidden')"));
  assert.equal(await evaluate("document.getElementById('environmentTrigger').textContent.includes('本机环境')"),true);
  await until(()=>evaluate("document.querySelector('[data-local-environment] .environment-inline-facts')!==null"));
  assert.ok(await evaluate("document.querySelector('[data-local-environment]').textContent.includes('工作文件') && document.querySelector('[data-local-environment]').textContent.includes('运行时登录')"),'环境详情直接显示在外层列表');
  assert.equal(await evaluate("document.getElementById('environmentDetail')===null"),true,'移除内部详情页');
  assert.equal(await evaluate("document.getElementById('environmentCount').textContent"),'1','数量包含内置本机环境');
  assert.equal(await evaluate('window.workspace.state().then(s=>s.containerId)'),null,'查看详情不切换工作环境');
  assert.equal(await evaluate("document.getElementById('environmentOverview').classList.contains('hidden')"),false);


  await evaluate("document.querySelector('[data-page=cc]').click()");
  const chatCapture=await captureUI();await writeFile('artifacts/multica-style-chat.png',Buffer.from(chatCapture.data,'base64'));
  assert.equal(await evaluate("document.querySelector('.sidebar-bottom > [data-page=overview]')===null"),true,'移除侧栏独立设置入口');
  await evaluate("document.getElementById('accountTrigger').click()");
  await until(()=>evaluate("document.getElementById('accountMenu').open"));
  assert.equal(await evaluate("document.getElementById('accountSettings').closest('#accountMenu')!==null"),true,'设置入口属于头像浮层');
  const avatarCapture=await captureUI();await writeFile('artifacts/avatar-settings-menu.png',Buffer.from(avatarCapture.data,'base64'));
  await evaluate("document.getElementById('accountSettings').click()");
  await until(()=>evaluate("!document.getElementById('page-overview').classList.contains('hidden') && !document.getElementById('accountMenu').open"));
  assert.equal(await evaluate("document.getElementById('settingsDialog')===null && document.querySelector('.brand')===null && !document.body.textContent.includes('工作空间')"),true,'普通设置页面、移除品牌与工作空间描述');
  assert.equal(await evaluate("(()=>{const s=getComputedStyle(document.querySelector('.content-tab:not(.active)'));return s.borderTopLeftRadius===s.borderBottomLeftRadius && s.borderTopLeftRadius===s.borderBottomRightRadius})()"),true,'未选中标签四角半径一致');
  await evaluate("document.querySelector('[data-setting=environment]').click()");
  assert.equal(await evaluate("document.querySelector('[data-panel=environment]').localName"),'section','系统环境使用平铺内容而不是内嵌卡片');
  assert.equal(await evaluate("document.getElementById('recheckEnvironment').closest('.settings-page-heading')!==null"),true,'检测按钮与设置标题同行');
  const systemCapture=await captureUI();await writeFile('artifacts/system-environment-fixture.png',Buffer.from(systemCapture.data,'base64'));
  await evaluate("document.querySelector('[data-page=cc]').click()");
  await evaluate("document.getElementById('accountSettings').click();document.querySelector('[data-setting=proxy]').click()");
  assert.equal(await evaluate("document.getElementById('settingsTitle').textContent"),'代理与出口');
  await evaluate("document.querySelector('[data-setting=environment]').click()");
  assert.equal(await evaluate("[...document.querySelectorAll('[data-environment]')].every(field=>field.textContent===document.getElementById(field.dataset.environment).textContent)"),true,'系统环境页与弹窗显示同一次检测结果');
  await evaluate("document.getElementById('recheckEnvironment').click()");
  await until(()=>evaluate("!document.getElementById('recheckEnvironment').disabled"));
  assert.equal(await evaluate("document.getElementById('environmentResultBadge').variant"),'success');
  await until(()=>evaluate("!document.getElementById('environmentGate').open"));
  assert.equal(await evaluate("document.getElementById('environmentGate').open"),false,'页面重检通过后直接展示结果');
  const environmentCapture=await captureUI();await writeFile('artifacts/settings-environment.png',Buffer.from(environmentCapture.data,'base64'));
  const settingsGaps=[];
  for(const key of ['preferences','proxy','environment','activity']){
   await evaluate("document.querySelector('[data-setting="+key+"]').click()");
   settingsGaps.push(await evaluate("(()=>{const head=document.querySelector('.settings-page-heading').getBoundingClientRect(),panel=[...document.querySelectorAll('.settings-body>.settings-panel')].find(el=>!el.classList.contains('hidden'));return panel.getBoundingClientRect().top-head.bottom})()"));
  }
  assert.ok(settingsGaps.every(gap=>Math.abs(gap-28)<1),'个人资料以外设置内容距离标题统一28px: '+settingsGaps);
  await evaluate("document.querySelector('[data-setting=proxy]').click()");
  assert.equal(await evaluate("document.getElementById('verify').closest('.settings-page-heading')!==null && document.querySelector('.proxy-status-panel')!==null"),true,'核验操作在标题行且连接状态集中展示');
  const settingsCapture=await captureUI();await writeFile('artifacts/multica-style-settings.png',Buffer.from(settingsCapture.data,'base64'));
  assert.equal(await evaluate("document.getElementById('proxyQuickToggle').disabled && document.getElementById('proxyQuickToggle').dataset.action==='connect' && !document.getElementById('proxySettingsGo')"),true,'未配置代理时快捷按钮禁用，移除前往按钮');
  assert.equal(await evaluate("document.getElementById('connect').disabled && document.getElementById('disconnect').classList.contains('hidden')"),true,'未配置时禁止连接且不显示断开');
  await evaluate("document.getElementById('proxyForm').requestSubmit()");
  assert.equal(await evaluate("document.getElementById('proxyValidation').textContent.includes('请输入代理')"),true,'库内错误提示代替系统校验气泡');
  await evaluate("document.getElementById('protocol').scrollIntoView({block:'center'});document.getElementById('protocol').focus();document.getElementById('protocol').show()");
  await until(()=>evaluate("document.getElementById('protocol').open"));
  const selectCapture=await captureUI();await writeFile('artifacts/component-select.png',Buffer.from(selectCapture.data,'base64'));
  await pause(250);
  const protocolChoice=await evaluate("(()=>{const r=document.querySelector('#protocol wa-option[value=https]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await client.call('Input.dispatchMouseEvent',{type,x:protocolChoice.x,y:protocolChoice.y,button:'left',clickCount:1});
  await until(()=>evaluate("document.getElementById('protocol').value==='https' && !document.getElementById('protocol').open")).catch(async error=>{throw new Error(error.message+' '+JSON.stringify(await evaluate("(()=>{const el=document.getElementById('protocol');return{value:el.value,open:el.open,options:[...el.querySelectorAll('wa-option')].map(x=>({value:x.value,disabled:x.disabled,selected:x.selected})),pageHidden:el.closest('.page').classList.contains('hidden')}})()")))});
  await evaluate("document.getElementById('remember').click()");
  assert.equal(await evaluate("document.getElementById('remember').checked"),true);
  await evaluate("document.getElementById('remember').click()");
  await evaluate("document.querySelector('[data-page=cc]').click();document.getElementById('themeSelect').value=document.body.classList.contains('dark')?'light':'dark';document.getElementById('themeSelect').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.body.classList.contains('dark')"),true);
  await evaluate("new Promise(resolve=>setTimeout(resolve,200))");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.session-row-container.selected')).backgroundColor"),'rgb(37, 37, 44)');
  const darkCapture=await captureUI();await writeFile('artifacts/multica-style-dark.png',Buffer.from(darkCapture.data,'base64'));
  await evaluate("document.getElementById('themeSelect').value=document.body.classList.contains('dark')?'light':'dark';document.getElementById('themeSelect').dispatchEvent(new Event('change'))");

  await until(()=>evaluate("!document.getElementById('environmentGate').open"));
  assert.equal((await evaluate("window.workspace.environmentCheck({timeZone:'Asia/Shanghai',languages:['en-US']})")).allowed,false);
  assert.equal(await evaluate("document.getElementById('environmentGate').open"),true);
  assert.equal(await evaluate("document.getElementById('environmentResultBadge').variant"),'danger');
  assert.equal(await evaluate("document.querySelector('[data-environment=environmentReasons]').textContent===document.getElementById('environmentReasons').textContent"),true);

  assert.equal(await evaluate("window.workspace.connect({protocol:'http',host:'127.0.0.1',port:1234},false).then(()=>false,()=>true)"),true,'界面之外的IPC也必须阻止');
  assert.equal(await evaluate("window.workspace.cc('blocked').then(()=>false,error=>error.message.includes('系统环境检测未通过'))"),true,'CC也必须先执行系统门禁');
  assert.equal((await evaluate("window.workspace.environmentCheck({timeZone:'UTC',languages:['en-US']})")).allowed,false);
  assert.equal((await evaluate("window.workspace.environmentCheck({timeZone:'America/New_York',languages:['zh-Hans-US']})")).allowed,false);
  assert.equal((await evaluate("window.workspace.environmentCheck({timeZone:'America/New_York',languages:['en-US']})")).allowed,true);
  await until(()=>evaluate("!document.getElementById('environmentGate').open"));
  assert.equal(await evaluate("document.getElementById('environmentGate').open"),false);
  await evaluate("document.getElementById('environmentRetry').click()");
  assert.equal(await evaluate("document.getElementById('environmentGate').open"),true,'弹窗重新检测保留详情');
  await until(()=>evaluate("!document.getElementById('environmentRetry').disabled"));
  assert.equal(await evaluate("document.getElementById('environmentGate').open && document.getElementById('environmentSummary').textContent.includes('检测通过') && document.getElementById('environmentCheckedAt').textContent!=='尚未完成'"),true,'成功结果必须保留供阅读');
  const firstEnvironmentCheck=await evaluate("window.workspace.state().then(state=>state.environment.checkedAt)");
  await evaluate("document.getElementById('environmentRetry').click()");
  await until(()=>evaluate("!document.getElementById('environmentRetry').disabled"));
  assert.notEqual(await evaluate("window.workspace.state().then(state=>state.environment.checkedAt)"),firstEnvironmentCheck,'每次点击重新执行检测');
  await evaluate("document.getElementById('environmentClose').click()");
  await until(()=>evaluate("!document.getElementById('environmentGate').open"));
  assert.equal(await evaluate("document.getElementById('environmentGate').open"),false);


  const csv = `Host,Port,User,Pass\n127.0.0.1,${proxy.address().port},demo,secret\n`;
  await evaluate(`document.getElementById('protocol').value='https'; document.getElementById('importPaste').click(); document.getElementById('importText').value=${JSON.stringify(csv)}; document.getElementById('parseImport').click();`);
  await until(() => evaluate("document.getElementById('importStatus').textContent.includes('已导入')"));
  assert.equal(await evaluate("document.getElementById('username').value==='demo' && document.getElementById('password').value==='secret'"), true);
  await until(()=>evaluate("!document.getElementById('importDialog').open"));
  assert.equal(await evaluate("document.getElementById('importDialog').open"), false);
  assert.equal(exitRequests, 0, '导入不能自动连接');
  assert.equal(await evaluate("document.getElementById('protocol').value==='http'"), true, 'IPRoyal 导入不能继承误选的 TLS 入口');
  assert.equal(await evaluate("document.getElementById('protocol').selectedOptions[0].textContent"), 'HTTP / HTTPS');
  await until(()=>evaluate("!document.getElementById('importDialog').shadowRoot.querySelector('dialog').open"));
  const pickDirectory=path.join(temp,'picker-fixture');await mkdir(pickDirectory);const exportFile=path.join(pickDirectory,'proxies.csv');await writeFile(exportFile,csv);
  await evaluate("document.querySelector('[data-page=cc]').click();document.getElementById('composeAdd').click();document.getElementById('pickProject').click()");
  await until(()=>evaluate("document.getElementById('filePicker').open"));
  await evaluate(`document.getElementById('filePickerPath').value=${JSON.stringify(pickDirectory)};document.getElementById('filePickerGo').click()`);
  await until(()=>evaluate(`document.getElementById('filePickerPath').value===${JSON.stringify(pickDirectory)} && document.getElementById('filePickerEntries').textContent.includes('此目录没有')`));
  assert.equal(await evaluate("(()=>{const toast=document.getElementById('toast');if(!toast.matches(':popover-open'))return true;const rect=toast.getBoundingClientRect();return rect.left>=0 && rect.right<=innerWidth;})()"),true,'组件库通知不能超出窗口');
  const pickerCapture=await captureUI();await writeFile('artifacts/component-file-picker.png',Buffer.from(pickerCapture.data,'base64'));
  await evaluate("document.getElementById('filePickerConfirm').click()");
  await until(()=>evaluate("!document.getElementById('filePicker').open"));
  await until(()=>evaluate("!document.getElementById('projectPath').classList.contains('hidden')"));
  assert.equal(await evaluate("document.getElementById('projectPath').closest('.session-heading')!==null"),true,'路径显示在标题旁');
  await until(async()=> (await evaluate('window.workspace.state()')).project===pickDirectory);
  await until(()=>evaluate("!document.getElementById('filePicker').shadowRoot.querySelector('dialog').open"));
  await evaluate("document.querySelector('[data-page=overview]').click();document.querySelector('[data-setting=proxy]').click();document.getElementById('importFile').click()");
  await until(()=>evaluate("document.getElementById('filePicker').open"));
  await evaluate(`document.getElementById('filePickerPath').value=${JSON.stringify(pickDirectory)};document.getElementById('filePickerGo').click()`);
  await until(()=>evaluate("document.getElementById('filePickerEntries').textContent.includes('proxies.csv')"));
  await evaluate("(async()=>{document.querySelector('#filePickerEntries app-button').click();await document.getElementById('filePickerConfirm').updateComplete;document.getElementById('filePickerConfirm').click();})()");
  await until(()=>evaluate("document.getElementById('password').value==='secret' && !document.getElementById('filePicker').open"));
  await until(()=>evaluate("!document.getElementById('filePicker').shadowRoot.querySelector('dialog').open"));
  assert.equal(exitRequests,0,'组件库文件导入不自动联网');
  const list = `203.0.113.43:12323:other:other_pw\n127.0.0.1:${proxy.address().port}:demo:secret`;
  await evaluate(`document.getElementById('importPaste').click(); document.getElementById('importText').value=${JSON.stringify(list)}; document.getElementById('parseImport').click();`);
  await until(() => evaluate("document.getElementById('importEntries').children.length===2"));
  assert.equal(await evaluate("document.getElementById('importEntries').textContent.includes('secret')"), false);
  await mkdir('artifacts', { recursive: true });
  const importScreenshot = await captureUI(); await writeFile('artifacts/iproyal-import.png', Buffer.from(importScreenshot.data, 'base64'));
  await evaluate("document.querySelector('#importEntries wa-radio[value=\"1\"]').click(); document.getElementById('applyImport').click()");
  await until(() => evaluate("!document.getElementById('importDialog').open"));
  assert.equal(await evaluate(`document.getElementById('port').value==='${proxy.address().port}'`), true);
  await evaluate("document.getElementById('connect').click()");
  await until(() => evaluate("document.getElementById('exitIp').textContent==='203.0.113.23'")).catch(async error => { throw new Error(`${error.message}\n${stderr}\n${await evaluate("document.getElementById('toast').textContent")}`); });
  assert.ok(exitRequests >= 1);
  assert.equal(await evaluate("document.getElementById('connect').classList.contains('hidden') && !document.getElementById('disconnect').classList.contains('hidden') && !document.getElementById('verify').disabled"),true,'连接后显示断开与重新核验，隐藏重复连接操作');
  await evaluate("document.querySelector('[data-page=browser]').click(); document.getElementById('address').value='http://fixture.invalid/page'; document.getElementById('navigate').click();");
  await until(() => browserRequests > 0).catch(async error => { throw new Error(`${error.message}\n${stderr}\n${JSON.stringify((await evaluate('window.workspace.state()')).browser)}`); });
  const browserPage = await until(async () => { const list = await fetch(`http://127.0.0.1:${debugPort}/json`).then(r => r.json()); return list.find(p => p.url === 'http://fixture.invalid/page'); });
  const browserClient = fixtureClient(browserPage.url);
  const body = await browserClient.call('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
  assert.match(body.result.value, /浏览器已通过模拟代理/);
  const browserPolicy = await browserClient.call('Runtime.evaluate', { expression: `JSON.stringify({language:navigator.language,languages:navigator.languages,canvas:(()=>{const ctx=document.createElement('canvas').getContext('2d');ctx.font='20px "PingFang SC", monospace';return ctx.font})(),fontCheck:document.fonts.check('20px "PingFang SC"'),localFont:(()=>{try{new FontFace('probe','local("PingFang SC")');return true}catch{return false}})()})`, returnByValue:true });
  const policy = JSON.parse(browserPolicy.result.value);
  assert.equal(policy.language, 'en-US'); assert.ok(policy.languages.every(language=>/^en(?:-|$)/i.test(language)), JSON.stringify(policy));
  assert.equal(policy.canvas,'20px monospace');
  const fontWidths = await browserClient.call('Runtime.evaluate', { expression: `(()=>{const ctx=document.createElement('canvas').getContext('2d');ctx.font='20px monospace';const base=ctx.measureText('mmmmmmmmmmlli').width;return ['PingFang SC','Hiragino Sans GB','STHeiti','STSong','SimSun','Microsoft YaHei','Arial Unicode MS'].map(name=>{ctx.font='20px '+JSON.stringify(name)+', monospace';return {name,blocked:ctx.measureText('mmmmmmmmmmlli').width===base}})})()`, returnByValue:true });
  assert.ok(fontWidths.result.value.every(font=>font.blocked)); assert.equal(policy.fontCheck,false); assert.equal(policy.localFont,false);
  assert.ok(acceptLanguages.filter(Boolean).every(header=>!header.toLowerCase().includes('zh')));
  let realmTimer;
  const realmResult = await Promise.race([browserClient.call('Runtime.evaluate', { awaitPromise:true, returnByValue:true, expression: `(async()=>{
    const results={}; globalThis.privacyProgress='frames';
    const frames=['http://fixture.invalid/privacy-frame','http://frame.invalid/privacy-frame'];
    for(const url of frames) results[url]=await new Promise(resolve=>{const handler=event=>{if(event.data?.kind==='frame-proof'&&event.origin===new URL(url).origin){removeEventListener('message',handler);resolve(event.data.result)}};addEventListener('message',handler);const frame=document.createElement('iframe');frame.src=url;document.body.append(frame)});
    globalThis.privacyProgress='srcdoc';results.srcdoc=await new Promise(resolve=>{const handler=event=>{if(event.data?.kind==='srcdoc-proof'){removeEventListener('message',handler);resolve(event.data.result)}};addEventListener('message',handler);const frame=document.createElement('iframe');frame.srcdoc=${JSON.stringify(`<script>parent.postMessage({kind:'srcdoc-proof',result:(${realmProbe.toString()})()},'*')</script>`)};document.body.append(frame)});
    globalThis.privacyProgress='worker';const worker=new Worker('/privacy-worker.js');await new Promise(resolve=>{worker.onmessage=event=>{if(event.data.nested)results.nested=event.data.nested;else results.worker=event.data;if(results.worker&&results.nested)resolve()}});worker.terminate();
    globalThis.privacyProgress='shared';const moduleWorker=new Worker('/privacy-module.js',{type:'module'});results.moduleWorker=await new Promise(resolve=>moduleWorker.onmessage=e=>resolve(e.data));moduleWorker.terminate();
    const shared=new SharedWorker('/privacy-shared.js');results.shared=await new Promise(resolve=>{shared.port.onmessage=event=>resolve(event.data);shared.port.start()});shared.port.close();
    const sharedModule=new SharedWorker('/privacy-shared.js',{type:'module',name:'module-proof'});results.sharedModule=await new Promise(resolve=>{sharedModule.port.onmessage=e=>resolve(e.data);sharedModule.port.start()});sharedModule.port.close();
    globalThis.privacyProgress='service';const registration=await navigator.serviceWorker.register('/privacy-sw.js');await navigator.serviceWorker.ready;
    results.service=await new Promise(resolve=>{navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.kind==='sw-proof')resolve(event.data.result)},{once:true});registration.active.postMessage('probe')});await registration.unregister();
    return results;
  })()` }), new Promise(resolve=>{realmTimer=setTimeout(resolve,20000)}).then(async()=>{const progress=await browserClient.call('Runtime.evaluate',{expression:'privacyProgress',returnByValue:true});throw new Error('Realm timeout '+progress.result.value+'\n'+stderr)})]);
  clearTimeout(realmTimer);
  if(realmResult.exceptionDetails) throw new Error('隐私执行环境测试失败：'+realmResult.exceptionDetails.text);
  for(const [realm,result] of Object.entries(realmResult.result.value)) { assert.equal(result.installed,true,realm);assert.equal(result.sameWidth,true,realm);assert.equal(result.localAllowed,false,realm);assert.equal(result.rtcBlocked,true,realm);assert.equal(result.rtcAbsent,true,realm); }
  assert.equal((await evaluate("window.workspace.dnsProbe('example.com')")).blocked,true,'浏览器本机DNS必须拒绝目标解析');
  assert.equal((await evaluate("window.workspace.dnsProbe('127.0.0.1')")).blocked,false,'DNS探测必须确实调用Chromium解析器');
  const {frameTree} = await browserClient.call('Page.getFrameTree',{});
  const {executionContextId} = await browserClient.call('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'native-webrtc-test'});
  const rtcNative = await browserClient.call('Runtime.evaluate',{contextId:executionContextId,awaitPromise:true,returnByValue:true,expression:`(async()=>{const candidates=[];const pc=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${stun.address().port}'}]});pc.onicecandidate=e=>{if(e.candidate)candidates.push(e.candidate.candidate)};pc.createDataChannel('probe');await pc.setLocalDescription(await pc.createOffer());await new Promise(r=>setTimeout(r,1500));pc.close();return candidates})()`});
  assert.deepEqual(rtcNative.result.value,[],'Chromium原生WebRTC不应产生直连候选'); assert.equal(stunPackets,0,'STUN监听器不应收到UDP数据');
  console.log('原生WebRTC：候选0、STUN UDP数据包0；example.com本机DNS拒绝，IP字面值解析成功。');
  console.log('iframe/worker/WebRTC/DNS保护：',JSON.stringify(realmResult.result.value));
  console.log('浏览器语言与字体访问策略：',JSON.stringify(policy)); browserClient.close();
  await evaluate("const address=document.getElementById('address'); address.focus(); address.value='fixture'; address.dispatchEvent(new Event('input'));");
  assert.equal(await evaluate("document.getElementById('addressSuggestions').textContent.includes('Google 搜索') && document.getElementById('addressSuggestions').textContent.includes('切换到这个标签页')"), true);
  const privateBefore=browserRequests;
  assert.equal((await evaluate("window.workspace.environmentCheck({timeZone:'America/New_York',languages:['zh-CN','en-US']})")).allowed,false);
  assert.equal((await evaluate('window.workspace.state()')).network.state,'blocked');
  assert.equal(await evaluate("window.workspace.browser('navigate','http://fixture.invalid/gate-blocked').then(()=>false,()=>true)"),true);
  assert.equal(browserRequests,privateBefore);
  assert.equal((await evaluate("window.workspace.environmentCheck({timeZone:'America/New_York',languages:['en-US']})")).allowed,true);
  assert.equal(await evaluate("getComputedStyle(document.getElementById('proxyQuickToggle')).color"),'rgb(22, 141, 45)','连接按钮为绿色');
  await evaluate("document.getElementById('proxyQuickToggle').click()");
  await until(()=>evaluate("document.getElementById('connectionState').textContent==='已连接'"));
  assert.equal(await evaluate("document.getElementById('proxyQuickToggle').dataset.action==='disconnect' && !document.getElementById('proxyQuickToggle').disabled"),true,'连接成功后可快捷断开');
  assert.equal(await evaluate("getComputedStyle(document.getElementById('proxyQuickToggle')).color"),'rgb(211, 78, 78)','断开按钮为红色');
  assert.equal(await evaluate("parseFloat(getComputedStyle(document.querySelector('.content-tab')).paddingRight)===2"),true,'标签右侧有内边距');
  await evaluate("document.getElementById('proxyQuickToggle').click()");
  await until(()=>evaluate("document.getElementById('prompt').disabled && document.getElementById('connectionState').textContent==='未连接'"));
  await evaluate("document.getElementById('proxyQuickToggle').click()");
  await until(()=>evaluate("document.getElementById('connectionState').textContent==='已连接'"));

  await evaluate("document.getElementById('address').focus();document.getElementById('address').value='fixture';document.getElementById('address').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.getElementById('proxyStatusLabel').textContent"),'正在代理');
  assert.equal(await evaluate("document.getElementById('proxySummaryIP').textContent"),fixtureExitIp);
  const colors=await evaluate("[...document.querySelectorAll('#sessionList .brand-icon')].map(el=>({provider:el.classList.contains('brand-codex')?'codex':'cc',color:getComputedStyle(el).color}))");
  for(const item of colors)assert.equal(item.color,item.provider==='cc'?'rgb(217, 119, 87)':'rgb(0, 0, 0)');
  assert.equal(await evaluate("document.getElementById('prompt').disabled"),false,'代理核验通过后恢复输入');
  await evaluate("document.getElementById('address').value='fixture';document.getElementById('address').dispatchEvent(new Event('input'))");
  const requestsBeforeReload = browserRequests;
  await evaluate("window.workspace.browser('reload')"); await until(() => browserRequests > requestsBeforeReload);
  assert.equal(await evaluate("document.getElementById('address').value"), 'fixture', '页面加载事件不能覆盖正在编辑的地址');
  await evaluate("document.getElementById('address').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); document.getElementById('address').blur();");
  assert.equal(await evaluate("document.getElementById('addressSuggestions').classList.contains('hidden')"), true);
  await evaluate("window.workspace.browser('navigate','http://fixture.invalid/opener')");
  const openerPage = await until(async () => (await fetch(`http://127.0.0.1:${debugPort}/json`).then(r => r.json())).find(p => p.url === 'http://fixture.invalid/opener'));
  const openerClient = fixtureClient(openerPage.url);
  await until(async () => (await openerClient.call('Runtime.evaluate', { expression: 'Boolean(document.querySelector("form"))', returnByValue: true })).result.value);
  await openerClient.call('Runtime.evaluate', { expression: 'document.querySelector("form").submit()', userGesture: true });
  await until(() => popupPost).catch(async error => { throw new Error(`${error.message}\n${stderr}\n${await evaluate("document.getElementById('browserTabs').textContent")}`); });
  assert.deepEqual(popupPost, { method: 'POST', body: 'code=fixture-code' }, '登录弹窗必须保留POST数据');
  await until(async () => (await openerClient.call('Runtime.evaluate', { expression: 'document.body.dataset.callback', returnByValue: true })).result.value === 'received');
  await until(() => evaluate("document.querySelectorAll('.browser-tab').length===1 && document.getElementById('address').value==='http://fixture.invalid/opener'"));
  openerClient.close();
  await evaluate("window.workspace.browser('navigate','http://fixture.invalid/page')");
  await until(() => evaluate("document.getElementById('address').value==='http://fixture.invalid/page'"));
  assert.equal(await evaluate("document.getElementById('toast').textContent.includes('loadURL')"), false);
  const firstTab = await evaluate("document.querySelector('#browserTabs .browser-tab.active').dataset.url");
  assert.equal(firstTab, 'http://fixture.invalid/page');
  await evaluate("document.getElementById('newTab').click()");
  await until(() => evaluate("document.querySelectorAll('.browser-tab').length===2 && document.getElementById('address').value==='http://fixture.invalid/home'"));
  assert.ok(browserRequests >= 2, '新标签必须自动请求首页');
  await evaluate("window.workspace.browser('navigate','http://fixture.invalid/slow')");
  // A newer navigation cancels the slow page (-3); the redirect must still render.
  await evaluate("window.workspace.browser('navigate','http://fixture.invalid/redirect')");
  await until(() => evaluate("document.getElementById('address').value==='http://fixture.invalid/final' && !document.getElementById('browserMessage').textContent.includes('加载…')"));
  assert.equal(await evaluate("document.getElementById('toast').textContent.includes('ERR_ABORTED')"), false);
  const finalPage = await until(async () => (await fetch(`http://127.0.0.1:${debugPort}/json`).then(r => r.json())).find(p => p.url === 'http://fixture.invalid/final'));
  const finalClient = fixtureClient(finalPage.url);
  const finalBody = await finalClient.call('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
  assert.match(finalBody.result.value, /浏览器已通过模拟代理/); finalClient.close();
  await evaluate("document.querySelector('#browserTabs .tab-select').click()");
  await until(() => evaluate("document.getElementById('address').value==='http://fixture.invalid/page'"));
  await evaluate("document.querySelectorAll('#browserTabs .tab-close')[1].click()");
  await until(() => evaluate("document.querySelectorAll('.browser-tab').length===1"));
  const activeBeforeSettings=await evaluate("document.querySelector('#browserTabs .browser-tab.active').dataset.url");
  await evaluate("document.getElementById('accountTrigger').click()");
  await until(()=>evaluate("document.getElementById('accountMenu').open"));
  await evaluate("document.getElementById('accountSettings').click()");
  await until(()=>evaluate("!document.getElementById('page-overview').classList.contains('hidden')"));
  assert.equal(await evaluate("document.getElementById('page-browser').classList.contains('hidden')"),true,'设置是独立页面');
  await evaluate("document.querySelector('[data-page=browser]').click()");
  assert.equal(await evaluate("document.querySelector('#browserTabs .browser-tab.active').dataset.url"),activeBeforeSettings,'返回浏览器保留原标签');
  await evaluate("document.getElementById('accountSettings').click()");
  await pause(150);
  const screenshot = await captureUI(); await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/connected.png', Buffer.from(screenshot.data, 'base64'));
  const before = browserRequests;
  const newProxy = '203.0.113.44:12323:new_user:new_pw';
  await evaluate(`document.getElementById('importPaste').click(); document.getElementById('importText').value=${JSON.stringify(newProxy)}; document.getElementById('parseImport').click();`);
  await until(() => evaluate("document.getElementById('connectionReason').textContent.includes('已导入 IPRoyal')"));
  assert.equal(await evaluate("document.getElementById('send').disabled && document.getElementById('navigate').disabled"), true, '导入新代理应先断开现有连接');
  assert.equal(browserRequests, before);
  await evaluate("document.getElementById('disconnect').click()");
  await until(() => evaluate("document.getElementById('connectionReason').textContent.includes('已断开')"));
  assert.equal(await evaluate("document.getElementById('send').disabled"), true);
  assert.equal(await evaluate("document.getElementById('navigate').disabled"), true);
  const denied = await evaluate("window.workspace.browser('navigate','http://fixture.invalid/forbidden').then(()=>false,()=>true)");
  assert.equal(denied, true); assert.equal(browserRequests, before);
  assert.equal((await evaluate("window.workspace.environmentCheck({timeZone:'Asia/Urumqi',languages:['en-US']})")).allowed,false);
  assert.equal(await evaluate("document.getElementById('environmentGate').open"),true);
  assert.equal((await evaluate("window.workspace.environmentCheck({timeZone:'America/New_York',languages:['en-US']})")).allowed,true);
  const pinsOnDisk = JSON.parse(await readFile(path.join(temp, 'egress-pins.json'), 'utf8'));
  assert.ok(Object.values(pinsOnDisk).includes('203.0.113.23'), '固定出口必须持久化');
  fixtureExitIp = '203.0.113.99';
  const pinned = await evaluate(`window.workspace.connect({protocol:'http',host:'127.0.0.1',port:${proxy.address().port},username:'demo',password:'secret'},false)`);
  assert.equal(pinned.state, 'blocked'); assert.equal(pinned.ip, '203.0.113.23', '手动重新连接必须继续锁定原出口');
  await evaluate("document.querySelector('[data-page=overview]').click();document.querySelector('[data-setting=proxy]').click();document.getElementById('accountLogin').click()");
  await until(()=>evaluate("document.getElementById('accountName').textContent==='测试用户 1'"));
  await until(()=>evaluate("document.getElementById('host').value===''"));
  assert.equal(await evaluate("document.getElementById('accountAvatar').localName"),'wa-avatar');
  assert.equal(await evaluate("window.workspace.state().then(state=>state.network.state)"),'blocked');
  await evaluate("document.getElementById('accountTrigger').click()");
  await until(()=>evaluate("document.getElementById('accountMenu').open"));
  await evaluate("document.getElementById('toast').replaceChildren()");
  assert.equal(await evaluate("document.getElementById('accountMenuName').textContent"),'测试用户 1','头像浮层头部显示名称');
  assert.equal(await evaluate("document.getElementById('accountMenuAvatar').image===document.getElementById('accountAvatar').image && document.getElementById('accountMenuAvatar').initials===document.getElementById('accountAvatar').initials"),true,'浮层头像沿用当前用户');
  assert.equal(await evaluate("['accountSettings','accountLogout'].every(id=>document.getElementById(id).querySelector('wa-icon[slot=icon]'))"),true,'设置和退出图标使用独立图标槽');
  const menuGap=await evaluate("(()=>{const item=document.getElementById('accountSettings');return item.shadowRoot.querySelector('[part=label]').getBoundingClientRect().left-item.querySelector('wa-icon').getBoundingClientRect().right})()");
  assert.ok(menuGap>=10 && menuGap<=14,'菜单图标和标题保持12px间距');
  const logoutRect=await evaluate("(()=>{const r=document.getElementById('accountLogout').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await client.call('DOM.enable');await client.call('CSS.enable');
  const hoverDocument=await client.call('DOM.getDocument');const hoverNode=await client.call('DOM.querySelector',{nodeId:hoverDocument.root.nodeId,selector:'#accountLogout'});
  await client.call('CSS.forcePseudoState',{nodeId:hoverNode.nodeId,forcedPseudoClasses:['hover']});
  await until(()=>evaluate("document.getElementById('accountLogout').matches(':hover')"));
  await until(()=>evaluate("getComputedStyle(document.getElementById('accountLogout')).backgroundColor==='rgb(254, 242, 242)'"));
  assert.equal(await evaluate("getComputedStyle(document.getElementById('accountLogout')).backgroundColor"),'rgb(254, 242, 242)','退出悬停浅红背景');
  assert.equal(await evaluate("getComputedStyle(document.getElementById('accountLogout').querySelector('wa-icon')).color"),'rgb(220, 38, 38)','退出悬停文字图标为红色');
  const accountCapture=await captureUI();await writeFile('artifacts/account-menu.png',Buffer.from(accountCapture.data,'base64'));
  await client.call('CSS.forcePseudoState',{nodeId:hoverNode.nodeId,forcedPseudoClasses:[]});
  await evaluate("document.getElementById('accountMenu').open=false;document.getElementById('host').value='203.0.113.42';document.getElementById('port').value='12323';document.getElementById('username').value='fixture';document.getElementById('password').value='account-one-secret';document.getElementById('password').dispatchEvent(new Event('input'))");
  await until(()=>accountProxies.get('fixture-account-1')?.password==='account-one-secret');
  assert.equal(accountProxies.get('fixture-account-1').host,'203.0.113.42');
  await evaluate("document.getElementById('accountLogout').click()");
  await until(()=>evaluate("document.getElementById('accountName').textContent==='未登录' && document.getElementById('host').value===''"));
  assert.equal(accountRevoked.has('fixture-account-1'),true);
  await evaluate("document.getElementById('accountLogin').click()");
  await until(()=>evaluate("document.getElementById('accountName').textContent==='测试用户 2'"));
  assert.equal(await evaluate("document.getElementById('host').value==='' && document.getElementById('password').value===''"),true,'换账号不得继承旧代理');
  assert.equal(accountProxies.has('fixture-account-2'),false);
  assert.equal(await evaluate("document.getElementById('accountSubtitle').textContent"),'user2@example.test','账号副标题展示当前用户邮箱');
  await evaluate("document.querySelector('.sidebar .nav[data-page=environments]').click()");
  if(await evaluate("window.workspace.dockerEnvironments('state').then(s=>s.engine.ready)")){
   const before=await evaluate('window.workspace.state().then(s=>s.aiSessions.length)');
   await evaluate("window.workspace.dockerEnvironments('create',{name:'删除验收环境'})");
   const environmentDetail=await evaluate("(async()=>{const s=await window.workspace.dockerEnvironments('state');return window.workspace.dockerEnvironments('detail',{id:s.environments.find(e=>e.name==='删除验收环境').id})})()");
   assert.equal(environmentDetail.name,'删除验收环境');assert.deepEqual(environmentDetail.runtimes,[]);assert.equal(environmentDetail.proxyConfigured,false);
   assert.equal(await evaluate('window.workspace.state().then(s=>s.containerId)'),null,'读取未选中环境详情不切换环境');

   await evaluate("(async()=>{const s=await window.workspace.dockerEnvironments('state');const id=s.environments.find(e=>e.name==='删除验收环境').id;await window.workspace.dockerEnvironments('start',{id});await window.workspace.dockerEnvironments('select',{id});await window.workspace.runtimeInfo({detect:true});const chat=await window.workspace.newSession({engine:'codex',model:null});const state=await window.workspace.state();await window.workspace.saveChats([{id:chat.id,title:'环境删除对话验收',messages:[{role:'user',text:'临时测试内容'}]}],state.account.user.id,id);})()");
   await until(()=>evaluate("document.getElementById('environmentName').textContent==='删除验收环境'"));

   await evaluate("document.querySelector('nav [data-page=environments]').click()");
   await until(()=>evaluate("!!document.querySelector('[aria-label=\"删除环境 删除验收环境\"]')"));
   await evaluate("document.querySelector('[aria-label=\"删除环境 删除验收环境\"]').click()");
   await until(()=>evaluate("document.getElementById('deleteEnvironmentDialog').open"));
   assert.equal(await evaluate("document.getElementById('confirmDeleteEnvironment').disabled"),true);
   await evaluate("document.getElementById('deleteEnvironmentName').value='错误名称';document.getElementById('deleteEnvironmentName').dispatchEvent(new Event('input'))");
   assert.equal(await evaluate("document.getElementById('confirmDeleteEnvironment').disabled"),true);
   await evaluate("document.getElementById('deleteEnvironmentName').value='删除验收环境';document.getElementById('deleteEnvironmentName').dispatchEvent(new Event('input'))");
   assert.equal(await evaluate("document.getElementById('confirmDeleteEnvironment').disabled"),false);
   await evaluate("document.getElementById('confirmDeleteEnvironment').click()");
   await until(()=>evaluate("!document.getElementById('deleteEnvironmentDialog').open"));
   assert.equal(await evaluate("window.workspace.dockerEnvironments('state').then(s=>s.environments.some(e=>e.name==='删除验收环境'))"),false);
   assert.equal(await evaluate('window.workspace.state().then(s=>s.aiSessions.length)'),before,'删除容器环境不影响本机对话');
   assert.equal(await evaluate('window.workspace.state().then(s=>s.containerId)'),null,'删除当前环境后回到本机');
   assert.equal(await evaluate('window.workspace.state().then(s=>s.network.state)'), 'blocked');
   assert.equal(JSON.stringify(accountChats.get('fixture-account-2')).includes('环境删除对话验收'),false,'后端同步移除环境对话');
  }

  await evaluate("document.getElementById('accountSettings').click();document.querySelector('[data-setting=preferences]').click()");
  await evaluate("document.getElementById('themeSelect').value='dark';document.getElementById('themeSelect').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.body.classList.contains('dark') && localStorage.getItem('ui-theme')==='dark'"),true,'偏好主题保存');
  await evaluate("document.getElementById('themeSelect').value='light';document.getElementById('themeSelect').dispatchEvent(new Event('change'))");
  await evaluate("document.querySelector('[data-setting=profile]').click();document.getElementById('profileName').value='更新后的用户';document.getElementById('profileName').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
  await until(()=>evaluate("document.getElementById('profileStatus').textContent==='已保存' && document.getElementById('accountName').textContent==='更新后的用户'"));
  await evaluate("document.querySelector('#profileActivityGrid>span:last-child').dispatchEvent(new MouseEvent('mouseenter'))");
  await until(()=>evaluate("document.getElementById('profileActivityTooltip').open && document.getElementById('profileActivityTooltip').popup.active"));
  assert.equal(await evaluate("/月.*日.*暂无 Token 数据/.test(document.getElementById('profileActivityTooltip').textContent)"),true,'活动格子悬停显示本地化日期且不编造历史 Token 用量');
  const activityCapture=await captureUI();await writeFile('artifacts/profile-activity-tooltip-fixture.png',Buffer.from(activityCapture.data,'base64'));
  await evaluate("document.querySelector('#profileActivityGrid>span:last-child').dispatchEvent(new MouseEvent('mouseleave'))");
  await until(()=>evaluate("!document.getElementById('profileActivityTooltip').open && !document.getElementById('profileActivityTooltip').popup.active"));
  await evaluate("document.querySelector('#profileActivityGrid>span:last-child').dispatchEvent(new FocusEvent('focus'))");
  await until(()=>evaluate("document.getElementById('profileActivityTooltip').open"));
  await evaluate("document.querySelector('#profileActivityGrid>span:last-child').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
  assert.equal(await evaluate("document.getElementById('profileActivityTooltip').open"),false,'键盘聚焦可查看且 Escape 可关闭提示');
  const profileCapture=await captureUI();await writeFile('artifacts/profile-fixture.png',Buffer.from(profileCapture.data,'base64'));
  assert.equal(await evaluate("/年/.test(document.getElementById('environmentCheckedAt').textContent)"),true,'中文账号日期使用中文格式');
  await evaluate("document.querySelector('[data-setting=preferences]').click();document.getElementById('languageSelect').value='en-US';document.getElementById('languageSelect').dispatchEvent(new Event('change'))");
  await until(()=>accountProfiles.get('fixture-account-2')?.language==='en-US');
  await until(()=>evaluate("document.documentElement.lang==='en-US' && /AM|PM/.test(document.getElementById('environmentCheckedAt').textContent)"));
  assert.equal(await evaluate("[...document.querySelectorAll('time[datetime]')].every(time=>/AM|PM/.test(time.textContent))"),true,'已有连接记录时间随语言更新');
  assert.equal(accountProfiles.has('fixture-account-1'),false,'资料和语言按账号隔离');
  assert.equal((await evaluate('window.workspace.runtimeInfo()')).runtimes.length,0,'新账号不继承访客检测结果');
  assert.equal(await evaluate("document.getElementById('railNewSession').disabled && document.getElementById('sessionList').children.length===0 && document.querySelector('.proxy-ecg')===null && document.getElementById('saveProfile')===null && !document.getElementById('profileIP').textContent.includes('客户端直连检测')"),true);
  await evaluate("document.getElementById('refreshRuntimes').click()");
  await until(()=>evaluate("!document.getElementById('refreshRuntimes').disabled && Number(document.getElementById('runtimeCount').textContent)>0"));
  assert.ok([...accountRuntimes.keys()].some(key=>key.startsWith('fixture-account-2:')),'检测结果保存当前账号');
  const registry=await evaluate('window.workspace.runtimeInfo()');
  await evaluate("document.querySelector('[data-page=runtime]').click()");
  await until(()=>evaluate("Number(document.getElementById('runtimeCount').textContent)===document.getElementById('runtimeEngine').querySelectorAll('wa-option').length"));
  assert.equal(await evaluate("Number(document.getElementById('runtimeCount').textContent)"),registry.runtimes.length,'运行时和新对话共用本机检测结果');
  await evaluate("document.getElementById('accountSettings').click();document.querySelector('[data-setting=preferences]').click()");
  const preferenceCapture=await captureUI();await writeFile('artifacts/content-tabs-preferences.png',Buffer.from(preferenceCapture.data,'base64'));
  const tabsBefore=await evaluate("document.querySelectorAll('#contentTabs .content-tab').length");
  const sessionsBefore=(await evaluate('window.workspace.state()')).aiSessions.length;
  for(let i=0;i<3;i++){
   await evaluate("await (async()=>{document.getElementById('railNewSession').click();while(!document.getElementById('newSessionDialog').open)await new Promise(r=>setTimeout(r,20));})();document.getElementById('createNewSession').click()");
   await until(async()=> (await evaluate('window.workspace.state()')).aiSessions.length===sessionsBefore+i+1 && await evaluate("!document.getElementById('newSessionDialog').open && !document.getElementById('createNewSession').disabled"));
  }
  assert.equal(await evaluate("document.querySelectorAll('#contentTabs .content-tab').length"),tabsBefore,'新增二级会话复用对话标签');
  assert.equal(await evaluate("document.querySelectorAll('#contentTabs [data-tab-id=cc]').length"),1,'对话只有一个一级标签');
  await evaluate("document.querySelectorAll('#sessionList .session-row')[1].click()");
  await until(()=>evaluate("document.querySelectorAll('#sessionList .session-row')[1].classList.contains('active')"));
  assert.equal(await evaluate("document.querySelectorAll('#contentTabs .content-tab').length"),tabsBefore,'切换会话不创建顶部标签');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-page=cc]').shadowRoot.querySelector('[part~=base]')).fontSize"),'14px');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-page=browser]').shadowRoot.querySelector('[part~=base]')).fontWeight"),'400','一级导航普通文字不加粗');
  const sessionCount=(await evaluate('window.workspace.state()')).aiSessions.length;
  await evaluate("document.querySelector('#contentTabs [data-tab-id=cc] .content-tab-close').click()");
  await until(()=>evaluate("document.querySelector('#contentTabs [data-tab-id=cc]')===null"));
  assert.equal((await evaluate('window.workspace.state()')).aiSessions.length,sessionCount,'关闭对话标签不删除二级会话');
  await evaluate("document.querySelector('[data-page=cc]').click()");
  assert.equal(await evaluate("document.querySelectorAll('#contentTabs [data-tab-id=cc]').length"),1,'重开对话复用原会话');
  await evaluate("document.querySelector('#contentTabs [data-tab-id=cc] .content-tab-pin').click()");
  assert.equal(await evaluate("document.querySelector('#contentTabs .content-tab').dataset.tabId"),'cc','固定对话标签靠左');
  assert.equal(await evaluate("document.querySelector('#contentTabs [data-tab-id=cc]').classList.contains('pinned') && !document.querySelector('#contentTabs [data-tab-id=cc] .content-tab-close')"),true,'固定标签不会误关闭');
  await evaluate("document.querySelector('#contentTabs [data-tab-id=cc] .content-tab-pin').click()");
  assert.equal(await evaluate("Boolean(document.querySelector('#contentTabs [data-tab-id=cc] .content-tab-close'))"),true,'取消固定恢复关闭按钮');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.sidebar')).borderRightWidth"),'0px','移除一级导航右侧竖线');
  const ccCount=(await evaluate('window.workspace.state()')).aiSessions.length;
  await evaluate("await (async()=>{document.getElementById('railNewSession').click();while(!document.getElementById('newSessionDialog').open)await new Promise(r=>setTimeout(r,20));})();document.getElementById('runtimeEngine').value='cc';await document.getElementById('runtimeEngine').updateComplete;document.getElementById('runtimeEngine').dispatchEvent(new Event('change'));document.getElementById('codexModelSelect').value='sonnet';document.getElementById('createNewSession').click()");
  await until(async()=> (await evaluate('window.workspace.state()')).aiSessions.length===ccCount+1 && await evaluate("!document.getElementById('newSessionDialog').open && !document.getElementById('createNewSession').disabled"));
  assert.equal((await evaluate('window.workspace.state()')).selectedEngine,'cc','运行时选择属于新会话');
  assert.equal((await evaluate('window.workspace.state()')).codexModel,'sonnet','Claude模型保存到会话');
  assert.equal(await evaluate("document.querySelector('#sessionList .session-row.active .session-title').textContent===document.getElementById('sessionTitle').textContent"),true,'主内容标题与当前会话一致');
  assert.equal(await evaluate("document.querySelector('#sessionList .session-row.active wa-icon').src.endsWith('claude-code.svg')"),true,'Claude运行时对应平台图标');
  await evaluate("await (async()=>{document.getElementById('railNewSession').click();while(!document.getElementById('newSessionDialog').open)await new Promise(r=>setTimeout(r,20));})();document.getElementById('runtimeEngine').value='codex';await document.getElementById('runtimeEngine').updateComplete;document.getElementById('runtimeEngine').dispatchEvent(new Event('change'));document.getElementById('codexModelSelect').value='gpt-5.5';document.getElementById('createNewSession').click()");
  await until(()=>evaluate("!document.getElementById('newSessionDialog').open && !document.getElementById('createNewSession').disabled"));
  await until(()=>evaluate("document.querySelector('#sessionList .session-row.active wa-icon').src.endsWith('codex.svg')"));
  assert.equal(await evaluate("document.querySelector('#sessionList .session-row.active wa-icon').src.endsWith('codex.svg')"),true,'Codex运行时对应平台图标');
  await evaluate("document.getElementById('sessionInfoTrigger').click()");
  await until(()=>evaluate("document.getElementById('sessionInfoMenu').open"));
  const currentInfo=await evaluate("({runtime:document.getElementById('infoRuntime').textContent,model:document.getElementById('infoModel').textContent,id:document.getElementById('infoSessionId').textContent,created:document.getElementById('infoCreatedAt').textContent})");
  assert.equal(currentInfo.runtime,'Codex');assert.ok(currentInfo.id);assert.notEqual(currentInfo.created,'未记录');
  const sessionInfoCapture=await captureUI();await writeFile('artifacts/session-info.png',Buffer.from(sessionInfoCapture.data,'base64'));
  await evaluate("document.getElementById('sessionInfoMenu').open=false");
  assert.equal(await evaluate("getComputedStyle(document.getElementById('prompt').shadowRoot.querySelector('[part~=textarea-wrapper]')).borderTopWidth"),'0px','输入框内部无边框');
  assert.equal(await evaluate("document.getElementById('pickProject').closest('#composeMenu')!==null"),true,'文件夹选择在输入框加号菜单');
  assert.ok(Number.parseFloat(await evaluate("getComputedStyle(document.querySelector('.sidebar>nav')).gap"))>=6,'一级导航合理间距');
  await evaluate("document.querySelector('[data-page=automation]').click()");
  assert.equal(await evaluate("document.getElementById('page-automation').classList.contains('hidden')"),false,'自动化导航可打开对应标签');
  assert.equal(await evaluate("document.querySelectorAll('.sidebar>nav .nav')[2].dataset.page"),'automation','自动化位于浏览器下方');
  await evaluate("document.querySelector('[data-page=cc]').click()");
  const archiveID=(await evaluate('window.workspace.state()')).activeAISessionId;
  await evaluate("(()=>{const b=document.createElement('div');b.className='bubble user';const text=document.createElement('span');text.textContent='private archive fixture';b.append(text);document.getElementById('chat').append(b);document.querySelector('#sessionList .session-row.active').closest('.session-row-container').querySelector('.session-archive').click()})()");
  await until(()=>accountChats.get('fixture-account-2')?.payload.sessions.find(item=>item.id===archiveID)?.archived===true);
  await until(()=>evaluate("document.getElementById('archiveCount').textContent==='1'"));
  assert.equal(await evaluate("document.getElementById('archiveToggle').getAttribute('aria-expanded')"),'false','归档默认折叠');
  assert.ok(accountChats.get('fixture-account-2').payload.views.some(view=>view.messages.some(message=>message.text==='private archive fixture')),'消息保存到当前用户后端');
  assert.equal(accountChats.get('fixture-account-1')?.payload?.views?.some(view=>view.messages.some(message=>message.text==='private archive fixture')) || false,false,'不同账号不共享消息');
  const beforeRestoreOrigin=await evaluate('performance.timeOrigin');await client.call('Page.reload');
  await until(()=>evaluate('performance.timeOrigin!=='+beforeRestoreOrigin+" && performance.getEntriesByName('chat-records-ready').length>0"));
  assert.equal(await evaluate("document.querySelector('.session-row.active').dataset.sessionId"),archiveID,'刷新恢复最后查看的对话');
  assert.equal(await evaluate("document.getElementById('archiveToggle').getAttribute('aria-expanded')"),'true','恢复归档对话时展开归档列表');
  assert.equal(await evaluate("document.querySelector('.session-row.active .session-title').textContent===document.getElementById('sessionTitle').textContent"),true,'恢复后左右对话标题一致');
  assert.equal(await evaluate("document.getElementById('chat').textContent.includes('private archive fixture')"),true,'恢复对应消息');

  await evaluate("document.querySelector('#archivedList .session-archive').click()");
  await until(()=>accountChats.get('fixture-account-2')?.payload.sessions.find(item=>item.id===archiveID)?.archived===false);
  assert.equal(await evaluate("getComputedStyle(document.getElementById('contentTabs')).webkitAppRegion"),'no-drag','拖拽区域不覆盖工具栏');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.window-tab-drag')).webkitAppRegion"),'drag','保留独立窗口拖拽空白区');
  const toolbarBefore=await evaluate("(()=>{const r=document.querySelector('.app-toolbar').getBoundingClientRect();return {x:r.x,y:r.y}})()");
  const collapsePoint=await evaluate("(()=>{const r=document.getElementById('toggleSidebar').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await client.call('Input.dispatchMouseEvent',{type,...collapsePoint,button:'left',clickCount:1});
  assert.equal(await evaluate("document.body.classList.contains('sidebar-collapsed') && getComputedStyle(document.querySelector('[data-page=cc] span')).display==='none'"),true,'收起一级导航保留图标');
  assert.equal(await evaluate("[...document.querySelectorAll('.primary-nav-tooltip')].every(tip=>!tip.disabled) && [...document.querySelectorAll('.primary-nav-tooltip')].find(tip=>tip.for==='primary-nav-cc').textContent==='对话'"),true,'收起后导航提示名称');
  await until(()=>evaluate("document.querySelector('.sidebar').getBoundingClientRect().width===45"));
  assert.equal(await evaluate("[...document.querySelectorAll('.sidebar nav>.nav')].every(el=>{const s=getComputedStyle(el.shadowRoot.querySelector('[part~=base]'));return s.width==='40px' && s.height==='40px'})"),true,'收起后的一级导航选中和悬停区域为正方形');
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await client.call('Input.dispatchMouseEvent',{type,...collapsePoint,button:'left',clickCount:1});
  assert.equal(await evaluate("!document.body.classList.contains('sidebar-collapsed')"),true,'鼠标点击展开成功');
  assert.deepEqual(await evaluate("(()=>{const r=document.querySelector('.app-toolbar').getBoundingClientRect();return {x:r.x,y:r.y}})()"),toolbarBefore,'收起后工具栏坐标保持');
  assert.equal(await evaluate("getComputedStyle(document.getElementById('appBack')).display!=='none' && getComputedStyle(document.getElementById('appForward')).display!=='none'"),true);
  assert.equal(await evaluate("document.getElementById('cancel')===null && document.querySelector('#send wa-icon').src.endsWith('arrow-up.svg')"),true,'输入框只保留统一发送停止按钮');
  assert.equal(await evaluate("document.getElementById('sessionPlatformIcon').querySelector('wa-icon').src.endsWith((document.getElementById('infoRuntime').textContent==='Codex'?'codex':'claude-code')+'.svg')"),true,'标题展示对应平台图标');
  assert.equal(await evaluate("[...document.querySelectorAll('app-button.icon-button,app-button.content-tab-pin,app-button.content-tab-close,app-button.composer-send')].filter(el=>el.getBoundingClientRect().width && getComputedStyle(el).display!=='none').every(el=>{const r=el.shadowRoot.querySelector('[part~=base]').getBoundingClientRect();return Math.abs(r.width-r.height)<1})"),true,'图标按钮都是正方形');
  const originalChatTab=await evaluate("document.querySelector('[data-tab-id=cc]').dataset.tabId");
  await evaluate("document.getElementById('newContentTab').click();document.getElementById('prompt').value='标签草稿'");
  const blankChatTab=await evaluate("document.querySelector('.content-tab.active').dataset.tabId");
  await evaluate("document.querySelector('[data-tab-id=cc] .content-tab-select').click()");
  await until(()=>evaluate("document.querySelector('.content-tab.active').dataset.tabId==='cc'"));
  await evaluate("document.querySelector('[data-tab-id=\"'+"+JSON.stringify(blankChatTab)+"+'\"] .content-tab-select').click()");
  await until(()=>evaluate("document.getElementById('prompt').value==='标签草稿'"));
  assert.equal(await evaluate("document.getElementById('page-cc').classList.contains('no-session')"),true,'空白标签独立于已有会话');
  const groupedCapture=await captureUI();await writeFile('artifacts/grouped-content-tabs.png',Buffer.from(groupedCapture.data,'base64'));
  await verifyContentTabMenu(blankChatTab);

  }
  await evaluate("document.querySelector('.sidebar .nav[data-page=environments]').click()");
  await until(()=>evaluate("document.querySelector('[data-environment-delete][aria-label=\"删除环境 本机环境\"]')!==null"));
  await evaluate("document.querySelector('[data-environment-delete][aria-label=\"删除环境 本机环境\"]').click()");
  assert.equal(await evaluate("document.getElementById('deleteEnvironmentDialog').open && document.getElementById('confirmDeleteEnvironment').disabled"),true,'本机环境删除也需要确认名称');
  await evaluate("document.getElementById('deleteEnvironmentName').value='本机环境';document.getElementById('deleteEnvironmentName').dispatchEvent(new Event('input'))");
  await until(()=>evaluate("!document.getElementById('confirmDeleteEnvironment').disabled"));
  await evaluate("document.getElementById('confirmDeleteEnvironment').click()");
  await until(()=>evaluate("document.body.classList.contains('environment-onboarding') && !document.getElementById('deleteEnvironmentDialog').open")).catch(async error=>{console.log('Deletion diagnostic',await evaluate("({error:document.getElementById('deleteEnvironmentError').textContent,classes:document.body.className,dialog:document.getElementById('deleteEnvironmentDialog').open})"));throw error;});
  assert.equal(await evaluate("window.workspace.dockerEnvironments('state').then(s=>!s.localEnabled && s.environments.length===0)"),true,'最后环境删除后真正为空');
  assert.equal(await evaluate("window.workspace.state().then(s=>s.aiSessions.length===0 && !s.runtimeRegistry && s.network.state==='blocked')"),true,'本机对话、检测与连接同步清理');
  assert.equal(await evaluate("window.workspace.runtimeInfo({detect:true}).then(()=>false,()=>true)"),true,'无环境不允许绕过引导检测');
  await client.call('Page.reload');
  await until(()=>evaluate("document.body.classList.contains('environment-onboarding')"));
  assert.ok(await evaluate("(()=>{const r=document.querySelector('.setup-main').getBoundingClientRect();return Math.abs(r.left+r.width/2-innerWidth/2)<1 && !document.querySelector('.setup-sidebar')})()"),'移除左侧栏且表单水平居中');
  await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});await pause(220);
  assert.equal(await evaluate("getComputedStyle(document.getElementById('setupAccountLogout').shadowRoot.querySelector('[part~=base]')).color"),'rgb(136, 139, 148)','退出登录默认灰色');
  const logoutPoint=await evaluate("(()=>{const r=document.getElementById('setupAccountLogout').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()");
  await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',...logoutPoint});await until(()=>evaluate("getComputedStyle(document.getElementById('setupAccountLogout').shadowRoot.querySelector('[part~=base]')).color==='rgb(0, 0, 0)'"));
  assert.equal(await evaluate("getComputedStyle(document.getElementById('setupAccountLogout').shadowRoot.querySelector('[part~=base]')).color"),'rgb(0, 0, 0)','退出登录悬停黑色');
  assert.equal(await evaluate("getComputedStyle(document.getElementById('setupAccountLogout').shadowRoot.querySelector('[part~=base]')).backgroundColor"),'rgba(0, 0, 0, 0)','退出登录悬停背景透明');
  await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.setup-window-drag')).webkitAppRegion"),'no-drag','引导顶部由指针会话控制窗口拖拽');
  await evaluate("document.getElementById('environmentSetup').scrollTop=0");
  await until(()=>evaluate("(()=>{const r=document.querySelector('.setup-window-drag').getBoundingClientRect(),m=document.querySelector('.setup-main').getBoundingClientRect();return r.left===0 && r.width===innerWidth && r.top===0 && Math.abs(r.bottom-m.top)<1})()"));
  assert.equal(await evaluate("getComputedStyle(document.getElementById('setupAccountLogout')).webkitAppRegion"),'no-drag','退出登录保持可点击');
  const repeatedDrag=await evaluate(`(async()=>{const api=window.workspace,origin=await api.windowDrag({phase:'start',x:500,y:400}),positions=[];await api.windowDrag({phase:'cancel'});for(let i=0;i<3;i++){const start=await api.windowDrag({phase:'start',x:500,y:400});await api.windowDrag({phase:'move',x:520,y:410});const end=await api.windowDrag({phase:'end',x:530,y:420});positions.push(end.x-start.x===30 && end.y-start.y===20)}await api.windowDrag({phase:'start',x:0,y:0});await api.windowDrag({phase:'end',x:-90,y:-60});return positions})()`);
  assert.ok(repeatedDrag.every(Boolean),'连续三次拖拽均更新实际窗口坐标');
  const normalBounds=await evaluate("window.workspace.windowDrag({phase:'state',x:0,y:0})");
  await evaluate("document.querySelector('.setup-window-drag').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
  await until(()=>evaluate('window.workspace.windowDrag({phase:"state",x:0,y:0}).then(b=>b.width>'+normalBounds.width+' || b.height>'+normalBounds.height+')'));
  await evaluate("document.querySelector('.setup-window-drag').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
  await until(()=>evaluate('window.workspace.windowDrag({phase:"state",x:0,y:0}).then(b=>b.width==='+normalBounds.width+' && b.height==='+normalBounds.height+')'));
  const dragOrigin=await evaluate("window.workspace.windowDrag({phase:'state',x:0,y:0})");
  for(let i=0;i<3;i++){
   const before=await evaluate("window.workspace.windowDrag({phase:'state',x:0,y:0})");
   await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:400,y:20});
   await client.call('Input.dispatchMouseEvent',{type:'mousePressed',x:400,y:20,button:'left',buttons:1,clickCount:1});
   await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:420,y:30,button:'left',buttons:1});
   await client.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:420,y:30,button:'left',buttons:0,clickCount:1});
   const after=await evaluate("window.workspace.windowDrag({phase:'state',x:0,y:0})");
   assert.ok(after.x>before.x && after.y>before.y,'连续指针拖拽 '+(i+1)+' 实际移动窗口');
  }
  const dragEnd=await evaluate("window.workspace.windowDrag({phase:'start',x:0,y:0})");
  await evaluate('window.workspace.windowDrag('+JSON.stringify({phase:'end',x:dragOrigin.x-dragEnd.x,y:dragOrigin.y-dragEnd.y})+')');


  assert.equal(await evaluate("getComputedStyle(document.getElementById('setupAccountLogout').shadowRoot.querySelector('[part~=base]')).backgroundColor"),'rgba(0, 0, 0, 0)','退出登录默认背景透明');
  assert.equal(await evaluate("document.getElementById('setupEnvironmentName').value"),'','环境名称默认留空');
  assert.equal(await evaluate("document.getElementById('setupCreate').disabled"),true,'未填环境名称时创建按钮禁用');
  assert.ok(await evaluate("document.getElementById('setupEnvironmentName').placeholder.includes('起个名字')"),'空名称显示填写提示');
  const requiredColor=await evaluate("(()=>{const input=document.getElementById('setupEnvironmentName'),label=input.shadowRoot.querySelector('[part~=form-control-label]'),probe=document.createElement('span');probe.style.color='var(--wa-color-danger-on-quiet)';document.body.append(probe);const result=getComputedStyle(label,'::after').color===getComputedStyle(probe).color;probe.remove();return result})()");
  assert.equal(requiredColor,true,'必填星号使用组件自带标记及红色主题变量');
  await evaluate("document.getElementById('setupEnvironmentName').value='自定义名称';document.getElementById('setupEnvironmentName').dispatchEvent(new Event('input',{bubbles:true}))");
  await client.call('Page.bringToFront');
  await client.call('Page.bringToFront');
  const fieldThemes=await evaluate(`(async()=>{const body=document.body,input=document.getElementById('setupEnvironmentName'),original=body.className,results=[];for(const dark of [false,true]){body.classList.toggle('dark',dark);body.classList.toggle('wa-dark',dark);body.classList.toggle('wa-light',!dark);input.focus();await new Promise(resolve=>setTimeout(resolve,250));const part=input.shadowRoot.querySelector('[part~=base]'),probe=document.createElement('span');probe.style.color='var(--accent)';body.append(probe);for(let i=0;i<40 && getComputedStyle(part).borderTopColor!==getComputedStyle(probe).color;i++)await new Promise(resolve=>setTimeout(resolve,50));results.push({dark,border:getComputedStyle(part).borderTopColor,expected:getComputedStyle(probe).color});probe.remove()}input.blur();body.className=original;return results})()`);
  assert.ok(fieldThemes.every(theme=>theme.border===theme.expected),'输入框聚焦边框跟随明暗主题，不再使用默认蓝色: '+JSON.stringify(fieldThemes));
  await client.call('Page.bringToFront');
  await evaluate("document.getElementById('setupTypeTrigger').click()");
  await until(()=>evaluate("document.getElementById('setupEnvironmentType').open"));await pause(250);
  await until(()=>evaluate("(()=>{const trigger=document.getElementById('setupTypeTrigger').getBoundingClientRect(),menu=document.getElementById('setupEnvironmentType').shadowRoot.querySelector('[part=menu]').getBoundingClientRect();return Math.abs(trigger.width-menu.width)<1})()"));
  await client.call('Page.bringToFront');
  const setupOptionPoint=await evaluate("(()=>{const r=document.querySelector('[data-setup-type=docker]').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()");
  await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',...setupOptionPoint});await pause(100);
  await until(()=>evaluate("getComputedStyle(document.querySelector('[data-setup-type=local]')).backgroundColor==='rgba(0, 0, 0, 0)'"));
  assert.ok(await evaluate("(()=>{const input=document.querySelector('.setup-name-field').getBoundingClientRect(),button=document.getElementById('setupCreate').shadowRoot.querySelector('[part~=base]').getBoundingClientRect(),main=document.querySelector('.setup-main').getBoundingClientRect();return Math.abs(input.left-button.left)<1 && Math.abs(input.width-button.width)<1 && Math.abs(main.bottom-parseFloat(getComputedStyle(document.querySelector('.setup-main')).borderBottomWidth)-30-button.bottom)<1})()"),'创建按钮底部对齐且与表单等宽');
  const setupMenuCapture=await captureUI();await writeFile('artifacts/environment-type-menu.png',Buffer.from(setupMenuCapture.data,'base64'));
  assert.equal(await evaluate("(()=>{document.querySelector('[data-setup-type=docker]').click();return document.getElementById('setupDockerEngine').textContent==='检测中…' && document.getElementById('setupDockerStatus').textContent.includes('正在检测')})()"),true,'选择Docker立即自动检测，无需点击检测按钮');
  assert.equal(await evaluate("document.getElementById('setupTypeName').textContent"),'Docker 容器');
  assert.equal(await evaluate("document.getElementById('setupTypeSubtitle').textContent===document.querySelector('[data-setup-type=docker] small').textContent"),true,'选中Docker后触发框副标题同步');
  assert.equal(await evaluate("document.getElementById('setupEnvironmentName').value"),'自定义名称','切换类型保留已填写名称');
  assert.equal(await evaluate("document.getElementById('setupDockerPanel').classList.contains('hidden')"),false,'选择Docker显示容器检测配置区');
  await until(()=>evaluate("document.getElementById('setupDockerEngine').textContent!=='检测中…'"));
  assert.equal(await evaluate("document.getElementById('setupCreate').disabled && document.getElementById('setupDockerImage').textContent==='待选择'"),true,'Docker引擎和镜像就绪后才允许创建');
  assert.ok(await evaluate("document.getElementById('setupDockerImage').classList.contains('is-pending') && getComputedStyle(document.getElementById('setupDockerImage'),'::before').backgroundColor==='rgb(215, 165, 44)'"),'待选择显示黄色状态圆点');
  assert.equal(await evaluate("document.querySelectorAll('#setupCheckDocker,#setupPreviewRuntimes').length"),0,'引导移除两个重新检测按钮');
  assert.equal(await evaluate("document.getElementById('setupRuntimePreviewStatus').textContent"),'新容器不预装大模型，环境创建后，请前往「运行时」配置。');
  const prepareWasHidden=await evaluate("document.getElementById('setupPrepareDocker').classList.contains('hidden')");
  await evaluate("document.getElementById('setupPrepareDocker').classList.remove('hidden')");
  assert.ok(await evaluate("(()=>{const heading=document.querySelector('#setupDockerPanel .setup-docker-heading'),title=heading.querySelector('strong').getBoundingClientRect(),button=document.getElementById('setupPrepareDocker').getBoundingClientRect();const version=document.getElementById('setupImageVersion').getBoundingClientRect(),source=document.getElementById('setupImageSource').getBoundingClientRect();return version.top>=title.bottom && source.left>version.left && button.left>source.left && Math.abs(version.bottom-button.bottom)<1})()"),'镜像配置横向展示在新建容器标题下方');
  assert.ok(await evaluate("(()=>{const items=Array.from(document.querySelectorAll('#setupDockerSource wa-radio'));return items.every(item=>{const control=item.shadowRoot.querySelector('[part~=control]').getBoundingClientRect(),label=item.shadowRoot.querySelector('[part~=label]').getBoundingClientRect();return Math.abs(control.top+control.height/2-label.top-label.height/2)<1})})()"),'单选圆点与文字水平居中');
  if(prepareWasHidden)await evaluate("document.getElementById('setupPrepareDocker').classList.add('hidden')");
  assert.ok(await evaluate("(()=>{const a=document.getElementById('setupPrepareDocker').getBoundingClientRect(),b=document.getElementById('setupRandomName').getBoundingClientRect();return Math.abs(a.width-b.width)<1 && Math.abs(a.height-b.height)<1 && Math.abs(a.right-b.right)<1})()"),'配置和随机按钮尺寸及右侧对齐');
  assert.equal(await evaluate("document.querySelector('#setupPrepareDocker wa-icon').getAttribute('src')"),'assets/icons/check.svg');
  await evaluate("document.getElementById('setupPrepareDocker').click()");
  assert.equal(await evaluate("document.querySelectorAll('#setupImageVersion wa-option').length"),2,'配置菜单提供两个镜像版本');
  await evaluate("document.getElementById('setupImageVersion').value='22-bookworm-slim';document.getElementById('setupImageSource').value='custom';document.getElementById('setupImageSource').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('setupImageRepository').value='https://bad.example/node';document.getElementById('setupImageRepository').dispatchEvent(new Event('input',{bubbles:true}))");
  await until(()=>evaluate("!document.getElementById('setupPrepareDocker').disabled"));
  await evaluate("document.getElementById('setupPrepareDocker').click()");
  assert.ok(await evaluate("document.getElementById('setupImageError').textContent.includes('仓库路径')"),'无效仓库配置不启动下载');
  const configMenuCapture=await captureUI();await writeFile('artifacts/environment-image-menu.png',Buffer.from(configMenuCapture.data,'base64'));
  await evaluate("document.getElementById('setupImageSource').value='official';document.getElementById('setupImageSource').dispatchEvent(new Event('change',{bubbles:true}))");
  await until(()=>evaluate("!document.getElementById('setupPrepareDocker').disabled"));
  await evaluate("document.getElementById('setupPrepareDocker').click()");
  await until(()=>evaluate("document.getElementById('setupPrepareDocker').loading"));
  assert.ok(await evaluate("!document.getElementById('setupDownload').classList.contains('hidden') && document.getElementById('setupPrepareDocker').disabled"),'真实配置显示下载进度条及按钮加载态并禁止重复点击');
  const progressCapture=await captureUI();await writeFile('artifacts/environment-download-progress.png',Buffer.from(progressCapture.data,'base64'));
  await until(()=>evaluate("!document.getElementById('setupPrepareDocker').loading"),180000);
  assert.ok(await evaluate("document.getElementById('setupDockerEngine').classList.contains('is-ready') && document.getElementById('setupDockerImage').classList.contains('is-ready')"),'配置完成后引擎和镜像显示绿色就绪圆点');

  const dockerSetupCapture=await captureUI();await writeFile('artifacts/environment-docker-setup.png',Buffer.from(dockerSetupCapture.data,'base64'));
  if(await evaluate("window.workspace.dockerEnvironments('state').then(s=>s.engine.ready && s.engine.image)")){
   assert.equal(await evaluate("document.getElementById('setupCreate').textContent"),'创建「自定义名称」环境');
   const creatingHint=await evaluate("(async()=>{await document.getElementById('setupCreate').updateComplete;document.getElementById('setupCreate').click();return document.getElementById('setupCreatingStatus').textContent})()");
   assert.equal(creatingHint,'正在创建「自定义名称」','按钮上方显示正在创建的环境名称');
   await until(()=>evaluate("!document.body.classList.contains('environment-onboarding') && !document.getElementById('page-runtime').classList.contains('hidden')"),30000);
   assert.ok(await evaluate("window.workspace.dockerEnvironments('state').then(s=>s.environments.length===1 && s.environments[0].running && s.activeId===s.environments[0].id)"),'引导直接新建并启动独立容器');
   consoleFixtureEnvironments.push(await evaluate("window.workspace.dockerEnvironments('state').then(s=>({id:s.environments[0].id,name:s.environments[0].name}))"));
   assert.ok(await evaluate("document.getElementById('environmentCreatedDialog').open && document.getElementById('environmentCreatedTitle').textContent.includes('自定义名称')"),'创建后显示带环境名的成功弹窗');
   const createdCapture=await captureUI();await writeFile('artifacts/environment-created.png',Buffer.from(createdCapture.data,'base64'));
   await evaluate("document.getElementById('environmentCreatedDismiss').click()");

   await until(()=>evaluate("document.getElementById('configuredRuntimeStatus').textContent.includes('暂无')"));
   assert.equal(await evaluate("document.querySelectorAll('#configuredRuntimeList tbody tr:not(:has(.app-table-empty))').length"),0,'新建空白容器没有运行时');
   assert.ok(await evaluate("!document.getElementById('openRuntimeInstall').classList.contains('hidden')"),'空白容器可在运行时页安装运行时');
   assert.equal(await evaluate("window.workspace.dockerEnvironments('installRuntime',{engine:'codex',name:''}).then(()=>false,error=>error.message.includes('名称'))"),true,'未连接代理时安装进入参数校验，无需代理门槛');
   assert.ok(await evaluate("document.querySelector('.runtime-toolbar-actions #openRuntimeInstall') && !document.getElementById('configureInstallClaude') && !document.querySelector('[data-setting=containers]') && document.querySelector('[data-setting=environment]').textContent.includes('本地系统')"),'安装入口集中运行时，设置仅保留设备本地系统');
   assert.ok(await evaluate("document.querySelector('#runtimeEmptyState>wa-icon') && !document.getElementById('runtimeEmptyState').classList.contains('hidden') && !document.querySelector('#runtimeEmptyState app-button')"),'运行时空状态保留图标和描述，移除重复按钮');
   assert.ok(await evaluate("document.getElementById('openRuntimeInstall').getBoundingClientRect().width<=112 && document.getElementById('refreshRuntimes').getBoundingClientRect().width<=96"),'右上角按钮收紧宽度: '+await evaluate("JSON.stringify(['openRuntimeInstall','refreshRuntimes'].map(id=>{const b=document.getElementById(id);return{id,width:b.getBoundingClientRect().width,style:getComputedStyle(b.shadowRoot.querySelector('[part~=base]')).cssText,label:getComputedStyle(b.shadowRoot.querySelector('[part~=label]')).fontSize}}))"));
   assert.ok(await evaluate("(()=>{const body=document.querySelector('.runtime-management').getBoundingClientRect(),parts=[...document.querySelector('#runtimeEmptyState').children].map(el=>el.getBoundingClientRect()),left=Math.min(...parts.map(r=>r.left)),right=Math.max(...parts.map(r=>r.right)),top=Math.min(...parts.map(r=>r.top)),bottom=Math.max(...parts.map(r=>r.bottom));return Math.abs((left+right)/2-(body.left+body.right)/2)<2 && Math.abs((top+bottom)/2-(body.top+body.bottom)/2)<2;})()"),'运行时空状态内容在标题下的可用空间上下左右居中');
   assert.ok(await evaluate("[...document.querySelectorAll('.content-page-header')].every(header=>!!header.querySelector('wa-icon:not(app-button wa-icon)')) && !document.querySelector('.session-heading>wa-icon')"),'主内容标题统一图标，对话会话标题保持独立');
   const emptyCapture=await captureUI();await writeFile('artifacts/runtime-centered-empty.png',Buffer.from(emptyCapture.data,'base64'));
   await evaluate("document.getElementById('openRuntimeInstall').click()");
   assert.ok(await evaluate("document.getElementById('runtimeInstallDialog').open && document.getElementById('runtimeInstallDialog').label==='添加运行时' && document.querySelectorAll('[data-runtime-choice]').length===3 && !document.getElementById('runtimeSelectStep').classList.contains('hidden')"),'添加运行时第一步展示基础运行时卡片');
   assert.ok(await evaluate("(()=>{const card=document.querySelector('[data-runtime-choice=cc]'),base=card.shadowRoot.querySelector('[part~=base]'),close=document.querySelector('#runtimeInstallClose wa-icon');return base.getBoundingClientRect().height<=45 && getComputedStyle(base).backgroundColor!==getComputedStyle(document.getElementById('runtimeInstallDialog').shadowRoot.querySelector('[part=dialog]')).backgroundColor && close.getBoundingClientRect().width===20 && getComputedStyle(card.querySelector('wa-icon')).color==='rgb(217, 119, 87)';})()"),'运行时卡片紧凑、背景有区分、保留品牌色和20px关闭图标');
   const choicesCapture=await captureUI();await writeFile('artifacts/runtime-add-choices.png',Buffer.from(choicesCapture.data,'base64'));
   await evaluate("document.querySelector('[data-runtime-choice=cc]').click()");
   assert.ok(await evaluate("document.getElementById('runtimeInstallStep').textContent==='第 2 / 2 步' && document.getElementById('runtimeDefaultCommand').textContent==='curl -fsSL https://claude.ai/install.sh | bash' && document.getElementById('runtimeDefaultCommand').tagName==='CODE' && document.getElementById('runtimeDisplayName').value==='Claude Code' && !document.getElementById('runtimeInstallConfirm').disabled"),'第二步官方安装命令只读，未连接代理也可安装');
   const commandCapture=await captureUI();await writeFile('artifacts/runtime-add-configuration.png',Buffer.from(commandCapture.data,'base64'));
   await evaluate("document.getElementById('runtimeInstallBack').click();document.querySelector('[data-runtime-choice=codex]').click()");
   assert.equal(await evaluate("document.getElementById('runtimeDefaultCommand').textContent"),'npm install -g @openai/codex');
   await evaluate("document.getElementById('runtimeInstallBack').click();document.querySelector('[data-runtime-choice=deepseek]').click()");
   assert.ok(await evaluate("!document.getElementById('deepseekApiKey').classList.contains('hidden') && document.getElementById('deepseekApiKey').type==='password' && document.getElementById('runtimeDefaultCommand').textContent==='https://api.deepseek.com'"),'DeepSeek使用API Key接入，地址只读');
   const installCapture=await captureUI();await writeFile('artifacts/runtime-install-dialog.png',Buffer.from(installCapture.data,'base64'));
   await evaluate("document.getElementById('runtimeInstallCancel').click()");
   await evaluate("document.getElementById('accountSettings').click();document.querySelector('[data-setting=proxy]').click()");
   await pause(150);
   assert.ok(await evaluate("!document.getElementById('importClipboard') && !!document.getElementById('importFile').querySelector('wa-icon') && !!document.getElementById('proxyStorageScope').closest('h2') && !document.querySelector('.config-card h2') && document.getElementById('proxyStorageScope').textContent==='账号 · 当前环境'"),'代理导入合并、标题移到卡片外并标明保存范围');
   const proxyLeft=await evaluate("document.querySelector('.proxy-config-section').getBoundingClientRect().left");
   const proxySettingsCapture=await captureUI();await writeFile('artifacts/proxy-settings.png',Buffer.from(proxySettingsCapture.data,'base64'));
   await evaluate("window.workspace.disconnect()");
   await until(()=>evaluate("window.workspace.connectionRecords().then(records=>records.length>0)"));
   await evaluate("document.querySelector('[data-setting=activity]').click()");
   await until(()=>evaluate("document.querySelectorAll('#activity tbody tr:not(:has(.app-table-empty))').length>0"));
   assert.ok(await evaluate("(()=>{const r=document.getElementById('activity').getBoundingClientRect();return Math.abs(r.left-"+proxyLeft+")<1 && !document.querySelector('[data-panel=activity]').textContent.includes('不记录密码与网页正文');})()"),'连接记录和代理配置左右间距一致：'+await evaluate("JSON.stringify({activity:document.getElementById('activity').getBoundingClientRect().toJSON(),body:document.querySelector('.settings-body').getBoundingClientRect().toJSON(),card:document.querySelector('[data-panel=activity]').getBoundingClientRect().toJSON()})")+' proxyLeft='+proxyLeft);
   const recordsCapture=await captureUI();await writeFile('artifacts/connection-records.png',Buffer.from(recordsCapture.data,'base64'));
   await evaluate("document.querySelector('nav [data-page=runtime]').click()");
   const configCapture=await captureUI();await writeFile('artifacts/environment-configuration.png',Buffer.from(configCapture.data,'base64'));
   await evaluate("document.querySelector('nav [data-page=environments]').click()");
   await until(()=>evaluate("document.querySelector('[data-environment-id] .environment-inline-facts')!==null"));
   assert.ok(await evaluate("document.querySelector('[data-environment-id]').textContent.includes('独立容器数据卷') && document.querySelector('[data-environment-id]').textContent.includes('尚未配置运行时') && document.getElementById('environmentDetail')===null"),'Docker详情和操作直接显示在环境列表');
   assert.ok(await evaluate("!document.getElementById('dockerEngineTitle') && !Array.from(document.querySelectorAll('#environmentList app-button')).some(b=>/^(停止|启动|切换|登录 Claude|登录 Codex)$/.test(b.textContent)) && document.querySelector('[data-environment-id]').textContent.includes('容器镜像') && document.querySelector('[data-environment-id]').textContent.includes('容器 ID')"),'环境显示容器身份与镜像，移除生命周期和登录按钮及引擎卡');
   assert.ok(await evaluate("!document.querySelector('#environmentList [data-environment-delete]') && document.querySelector('.environment-page-actions #environmentDeleteMenu') && document.getElementById('newEnvironment').querySelector('wa-icon') && !!document.getElementById('deleteEnvironmentMenuTrigger').querySelector('wa-icon')"),'删除入口和创建环境同属右上角操作组');
   assert.ok(await evaluate("(()=>{const create=document.getElementById('newEnvironment').getBoundingClientRect(),remove=document.getElementById('deleteEnvironmentMenuTrigger'),r=remove.getBoundingClientRect();return create.right<=r.left && getComputedStyle(remove.shadowRoot.querySelector('[part~=base]')).color==='rgb(220, 38, 38)';})()"),'删除环境位于创建环境右侧，并显示红色图标文案');

   const overviewCapture=await captureUI();await writeFile('artifacts/environment-inline-overview.png',Buffer.from(overviewCapture.data,'base64'));

   assert.ok(await evaluate("(()=>{const nav=Array.from(document.querySelectorAll('nav .nav'));return nav.findIndex(n=>n.dataset.page==='console')+1===nav.findIndex(n=>n.dataset.page==='runtime')})()"),'控制台紧邻运行时上方');
   await evaluate("window.__terminalOutput='';window.__terminalToken=null;window.workspace.onEvent(e=>{if(e.type==='console' && e.data.type==='data'){window.__terminalOutput+=e.data.text;window.__terminalToken=e.data.token;}});document.querySelector('nav [data-page=console]').click()");
   await until(()=>evaluate("!!window.__terminalToken && document.getElementById('consoleConnect').textContent==='重新连接'"));
   const terminalInput=data=>evaluate('window.workspace.console("input",{token:window.__terminalToken,data:'+JSON.stringify(data)+'})');
   await terminalInput('printf "CONSOLE_UI_PROOF\\n"; test -t 0 && echo INTERACTIVE_TTY; id -u\r');
   await until(()=>evaluate('window.__terminalOutput.includes('+JSON.stringify('INTERACTIVE_TTY\r\n1000')+')'));

   await until(()=>evaluate("document.querySelector('.xterm-screen').textContent.includes('CONSOLE_UI_PROOF')"));
   assert.ok(await evaluate("Array.from(document.querySelectorAll('#containerTerminal style')).every(s=>s.nonce==='dingtu-terminal-style')"),'终端动态样式受CSP nonce约束');
   assert.ok(await evaluate("(()=>{const header=document.querySelector('.console-header').getBoundingClientRect(),page=document.getElementById('page-console').getBoundingClientRect();return Math.abs(header.top-page.top)<1 && Math.abs(header.height-49)<1 && getComputedStyle(document.querySelector('.console-header h1')).fontSize==='16px' && !document.querySelector('.console-header #consoleEnvironment')})()"),'控制台复用主内容49px标题行，说明位于正文');
   assert.ok(await evaluate("(()=>{const terminal=document.getElementById('containerTerminal').getBoundingClientRect(),body=document.querySelector('.console-body').getBoundingClientRect();return Math.abs(terminal.x-body.x)<1 && Math.abs(terminal.y-body.y)<1 && Math.abs(terminal.width-body.width)<1 && Math.abs(terminal.height-body.height)<1 && !document.querySelector('.console-hint') && !!document.getElementById('consoleConnect').querySelector('wa-icon')})()"),'终端无外侧留白且移除底部提示，连接状态变化后图标保留');
   assert.ok(await evaluate("Array.from(document.querySelectorAll('.content-page-header app-button')).every(button=>button.querySelector('wa-icon'))"),'全部主内容标题操作按钮都有图标');
   const terminalCapture=await captureUI();await writeFile('artifacts/container-console.png',Buffer.from(terminalCapture.data,'base64'));
   await terminalInput('sleep 100\r');
   await pause(200);await terminalInput('\u0003printf "INTERRUPT_OK\\n"\r');
   await until(()=>evaluate('window.__terminalOutput.includes('+JSON.stringify('INTERRUPT_OK\r\n')+')'));


   await evaluate("(async()=>{const s=await window.workspace.dockerEnvironments('state');const item=s.environments[0];await window.workspace.dockerEnvironments('delete',{id:item.id,name:item.name})})()");
   assert.equal(await evaluate("window.workspace.console('input',{token:window.__terminalToken,data:'OLD'}).then(()=>false,()=>true)"),true,'删除当前环境后旧终端不可输入');
   await client.call('Page.reload');await until(()=>evaluate("document.body.classList.contains('environment-onboarding')"));
  }



  if(process.env.WORKSPACE_TEST_SETUP_ONLY){
   externalUITestManager=new DockerEnvironments({sourceRoot:process.cwd()});
   const sourceName='existing-ui-fixture-'+Date.now();externalUITestSource=await externalUITestManager.command(['run','-d','--name',sourceName,'--network','none','--entrypoint','sleep','dingtu-runtime:1','infinity']);
   await evaluate("document.getElementById('setupEnvironmentName').value='接入已有容器';document.getElementById('setupEnvironmentName').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-setup-type=docker]').click();document.getElementById('setupDockerSource').value='existing';document.getElementById('setupDockerSource').dispatchEvent(new Event('change',{bubbles:true}))");
   await until(()=>evaluate(`Array.from(document.querySelectorAll('#setupExistingContainer wa-option')).some(item=>item.textContent.includes(${JSON.stringify(sourceName)}))`),20000);
   assert.ok(await evaluate("(()=>{const select=document.getElementById('setupExistingContainer').getBoundingClientRect(),button=document.getElementById('setupRefreshExisting').getBoundingClientRect(),random=document.getElementById('setupRandomName').getBoundingClientRect();return button.left>select.right && Math.abs(button.bottom-select.bottom)<1 && Math.abs(button.width-random.width)<1 && Math.abs(button.right-random.right)<1})()"),'刷新按钮位于选择器右侧，与随机按钮对齐');

   await evaluate(`(()=>{const select=document.getElementById('setupExistingContainer');select.value=Array.from(select.querySelectorAll('wa-option')).find(item=>item.textContent.includes(${JSON.stringify(sourceName)})).value;select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
   await until(()=>evaluate("document.getElementById('setupRuntimePreviewList').children.length===2"));
   const existingCapture=await captureUI();await writeFile('artifacts/environment-existing-container.png',Buffer.from(existingCapture.data,'base64'));
   await evaluate("(async()=>{await document.getElementById('setupCreate').updateComplete;document.getElementById('setupCreate').click()})()");
   await until(()=>evaluate("!document.body.classList.contains('environment-onboarding') && document.querySelectorAll('#configuredRuntimeList tbody tr:not(:has(.app-table-empty))').length===2"),30000);
   assert.ok(await evaluate("document.getElementById('openRuntimeInstall').classList.contains('hidden')"),'检测到运行时后隐藏安装按钮');
   assert.equal(await evaluate("document.querySelectorAll('#page-runtime [data-runtime-login]').length"),2,'已安装运行时的登录按钮位于运行时页面');
   await evaluate("document.getElementById('environmentCreatedDismiss').click()");

   await evaluate("(async()=>{const s=await window.workspace.dockerEnvironments('state');const item=s.environments.find(item=>item.external);await window.workspace.dockerEnvironments('delete',{id:item.id,name:item.name})})()");
   assert.equal(await externalUITestManager.command(['inspect','--format','{{.State.Running}}',externalUITestSource]),'true','移除应用关联不删除或停止原容器');
   await externalUITestManager.command(['rm','-f',externalUITestSource]);externalUITestSource=null;
   await client.call('Page.reload');await until(()=>evaluate("document.body.classList.contains('environment-onboarding')"));
  }
  await pause(250);await evaluate("document.getElementById('setupTypeTrigger').click()");await until(()=>evaluate("document.getElementById('setupEnvironmentType').open"));
  await evaluate("document.querySelector('[data-setup-type=local]').click()");await pause(250);
  assert.equal(await evaluate("document.getElementById('setupTypeName').textContent"),'本机环境');
  assert.equal(await evaluate("document.getElementById('setupDockerPanel').classList.contains('hidden')"),true,'本机环境隐藏Docker专属配置');
  assert.equal(await evaluate("document.getElementById('setupTypeSubtitle').textContent===document.querySelector('[data-setup-type=local] small').textContent"),true,'切回本机后触发框副标题同步');
  assert.ok(await evaluate("document.querySelector('.setup-name-field').getBoundingClientRect().top<document.querySelector('.setup-type-field').getBoundingClientRect().top"),'环境名称位于环境类型之前');
  const randomNames=await evaluate("(()=>{const names=[];for(let i=0;i<30;i++){document.getElementById('setupRandomName').click();names.push(document.getElementById('setupEnvironmentName').value)}return names})()");
  assert.ok(randomNames.every((name,i)=>name.length>0 && (i===0||name!==randomNames[i-1])) && new Set(randomNames).size>1,'随机名称可用且连续点击不重复');
  for(const name of ['', '   ', 'x'.repeat(41)]){
   await evaluate(`document.getElementById('setupEnvironmentName').value=${JSON.stringify(name)};document.getElementById('setupEnvironmentName').dispatchEvent(new Event('input',{bubbles:true}))`);
   assert.equal(await evaluate("document.getElementById('setupCreate').disabled"),true,'环境名称未通过必填/长度校验时创建按钮禁用');
  }
  await evaluate("document.getElementById('setupEnvironmentName').value='本机环境';document.getElementById('setupEnvironmentName').dispatchEvent(new Event('input',{bubbles:true}))");
  assert.equal(await evaluate("document.getElementById('setupCreate').disabled"),false,'有效环境名称恢复创建按钮');
  assert.equal(await evaluate("getComputedStyle(document.getElementById('setupCreate').shadowRoot.querySelector('[part~=base]')).backgroundColor"),'rgb(32, 33, 39)','创建环境使用项目黑色主按钮');
  assert.ok(await evaluate("(()=>{const base=document.getElementById('setupTypeTrigger').shadowRoot.querySelector('[part~=base]').getBoundingClientRect(),sub=document.getElementById('setupTypeSubtitle').getBoundingClientRect();return sub.top>=base.top+4 && sub.bottom<=base.bottom-4})()"),'选中副标题完整包含于触发框内');
  const setupCapture=await captureUI();await writeFile('artifacts/environment-setup-fixture.png',Buffer.from(setupCapture.data,'base64'));
  await evaluate("document.getElementById('setupEnvironmentName').value='重新创建的本机';document.getElementById('setupCreate').click()");
  await until(()=>evaluate("!document.getElementById('setupDetectView').classList.contains('hidden') && !document.getElementById('setupCreate').disabled"));
  assert.ok(await evaluate("document.getElementById('environmentCreatedDialog').open"),'本机环境创建后也显示成功弹窗');
  await evaluate("document.getElementById('environmentCreatedDismiss').click()");
  assert.equal(await evaluate("document.getElementById('setupFinish').disabled"),true,'创建后仍需手动检测');
  await evaluate("document.getElementById('setupDetect').click()");
  await until(()=>evaluate("!document.getElementById('setupFinish').disabled"));
  assert.ok(await evaluate("document.querySelectorAll('#setupRuntimeResults>p').length>0"),'检测结果在引导内展示');
  await evaluate("document.getElementById('setupFinish').click()");
  await until(()=>evaluate("!document.body.classList.contains('environment-onboarding')"));
  assert.equal(await evaluate("document.getElementById('environmentName').textContent"),'重新创建的本机');
  await evaluate("document.querySelector('.nav[data-page=environments]').click();document.getElementById('newEnvironment').click()");
  await until(()=>evaluate("document.body.classList.contains('environment-onboarding') && !document.getElementById('setupCancel').classList.contains('hidden')"));
  assert.ok(await evaluate("document.getElementById('setupEnvironmentName').value==='' && !document.getElementById('setupImageVersion').value && !document.getElementById('setupImageSource').value && document.getElementById('setupCreate').disabled"),'环境页创建进入同一全页表单，新建会话不沿用镜像选择');
  await evaluate("document.getElementById('setupEnvironmentName').value='下一次环境';document.getElementById('setupEnvironmentName').dispatchEvent(new Event('input',{bubbles:true}))");
  assert.equal(await evaluate("document.getElementById('setupCreate').disabled"),true,'已有缓存也必须为本次创建重新确认镜像');
  await evaluate("document.getElementById('setupDockerSource').value='existing';document.getElementById('setupDockerSource').dispatchEvent(new Event('change',{bubbles:true}))");
  await until(()=>evaluate("!document.getElementById('setupRefreshExisting').loading"));
  assert.ok(await evaluate("document.querySelector('.setup-existing-picker').classList.contains('hidden') && document.getElementById('setupExistingStatus').textContent.includes('暂无可接入')"),'无容器时隐藏选择器和刷新按钮，显示合并空状态');
  await evaluate("window.galaxySample=document.getElementById('setupGalaxyCanvas').toDataURL()");await pause(250);
  assert.ok(await evaluate("window.galaxySample!==document.getElementById('setupGalaxyCanvas').toDataURL()"),'银河系粒子纹理持续运动');
  await evaluate("delete window.galaxySample");
  const emptyCapture=await captureUI();await writeFile('artifacts/environment-no-containers.png',Buffer.from(emptyCapture.data,'base64'));
  await evaluate("document.getElementById('setupCancel').click()");
  await until(()=>evaluate("!document.body.classList.contains('environment-onboarding')"));

  console.log(process.env.WORKSPACE_TEST_SETUP_ONLY?'环境引导验收通过：删除最后环境、刷新持久化、重新创建、检测运行时和进入应用。':'桌面验收通过：弹窗POST和opener回调、自动关闭清理与后续导航、地址栏搜索与标签建议、编辑不被加载覆盖、新标签自动访问、导航中止后重定向渲染、多标签新建切换关闭、IPRoyal CSV/TXT 导入、多条选择、凭据遮蔽、导入不自动联网、重新导入断开旧连接，以及浏览器代理与断开锁定。未调用真实账号或模型。');
  if (/UnhandledPromiseRejection|uncaughtException/.test(stderr)) throw new Error('桌面运行存在错误：\n' + stderr);
  }
  }
} finally {
  for(const item of consoleFixtureEnvironments)if(client)await evaluate('window.workspace.dockerEnvironments("delete",'+JSON.stringify(item)+')').catch(()=>{});
  if(externalUITestSource)await externalUITestManager.command(['rm','-f',externalUITestSource]).catch(()=>{});
  accountFixture.close();
  stun.close(); client?.close(); child?.kill('SIGTERM');
  if (child && child.exitCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(3000)]);
  for (const socket of sockets) socket.destroy();
  target.closeAllConnections(); await new Promise(resolve => target.close(resolve)); await new Promise(resolve=>accountFixture.close(resolve));await new Promise(resolve => proxy.close(resolve));
  await rm(temp, { recursive: true, force: true, maxRetries:5, retryDelay:100 });
}
