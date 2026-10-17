import {existsSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ProxyGateway, proxyEnvironment, validateProxy, connectionFailureReason } from '../src/proxy.mjs';

async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }
async function close(server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
async function fixture(options = {}) {
  let hits = 0, exitIp = '203.0.113.8', rejectProxy = false, rejectTargetOnce = false, offlineProxy = false, auth, forwardedAuth;
  const remotePorts = new Set(), targetPorts = [];
  const sockets = new Set();
  const target = http.createServer((req, res) => { hits++; targetPorts.push(req.socket.remotePort); forwardedAuth = req.headers['proxy-authorization']; if (req.url === '/bad-probe') { res.writeHead(503); res.end(); return; } if(req.url.startsWith('/localized-region')){const chinese=new URL(req.url,'http://fixture.invalid').searchParams.get('lang')==='zh-CN';res.end(JSON.stringify({ip:exitIp,country:'US',city:chinese?'华盛顿':'Washington',region:chinese?'哥伦比亚特区':'District of Columbia'}));return;} if(req.url.startsWith('/region')){res.end(`ip=${req.url==='/region-wrong'?'203.0.113.99':exitIp}\nloc=US\n`);return;}res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ip: exitIp })); });
  const targetPort = await listen(target);
  const upstream = http.createServer();
  upstream.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); });
  let tunnels = 0;
  upstream.on('connect', (req, client, head) => {
    auth = req.headers['proxy-authorization']; tunnels++;
    if (offlineProxy) { client.destroy(); return; }
    if (rejectProxy) { client.end('HTTP/1.1 407 Authentication Required\r\n\r\n'); return; }
    if (rejectTargetOnce) { rejectTargetOnce = false; client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const url = new URL(`http://${req.url}`);
    const remote = net.connect(Number(url.port), url.hostname==='proxy-target.invalid'?'127.0.0.1':url.hostname, () => {
      remotePorts.add(remote.localPort);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) remote.write(head); client.pipe(remote); remote.pipe(client);
    });
    sockets.add(remote); remote.on('error', () => client.destroy()); remote.once('close', () => { sockets.delete(remote); client.destroy(); }); client.once('close', () => remote.destroy());
  });
  const upstreamPort = await listen(upstream);
  const gateway = await new ProxyGateway({ protocol: 'http', host: '127.0.0.1', port: upstreamPort, username: 'user', password: 'secret' }, { timeout: 1000, allowLocalTargets: true, ...options }).start();
  const url = `http://127.0.0.1:${targetPort}/exit`;
  return { gateway, url, get hits() { return hits; }, get tunnels() { return tunnels; }, get auth() { return auth; }, get forwardedAuth() { return forwardedAuth; }, get routeVerified() { return targetPorts.every(p => remotePorts.has(p)); }, changeIp() { exitIp = '203.0.113.9'; }, reject() { rejectProxy = true; }, rejectTarget() { rejectTargetOnce = true; }, offline() { offlineProxy = true; for (const socket of sockets) socket.destroy(); }, online() { offlineProxy = false; }, async cleanup() { await gateway.stop(); for (const s of sockets) s.destroy(); await close(upstream); await close(target); } };
}
async function request(gateway, url, authenticate = true) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: gateway.port, path: url, headers: authenticate ? { 'Proxy-Authorization': `Basic ${Buffer.from(`workspace:${gateway.token}`).toString('base64')}` } : {} }, res => {
      let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ code: res.statusCode, body }));
    });
    req.on('error', reject); req.setTimeout(2000, () => req.destroy(new Error('test timeout'))); req.end();
  });
}

test('代理参数和继承环境必须受控', () => {
  assert.throws(() => validateProxy({ protocol: 'ftp', host: 'a', port: 80 }));
  assert.throws(() => validateProxy({ protocol: 'http', host: 'http://a', port: 80 }));
  assert.throws(() => validateProxy({ protocol: 'http', host: 'a', port: 0 }));
  const env = proxyEnvironment({ https_proxy: 'http://wrong', NO_PROXY: '*', ALL_PROXY: 'socks5://wrong', ANTHROPIC_BASE_URL: 'https://gateway', PATH: '/bin' }, 'http://local');
  assert.equal(env.https_proxy, undefined); assert.equal(env.ALL_PROXY, 'http://local'); assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.HTTPS_PROXY, 'http://local'); assert.equal(env.NO_PROXY, ''); assert.equal(env.PATH, '/bin');
});
test('出口验证与 HTTP 请求实际经过上游，凭据不发给目标', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.gateway.verify(f.url)).state, 'ready');
    assert.equal(f.tunnels, 1, '出口探测必须经过上游代理');
    const response = await request(f.gateway, f.url);
    assert.equal(response.code, 200); assert.equal(f.tunnels, 2, '页面请求必须经过上游代理'); assert.equal(f.hits, 2);
    assert.equal(f.auth, `Basic ${Buffer.from('user:secret').toString('base64')}`); assert.equal(f.forwardedAuth, undefined); assert.equal(f.routeVerified, true, '每个请求必须来自上游代理的隧道端口');
  } finally { await f.cleanup(); }
});
test('未核验前阻断请求，不访问目标', async () => {
  const f = await fixture(); try { assert.equal((await request(f.gateway, f.url)).code, 502); assert.equal(f.hits, 0); assert.equal(f.tunnels, 0); } finally { await f.cleanup(); }
});
test('不带本地认证的进程不能使用代理入口', async () => {
  const f = await fixture(); try { await f.gateway.verify(f.url); assert.equal((await request(f.gateway, f.url, false)).code, 407); assert.equal(f.hits, 1); } finally { await f.cleanup(); }
});
test('上游拒绝连接时禁止直连，随后锁定入口', async () => {
  const f = await fixture(); try {
    await f.gateway.verify(f.url); const hits = f.hits; f.reject();
    await request(f.gateway, f.url).catch(() => {});
    assert.equal(f.gateway.status.state, 'blocked'); assert.equal(f.gateway.status.lastFailure.code, 'PROXY_AUTH_REQUIRED'); assert.match(f.gateway.status.reason, /407/); assert.equal(f.hits, hits, '上游异常后目标不应收到直连请求');
    await request(f.gateway, f.url).catch(() => {}); assert.equal(f.hits, hits);
  } finally { await f.cleanup(); }
});
test('单个目标隧道被拒绝不锁定其他请求，且没有直连', async () => {
  const f = await fixture(); const failures = [];
  f.gateway.on('requestFailure', failure => failures.push(failure));
  try {
    await f.gateway.verify(f.url); const hits = f.hits;
    f.rejectTarget();
    assert.equal((await request(f.gateway, f.url)).code, 502);
    assert.equal(f.hits, hits, '目标拒绝时不能直接访问目标');
    assert.equal(f.gateway.status.state, 'ready');
    assert.equal(failures.length, 1); assert.equal(failures[0].scope, 'request');
    assert.equal(failures[0].statusCode, 403); assert.equal(failures[0].code, 'PROXY_TARGET_REFUSED');
    assert.equal((await request(f.gateway, f.url)).code, 200);
    assert.equal(f.routeVerified, true); assert.equal(f.tunnels, 3);
  } finally { await f.cleanup(); }
});
test('入口单次连接失败保持其他连接，并记录脱敏原因', async () => {
  const f = await fixture();
  try {
    await f.gateway.verify(f.url);
    // Force the existing upstream entry to be unreachable without changing the target.
    const unused = net.createServer(); const port = await listen(unused); await close(unused);
    f.gateway.config.port = port;
    const hits = f.hits;
    await request(f.gateway, f.url).catch(() => {});
    assert.equal(f.gateway.status.state, 'ready'); assert.equal(f.hits, hits);
    assert.equal(f.gateway.status.lastFailure.code, 'ECONNREFUSED');
    assert.equal(f.gateway.status.lastFailure.scope, 'request');
    assert.match(f.gateway.status.lastFailure.reason, /其他连接保留/);
    assert.ok(!JSON.stringify(f.gateway.status.lastFailure).includes('secret'));
    assert.ok(!JSON.stringify(f.gateway.status.lastFailure).includes('/exit'));
  } finally { await f.cleanup(); }
});
test('检测到出口改变后销毁连接并锁定', async () => {
  const f = await fixture(); try { await f.gateway.verify(f.url); f.changeIp(); await f.gateway.verify(f.url); assert.equal(f.gateway.status.state, 'blocked'); assert.equal(f.gateway.status.ip, '203.0.113.8'); const hits = f.hits; await request(f.gateway, f.url).catch(() => {}); assert.equal(f.hits, hits); } finally { await f.cleanup(); }
});
test('CONNECT 建立的流也经过代理，停止核心即销毁流', async () => {
  const f = await fixture(); let socket;
  try {
    await f.gateway.verify(f.url);
    socket = net.connect(f.gateway.port, '127.0.0.1');
    const response = await new Promise((resolve, reject) => {
      socket.on('error', reject); socket.once('data', data => resolve(data.toString()));
      socket.write(`CONNECT ${new URL(f.url).host} HTTP/1.1\r\nProxy-Authorization: Basic ${Buffer.from(`workspace:${f.gateway.token}`).toString('base64')}\r\n\r\n`);
    });
    assert.match(response, /200 Connection Established/); assert.equal(f.tunnels, 2);
    const ended = new Promise(resolve => socket.once('close', resolve)); await f.gateway.stop(); await ended;
    assert.equal(f.gateway.sockets.size, 0);
  } finally { socket?.destroy(); await f.cleanup(); }
});

test('SOCKS5 上游认证及域名解析在代理端完成', async () => {
  let destinations = [], sockets = new Set();
  const target = http.createServer((_req, res) => res.end(JSON.stringify({ ip: '203.0.113.11' })));
  const targetPort = await listen(target);
  const proxy = net.createServer(client => {
    sockets.add(client); client.on('error', () => {}); client.once('close', () => sockets.delete(client));
    let stage = 0, buffer = Buffer.alloc(0);
    const receive = chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 0 && buffer.length >= 2 && buffer.length >= 2 + buffer[1]) { buffer = buffer.subarray(2 + buffer[1]); stage = 1; client.write(Buffer.from([5, 2])); }
      if (stage === 1 && buffer.length >= 2) {
        const u = buffer[1], passwordOffset = 2 + u;
        if (buffer.length <= passwordOffset || buffer.length < passwordOffset + 1 + buffer[passwordOffset]) return;
        const username = buffer.subarray(2, passwordOffset).toString();
        const password = buffer.subarray(passwordOffset + 1, passwordOffset + 1 + buffer[passwordOffset]).toString();
        if (username !== 'alice' || password !== 'secret') { client.end(Buffer.from([1, 1])); return; }
        buffer = buffer.subarray(passwordOffset + 1 + buffer[passwordOffset]); stage = 2; client.write(Buffer.from([1, 0]));
      }
      if (stage === 2 && buffer.length >= 5) {
        assert.equal(buffer[3], 3, '应把域名传给 SOCKS，而非在本机解析');
        const length = buffer[4], total = 7 + length;
        if (buffer.length < total) return;
        const host = buffer.subarray(5, 5 + length).toString(); destinations.push(host);
        assert.equal(host, 'test-target.invalid');
        const remote = net.connect(targetPort, '127.0.0.1', () => {
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          if (buffer.length > total) remote.write(buffer.subarray(total));
          client.off('data', receive); client.pipe(remote); remote.pipe(client);
        });
        sockets.add(remote); remote.on('error', () => client.destroy()); remote.once('close', () => { sockets.delete(remote); client.destroy(); }); client.once('close', () => remote.destroy()); stage = 3;
      }
    };
    client.on('data', receive);
  });
  const port = await listen(proxy);
  const gateway = await new ProxyGateway({ protocol: 'socks5', host: '127.0.0.1', port, username: 'alice', password: 'secret' }, { timeout: 1500 }).start();
  try {
    await gateway.readText(`http://test-target.invalid:${targetPort}/`);
    assert.equal((await gateway.verify(`http://test-target.invalid:${targetPort}/`)).state, 'ready');
    assert.equal((await request(gateway, `http://test-target.invalid:${targetPort}/`)).code, 200);
    assert.equal(destinations.length, 3);
  } finally { await gateway.stop(); for (const s of sockets) s.destroy(); await close(proxy); await close(target); }
});

test('HTTP 与 TLS 代理入口都支持 HTTPS 网站，并保持证书校验', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fixed-egress-tls-'));
  let gateway, target, upstream, plainUpstream; const sockets = new Set(); let tunnels = 0;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    const key = await readFile(path.join(dir, 'key.pem')), cert = await readFile(path.join(dir, 'cert.pem'));
    target = https.createServer({ key, cert }, (_req, res) => res.end(JSON.stringify({ ip: '203.0.113.12' })));
    const targetPort = await listen(target);
    upstream = https.createServer({ key, cert });
    upstream.on('connection', s => { sockets.add(s); s.on('error', () => {}); s.once('close', () => sockets.delete(s)); });
    upstream.on('connect', (_req, client, head) => {
      tunnels++; const remote = net.connect(targetPort, '127.0.0.1', () => { client.write('HTTP/1.1 200 OK\r\n\r\n'); if (head.length) remote.write(head); client.pipe(remote); remote.pipe(client); });
      sockets.add(remote); remote.on('error', () => client.destroy()); remote.once('close', () => { sockets.delete(remote); client.destroy(); }); client.once('close', () => remote.destroy());
    });
    const port = await listen(upstream);
    plainUpstream = http.createServer();
    plainUpstream.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); });
    plainUpstream.on('connect', upstream.listeners('connect')[0]);
    const plainPort = await listen(plainUpstream);
    gateway = await new ProxyGateway({ protocol: 'http', host: '127.0.0.1', port: plainPort }, { timeout: 2000, allowLocalTargets: true, ca: cert }).start();
    assert.equal((await gateway.verify(`https://localhost:${targetPort}/`)).state, 'ready', 'HTTP 代理必须支持 HTTPS 网站');
    assert.equal(tunnels, 1); await gateway.stop();
    const mismatch = await new ProxyGateway({ protocol: 'https', host: '127.0.0.1', port: plainPort }, { timeout: 2000, allowLocalTargets: true, ca: cert }).start();
    try { assert.equal((await mismatch.verify(`https://localhost:${targetPort}/`)).state, 'blocked'); assert.match(mismatch.status.reason, /协议不匹配/); assert.equal(tunnels, 1); } finally { await mismatch.stop(); }
    gateway = await new ProxyGateway({ protocol: 'https', host: '127.0.0.1', port }, { timeout: 2000, allowLocalTargets: true, ca: cert }).start();
    assert.equal((await gateway.verify(`https://localhost:${targetPort}/`)).state, 'ready'); assert.equal(tunnels, 2);
    await gateway.stop();
    const untrusted = await new ProxyGateway({ protocol: 'https', host: '127.0.0.1', port }, { timeout: 2000, allowLocalTargets: true }).start();
    try { assert.equal((await untrusted.verify(`https://localhost:${targetPort}/`)).state, 'blocked'); assert.equal(tunnels, 2, '证书失败时不能关闭校验或直连'); } finally { await untrusted.stop(); }
  } finally {
    await gateway?.stop(); for (const socket of sockets) socket.destroy();
    if (plainUpstream) await close(plainUpstream); if (upstream) await close(upstream); if (target) await close(target); await rm(dir, { recursive: true, force: true });
  }
});

test('连接诊断区分认证和入口协议错误，且不回显错误中的凭据', () => {
  const secret = 'DO_NOT_EXPOSE_PRIVATE_SECRET';
  for (const code of ['ERR_SSL_PACKET_LENGTH_TOO_LONG', 'PROXY_AUTH_REQUIRED', 'ECONNREFUSED', 'ETIMEDOUT', 'UNKNOWN']) {
    const reason = connectionFailureReason({code, message: secret});
    assert.ok(!reason.includes(secret));
  }
  assert.match(connectionFailureReason({code: 'PROXY_AUTH_REQUIRED'}), /407/);
  assert.match(connectionFailureReason({code: 'ERR_SSL_PACKET_LENGTH_TOO_LONG'}), /HTTP \/ HTTPS/);
});

async function waitFor(fn, timeout = 3000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('恢复状态等待超时');
}
test('检测断网降级后自动退避恢复，同一出口及入口，禁止直连', async () => {
  const f = await fixture({ healthInterval: 40, retryBase: 20, retryMax: 80, jitter: 0 });
  try {
    await f.gateway.verify(f.url); const address = f.gateway.address, ip = f.gateway.status.ip;
    f.gateway.startMonitoring(f.url); f.offline();
    await waitFor(() => f.gateway.status.verificationState === 'unavailable');
    const hits = f.hits; await request(f.gateway, f.url).catch(() => {}); assert.equal(f.hits, hits);
    await waitFor(() => f.gateway.failures >= 2); assert.equal(f.gateway.status.recovering, false);
    f.online(); await waitFor(() => f.gateway.status.verificationState === 'verified');
    assert.equal(f.gateway.status.ip, ip); assert.equal(f.gateway.address, address);
    assert.equal((await request(f.gateway, f.url)).code, 200); assert.equal(f.routeVerified, true);
    await f.gateway.stop(); const tunnels = f.tunnels;
    await new Promise(resolve => setTimeout(resolve, 120)); assert.equal(f.tunnels, tunnels, '手动停止后不能自动重连');
  } finally { await f.cleanup(); }
});
test('自动恢复检测到出口变化保持隔离，不能手动核验接受新IP', async () => {
  const f = await fixture({ healthInterval: 30, retryBase: 10, jitter: 0 });
  try {
    await f.gateway.verify(f.url); f.gateway.startMonitoring(f.url); f.changeIp();
    await waitFor(() => f.gateway.quarantined);
    assert.equal(f.gateway.status.state, 'blocked'); assert.equal(f.gateway.status.ip, '203.0.113.8');
    const hits = f.hits; await f.gateway.checkNow(); await f.gateway.verify(f.url);
    assert.equal(f.hits, hits); await request(f.gateway, f.url).catch(() => {}); assert.equal(f.hits, hits);
  } finally { await f.cleanup(); }
});
test('重建网关仍校验传入的固定出口，不重新接受不同IP', async () => {
  const f = await fixture({ expectedIp: '203.0.113.99' });
  try { assert.equal((await f.gateway.verify(f.url)).state, 'blocked'); assert.equal(f.gateway.status.ip, '203.0.113.99'); assert.equal(f.gateway.quarantined, true); }
  finally { await f.cleanup(); }
});
test('检测服务故障使用备用来源核验同一出口；过期只标记不打断转发', async () => {
  const f = await fixture({ leaseMs: 20 });
  try {
    assert.equal((await f.gateway.verify([f.url.replace('/exit', '/bad-probe'), f.url])).state, 'ready');
    assert.equal(f.gateway.status.ip, '203.0.113.8');
    await new Promise(resolve => setTimeout(resolve, 30)); const hits = f.hits;
    assert.equal((await request(f.gateway, f.url)).code,200); assert.equal(f.hits, hits+1); assert.equal(f.gateway.status.state, 'ready');assert.equal(f.gateway.status.verificationState,'stale');
  } finally { await f.cleanup(); }
});

test('固定出口持久化失败不能先放行，且停止后异步核验不能复活网关', async () => {
  const f = await fixture({ onVerified: async () => { throw new Error('write failed'); } });
  try { await f.gateway.verify(f.url); assert.equal(f.gateway.status.state, 'blocked'); assert.equal(f.gateway.quarantined, true); }
  finally { await f.cleanup(); }
  let release; const gate = new Promise(resolve => { release = resolve; });
  const pending = await fixture({ onVerified: () => gate });
  try {
    const verification = pending.gateway.verify(pending.url);
    await waitFor(() => pending.hits === 1);
    await pending.gateway.stop(); release(); await verification;
    assert.equal(pending.gateway.status.state, 'blocked');
  } finally { release(); await pending.cleanup(); }
});

test('异步核验不能覆盖并发发生的认证隔离', async () => {
  let armed = false, release; const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture({ onVerified: () => armed ? gate : undefined });
  try {
    await f.gateway.verify(f.url); armed = true;
    const verification = f.gateway.verify(f.url); await waitFor(() => f.hits >= 2);
    f.gateway.reportFailure({ code: 'PROXY_AUTH_REQUIRED' }, 'target.invalid', 443);
    release(); await verification;
    assert.equal(f.gateway.quarantined, true); assert.equal(f.gateway.status.state, 'blocked');
  } finally { release(); await f.cleanup(); }
});

test('地区检测必须经过上游且匹配固定出口，断开时禁止请求',async()=>{
 const f=await fixture();try{
  await f.gateway.verify(f.url);assert.ok(Number.isFinite(f.gateway.status.latencyMs));
  const before=f.hits;assert.equal(await f.gateway.detectRegion(new URL('/region',f.url)), 'US');assert.equal(f.hits,before+1);assert.equal(f.gateway.status.countryCode,'US');
  await assert.rejects(f.gateway.detectRegion(new URL('/region-wrong',f.url)),/不一致/);
  f.gateway.block();const blockedHits=f.hits;await assert.rejects(f.gateway.detectRegion(new URL('/region',f.url)),{code:'GATEWAY_BLOCKED'});assert.equal(f.hits,blockedHits);
 }finally{await f.cleanup();}
});

test('地理位置查询按语言返回城市与省州，并标记结果语言',async()=>{
 const f=await fixture();try{
  await f.gateway.verify(f.url);
  for(const [language,city,region] of [['zh-CN','华盛顿','哥伦比亚特区'],['en','Washington','District of Columbia']]){
   await f.gateway.detectRegion(new URL('/localized-region?lang='+language,f.url));
   assert.equal(f.gateway.status.regionLanguage,'en');assert.equal(f.gateway.status.city,city);assert.equal(f.gateway.status.region,region);
  }
 }finally{await f.cleanup();}
});

test('service latency uses proxy HEAD responses without requiring API credentials', async () => {
  const f=await fixture();
  try {
    await f.gateway.verify(f.url);
    const before=f.tunnels;
    await f.gateway.checkServiceLatencies({claude:f.url,openai:f.url.replace('/exit','/bad-probe')});
    assert.equal(f.tunnels-before,2);
    assert.equal(f.gateway.status.serviceLatencies.claude.statusCode,200);
    assert.equal(f.gateway.status.serviceLatencies.openai.statusCode,503);
    assert.ok(f.gateway.status.serviceLatencies.claude.latencyMs>=0);
    assert.equal(f.gateway.status.state,'ready');
    f.offline();
    await f.gateway.checkServiceLatencies({claude:f.url,openai:f.url});
    assert.equal(f.gateway.status.serviceLatencies.claude.error,'unavailable');
    assert.equal(f.gateway.status.state,'ready');
    assert.ok(f.routeVerified);
  } finally {await f.cleanup();}
});

test('所有检测来源失败保留已有CONNECT流，备用成功不发生中间blocked',async()=>{
 const f=await fixture();let socket;
 try{
  await f.gateway.verify(f.url);const states=[];f.gateway.on('status',status=>states.push(status.state));
  socket=net.connect(f.gateway.port,'127.0.0.1');
  const response=new Promise((resolve,reject)=>{socket.once('data',resolve);socket.once('error',reject);});
  socket.write(`CONNECT ${new URL(f.url).host} HTTP/1.1\r\nProxy-Authorization: Basic ${Buffer.from(`workspace:${f.gateway.token}`).toString('base64')}\r\n\r\n`);
  assert.match((await response).toString(),/200/);
  await f.gateway.verify([f.url.replace('/exit','/bad-probe'),f.url.replace('/exit','/bad-probe')]);
  assert.equal(f.gateway.status.verificationState,'unavailable');assert.equal(socket.destroyed,false);
  const body=new Promise((resolve,reject)=>{socket.once('data',resolve);socket.once('error',reject);});
  socket.write('GET /exit HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  assert.match((await body).toString(),/203.0.113.8/);
  await f.gateway.verify([f.url.replace('/exit','/bad-probe'),f.url]);
  assert.equal(f.gateway.status.verificationState,'verified');assert.ok(states.every(state=>state==='ready'));
 }finally{socket?.destroy();await f.cleanup();}
});

const gostBinary=new URL('../vendor/gost/'+process.platform+'_'+(process.arch==='x64'?'amd64':process.arch)+'/gost',import.meta.url).pathname;
test('GOST: forwarding, failed probes and upstream loss never bypass the configured proxy',{skip:!existsSync(gostBinary)&&'Run npm run proxy:install-gost to enable integration tests'},async()=>{
 const f=await fixture({gostBinary});
 try{
  assert.equal((await f.gateway.verify(f.url)).state,'ready');assert.equal(f.gateway.status.engine,'gost');
  assert.equal((await request(f.gateway,f.url.replace('127.0.0.1','proxy-target.invalid'))).code,200,'target DNS must resolve at the upstream');
  assert.equal((await request(f.gateway,f.url)).code,200);assert.equal(f.routeVerified,true);assert.equal(f.forwardedAuth,undefined);
  await f.gateway.verify([f.url.replace('/exit','/bad-probe')]);assert.equal(f.gateway.status.state,'ready');assert.equal(f.gateway.status.verificationState,'unavailable');
  assert.equal((await request(f.gateway,f.url)).code,200);
  const hits=f.hits;f.offline();assert.equal((await request(f.gateway,f.url)).code,502);assert.equal(f.hits,hits);
  f.online();assert.equal((await request(f.gateway,f.url)).code,200);
  f.changeIp();await f.gateway.verify(f.url);assert.equal(f.gateway.quarantined,true);assert.equal(f.gateway.status.state,'blocked');
  const stoppedHits=f.hits;await request(f.gateway,f.url).catch(()=>{});assert.equal(f.hits,stoppedHits);
 }finally{await f.cleanup();}
});
test('GOST: isolated gateways use separate authenticated ports and core exit fails closed',{skip:!existsSync(gostBinary)&&'Run npm run proxy:install-gost to enable integration tests'},async()=>{
 const a=await fixture({gostBinary}),b=await fixture({gostBinary});
 try{
  await a.gateway.verify(a.url);await b.gateway.verify(b.url);
  assert.notEqual(a.gateway.sidecar.config.port,b.gateway.sidecar.config.port);assert.notEqual(a.gateway.token,b.gateway.token);
  const response=await new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port:a.gateway.port,path:a.url,headers:{'Proxy-Authorization':'Basic '+Buffer.from('workspace:'+b.gateway.token).toString('base64')}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));}).on('error',reject));assert.equal(response,407);
  process.kill(a.gateway.sidecar.pid,'SIGTERM');await waitFor(()=>a.gateway.status.state==='blocked');
  assert.equal((await request(b.gateway,b.url)).code,200);const hits=a.hits;await request(a.gateway,a.url).catch(()=>{});assert.equal(a.hits,hits);
  await a.gateway.verify(a.url);assert.equal(a.gateway.status.state,'blocked');
 }finally{await a.cleanup();await b.cleanup();}
});
