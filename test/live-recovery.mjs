// Explicit acceptance runner: uses the user's existing export only in memory.
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { parseIproyalExport } from '../src/iproyal-import.mjs';
const exported = process.argv[2];
if (!exported) throw new Error('请提供现有 IPRoyal TXT 导出文件路径');
const config = parseIproyalExport(await readFile(exported, 'utf8')).entries[0];
const sockets = new Set(); let offline = false, outbound = 0, child, client;
const relay = net.createServer(socket => {
  if (offline) { socket.destroy(); return; }
  outbound++;
  const upstream = net.connect(config.port, config.host);
  for (const stream of [socket, upstream]) { sockets.add(stream); stream.on('error', () => {}); stream.once('close', () => { sockets.delete(stream); socket.destroy(); upstream.destroy(); }); }
  socket.pipe(upstream); upstream.pipe(socket);
});
await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
const temp = await mkdtemp(path.join(tmpdir(), 'fixed-egress-live-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 60000) { const end = Date.now()+timeout; while(Date.now()<end) { try { const result=await fn(); if(result) return result; } catch {} await pause(150); } throw new Error('真实网络验收超时'); }
async function cdp(url) {
  const ws = new WebSocket(url), pending = new Map(); let id = 0;
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const p=pending.get(data.id);pending.delete(data.id);data.error?p?.reject(new Error('CDP执行失败')):p?.resolve(data.result);}});
  return {close:()=>ws.close(), call(method,params={}){return new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));});}};
}
let debugPort;
async function evaluate(expression) { const r=await client.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); if(r.exceptionDetails) throw new Error('应用验收操作失败'); return r.result.value; }
async function boot() {
  const port=net.createServer();await new Promise(resolve=>port.listen(0,'127.0.0.1',resolve)); debugPort=port.address().port;await new Promise(resolve=>port.close(resolve));
  child=spawn(electron,['.',`--remote-debugging-port=${debugPort}`,'--test-fixture',...(process.platform==='darwin'?['-AppleLanguages','(en-US)']:[])],{cwd:process.cwd(),env:{...process.env,WORKSPACE_TEST_ENV:JSON.stringify({timeZone:'America/New_York',languages:['en-US']}),WORKSPACE_TEST_DATA_DIR:temp},stdio:'ignore'});
  const page=await until(async()=> (await fetch(`http://127.0.0.1:${debugPort}/json`).then(r=>r.json())).find(p=>p.url.includes('src/index.html')));
  client=await cdp(page.webSocketDebuggerUrl);
  await until(() => evaluate("Boolean(window.workspace && typeof window.workspace.connect === 'function' && document.getElementById('connect'))"));
  const localConfig={...config,host:'127.0.0.1',port:relay.address().port};
  const result=await evaluate(`window.workspace.connect(${JSON.stringify(localConfig)},false)`);
  assert.equal(result.state,'ready','真实代理首次核验失败');return result.ip;
}
async function stopChild() { client?.close();child?.kill('SIGTERM');if(child && child.exitCode===null)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(5000)]); }
async function browserIp() {
  await evaluate("document.querySelector('[data-page=browser]').click()");
  const url=`https://api.ipify.org/?format=json&acceptance=${Date.now()}`;
  await evaluate(`window.workspace.browser('navigate',${JSON.stringify(url)})`);
  const page=await until(async()=> (await fetch(`http://127.0.0.1:${debugPort}/json`).then(r=>r.json())).find(p=>p.url===url));
  const browser={close(){},call(method,params){return evaluate('window.workspace.browserProbe('+JSON.stringify(url)+','+JSON.stringify(params)+')')}};
  try { return await until(async()=> {const body=(await browser.call('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true})).result.value;try{return JSON.parse(body).ip;}catch{return null;}}); }
  finally{browser.close();}
}
try {
  const ip=await boot(); assert.equal(await browserIp(),ip);
  const cycles=[];
  for(let cycle=1;cycle<=3;cycle++) {
    offline=true;for(const socket of sockets)socket.destroy();
    await evaluate(`window.workspace.browser('navigate','https://api.ipify.org/?format=json&outage=${cycle}')`);
    await until(async()=> (await evaluate('window.workspace.state()')).network.state==='blocked');
    const before=outbound;
    const denied=await evaluate("window.workspace.browser('navigate','https://httpbin.org/ip').then(()=>false,()=>true)");
    assert.equal(denied,true);await pause(2200);assert.equal(outbound,before,'隔离期间不应产生到真实上游的新连接');
    const begin=Date.now();offline=false;
    await until(async()=> (await evaluate('window.workspace.state()')).network.state==='ready');
    assert.equal((await evaluate('window.workspace.state()')).network.ip,ip);
    assert.equal(await browserIp(),ip);
    cycles.push({cycle,blockedAccessDenied:true,recoveredMs:Date.now()-begin,ip});
  }
  await stopChild();const restartedIp=await boot();assert.equal(restartedIp,ip);assert.equal(await browserIp(),ip);
  const pins=JSON.parse(await readFile(path.join(temp,'egress-pins.json'),'utf8'));assert.ok(Object.values(pins).includes(ip));
  const dnsBlocked=await evaluate("window.workspace.dnsProbe('example.com')");assert.equal(dnsBlocked.blocked,true);
  const result={dnsBlocked,at:new Date().toISOString(),ip,browserBefore:ip,cycles,restartSameIp:true,scope:'仅在测试进程的TCP转发入口模拟断开；未修改系统网络或使用Claude账号'};
  await mkdir('artifacts',{recursive:true});await writeFile('artifacts/live-recovery.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{await stopChild();for(const socket of sockets)socket.destroy();await new Promise(resolve=>relay.close(resolve));await rm(temp,{recursive:true,force:true});}
