import {startGost} from './gost-sidecar.mjs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { SocksClient } from 'socks';

export function validateProxy(config) {
  if (!['http', 'https', 'socks5'].includes(config.protocol)) throw new Error('请选择 HTTP、HTTPS 或 SOCKS5 代理');
  const host = String(config.host ?? '').trim();
  if (!host || /[\s/@?#]/.test(host)) throw new Error('代理地址应填写主机名或 IP，不包含协议、路径或账号');
  const port = Number(config.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须为 1～65535');
  const username = String(config.username ?? '');
  const password = String(config.password ?? '');
  if (/[\r\n]/.test(username + password)) throw new Error('代理凭据不能包含换行');
  return { protocol: config.protocol, host, port, username, password };
}

export function proxyEnvironment(base, proxyUrl) {
  const env = { ...base };
  for (const key of Object.keys(env)) {
    if (/^(https?_proxy|all_proxy|no_proxy)$/i.test(key)) delete env[key];
    // This workspace connects the official local CLI, never a inherited API gateway.
    if (/^(ANTHROPIC_(BASE_URL|API_KEY|AUTH_TOKEN)|CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY))$/.test(key)) delete env[key];
  }
  env.HTTP_PROXY = proxyUrl;
  env.HTTPS_PROXY = proxyUrl;
  env.NO_PROXY = '';
  env.ALL_PROXY = proxyUrl;
  env.LANG = 'en_US.UTF-8';
  env.LC_ALL = 'en_US.UTF-8';
  delete env.NODE_OPTIONS;
  return env;
}

function localTarget(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0' || /^127\./.test(h);
}

function proxyError(code, statusCode) {
  const error = new Error('代理请求失败'); error.code = code; error.statusCode = statusCode; return error;
}
export function connectionFailureReason(error) {
  const code = error?.code;
  if (['ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_PACKET_LENGTH_TOO_LONG', 'ERR_SSL_UNSUPPORTED_PROTOCOL', 'ERR_SSL_RECORD_OVERFLOW'].includes(code)) return '代理入口协议不匹配：IPRoyal HTTP|HTTPS 请选“HTTP / HTTPS”；它同样支持 HTTPS 网站。当前入口已锁定。';
  if (code === 'PROXY_AUTH_REQUIRED') return '代理认证失败（407），请检查用户名、密码或 IP 白名单；应用访问已锁定。';
  if (code === 'PROXY_CLOSED') return '代理在建立隧道时关闭连接；应用访问已锁定，请重新核验。';
  if (code === 'PROXY_REFUSED') return '上游代理拒绝隧道，请检查套餐权限或目标限制；应用访问已锁定。';
  if (['ETIMEDOUT', 'PROXY_TIMEOUT'].includes(code)) return '连接代理或出口检测超时；应用访问已锁定，请检查代理可达性。';
  if (code === 'ECONNREFUSED') return '无法连接代理端口；应用访问已锁定，请检查地址与端口。';
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return '代理地址解析失败；应用访问已锁定，请检查主机名。';
  if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code)) return 'TLS 证书校验失败；应用访问已锁定，不会关闭校验或改为直连。';
  return '出口验证失败，应用访问已锁定；请检查代理或检测服务后重试。';
}

export class ProxyGateway extends EventEmitter {
  constructor(config, { timeout = 15000, allowLocalTargets = false, ca = undefined, expectedIp = null, healthInterval = 60000, retryBase = 5000, retryMax = 300000, leaseMs = 180000, jitter = 0.2, onVerified = null, listenHost = '127.0.0.1', listenPort = 0, gostBinary = null, coreRetryBase = 1000, coreRetryMax = 30000, coreRetryLimit = 5, coreStableMs = 60000 } = {}) {
    super();
    this.config = validateProxy(config);
    if (expectedIp && !net.isIP(expectedIp)) throw new Error('固定出口 IP 无效');
    Object.assign(this, { healthInterval, retryBase, retryMax, leaseMs, jitter });
    this.onVerified = onVerified;
    this.listenHost=listenHost;this.listenPort=listenPort;this.gostBinary=gostBinary;
    Object.assign(this,{coreRetryBase,coreRetryMax,coreRetryLimit,coreStableMs});
    this.coreGeneration=0;this.coreAvailable=!gostBinary;this.coreAttempts=0;
    this.monitoring = false; this.quarantined = false; this.failures = 0;
    this.timeout = timeout;
    this.ca = ca;
    this.allowLocalTargets = allowLocalTargets;
    this.sockets = new Set();
    this.requestAgents = new Map(); this.poolGeneration = 0;
    this.token = randomBytes(24).toString('hex');
    this.poolStats={connections:0,requests:0,reused:0};
    this.status = { requestPool:this.poolStats,state: 'blocked', ip: expectedIp, reason: '尚未验证出口', connections: 0 };
    this.closed = false;
  }
  update(patch) { this.status = { ...this.status, ...patch }; this.emit('status', this.status); }
  track(socket) {
    this.sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => this.sockets.delete(socket));
    return socket;
  }
  block(reason = '代理已停止', { recoverable = false } = {}) {
    this.clearRequestPools();
    this.update({ state: 'blocked', reason, recovering: recoverable && this.monitoring, nextRetryAt: null });
    for (const socket of this.sockets) socket.destroy();
    if (recoverable && this.monitoring && !this.checking) this.scheduleCheck(this.retryBase);
  }
  authorized(req) {
    return req.headers['proxy-authorization'] === `Basic ${Buffer.from(`workspace:${this.token}`).toString('base64')}`;
  }
  async start() {
    if(this.gostBinary){try{await this.launchCore();}catch(error){await this.stop();throw error;}this.status.engine='gost';}else this.status.engine='native';
    this.server = http.createServer((req, res) => this.forward(req, res));
    this.server.on('connect', (req, client, head) => this.forwardConnect(req, client, head));
    this.server.on('connection', socket => this.track(socket));
    this.server.on('clientError', (_err, socket) => socket.destroy());
    try{await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.listenPort, this.listenHost, resolve);
    });}catch(error){await this.sidecar?.stop();throw error;}
    this.port = this.server.address().port;
    return this;
  }
  async launchCore() {
    const generation=++this.coreGeneration;
    const sidecar=await startGost(this.config,{binary:this.gostBinary,ca:this.ca,onExit:()=>{
      if(this.closed || generation!==this.coreGeneration)return;
      this.coreAvailable=false;++this.coreGeneration;
      clearTimeout(this.coreStableTimer);clearTimeout(this.healthTimer);
      this.block('GOST 内核退出，等待恢复并重新核验固定出口');
      this.update({verificationState:'unavailable',coreState:'waiting'});
      this.scheduleCoreRecovery();
    }});
    if(this.closed || generation!==this.coreGeneration){await sidecar.stop();throw new Error('代理内核启动已取消');}
    this.sidecar=sidecar;this.coreAvailable=true;this.update({coreState:'running'});
  }
  scheduleCoreRecovery() {
    clearTimeout(this.coreTimer);
    if(this.closed || this.quarantined)return;
    if(this.coreAttempts>=this.coreRetryLimit){this.update({coreState:'exhausted',recovering:false,nextRetryAt:null,reason:'GOST 连续恢复失败，已停止自动重试；请重新连接代理'});return;}
    const delay=Math.min(this.coreRetryMax,this.coreRetryBase*2**this.coreAttempts);
    this.update({recovering:true,coreState:'waiting',coreAttempts:this.coreAttempts,nextRetryAt:new Date(Date.now()+delay).toISOString()});
    this.coreTimer=setTimeout(()=>{
      if(this.coreRecovery){this.scheduleCoreRecovery();return;}
      this.coreRecovery=this.recoverCore().finally(()=>{this.coreRecovery=null;});
    },delay);this.coreTimer.unref?.();
  }
  async recoverCore() {
    if(this.closed || this.quarantined)return;
    this.coreAttempts++;
    this.update({coreState:'starting',coreAttempts:this.coreAttempts,nextRetryAt:null});
    try{
      await this.sidecar?.stop();
      if(this.closed || this.quarantined)return;
      await this.launchCore();
      // An older verification must finish before the new core can certify its route.
      await this.verifying;
      if(this.closed || this.quarantined || !this.coreAvailable)return;
      await this.verify(this.probeUrls || this.lastProbeUrls);
      if(!this.closed && !this.quarantined && this.coreAvailable){
        this.startMonitoring(this.probeUrls || this.lastProbeUrls);
        this.coreStableTimer=setTimeout(()=>{if(!this.closed && this.coreAvailable && this.status.state==='ready'){this.coreAttempts=0;this.update({coreAttempts:0});}},this.coreStableMs);
        this.coreStableTimer.unref?.();
      }
    }catch{
      if(!this.closed && !this.quarantined){this.coreAvailable=false;this.block('GOST 恢复失败，等待重试；不会直连');this.scheduleCoreRecovery();}
    }
  }
  get url() { return `http://workspace:${this.token}@127.0.0.1:${this.port}`; }
  get address() { return `http://127.0.0.1:${this.port}`; }
  assertOpen() {
    if (this.status.state === 'ready' && Date.now() - Date.parse(this.status.checkedAt) > this.leaseMs) {
      if(this.status.verificationState!=='stale')this.update({verificationState:'stale',reason:'出口暂未重新确认；保留已验证的代理通道，不回退直连'});
    }
    if (this.closed || this.status.state !== 'ready') throw proxyError('GATEWAY_BLOCKED');
  }
  startMonitoring(urls = ['https://api.ipify.org?format=json', 'https://checkip.amazonaws.com/']) {
    this.probeUrls = Array.isArray(urls) ? urls : [urls]; this.monitoring = true;
    if(this.serviceProbes === true)void this.checkServiceLatencies();
    this.scheduleCheck(this.status.state === 'ready' ? this.healthInterval : this.retryBase);
  }
  scheduleCheck(delay) {
    clearTimeout(this.healthTimer);
    if (!this.monitoring || this.closed || this.quarantined || !this.coreAvailable) return;
    this.update({ recovering: this.status.state !== 'ready', nextRetryAt: new Date(Date.now() + delay).toISOString() });
    this.healthTimer = setTimeout(() => { void this.checkNow(); }, delay); this.healthTimer.unref?.();
  }
  async checkNow() {
    if (this.closed || this.quarantined) return this.status;
    if (this.checking) return this.checking;
    clearTimeout(this.healthTimer);
    if(this.status.state==='ready')this.update({healthChecking:true});
    this.checking = this.verify(this.probeUrls).finally(() => {
      this.update({healthChecking:false});
      this.checking = null;
      if (this.status.verificationState === 'verified') this.failures = 0; else this.failures++;
      const base = this.status.verificationState === 'verified' ? this.healthInterval : Math.min(this.retryMax, this.retryBase * 2 ** Math.min(this.failures - 1, 10));
      const delay=base;
      this.scheduleCheck(Math.min(this.retryMax, Math.round(delay * (1 + this.jitter * Math.random()))));
    });
    return this.checking;
  }
  async tunnel(host, port) {
    if (this.closed || !this.coreAvailable) throw proxyError('GATEWAY_BLOCKED');
    if (!this.allowLocalTargets && localTarget(host)) throw proxyError('TARGET_BLOCKED');
    const c = this.sidecar?.config || this.config;
    if (c.protocol === 'socks5') {
      // Build and track the upstream socket before the SOCKS handshake so stop() also cancels pending handshakes.
      const existing_socket = await this.openSocket(false);
      const result = await SocksClient.createConnection({
        proxy: { host: c.host, port: c.port, type: 5, userId: c.username, password: c.password },
        command: 'connect', destination: { host, port }, existing_socket, timeout: this.timeout,
      });
      if (this.closed) { result.socket.destroy(); throw new Error('代理已停止'); }
      return this.track(result.socket);
    }
    const socket = await this.openSocket(c.protocol === 'https');
    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      const timer = setTimeout(() => fail(proxyError('PROXY_TIMEOUT')), this.timeout);
      const clean = () => { clearTimeout(timer); socket.off('data', data); socket.off('error', fail); socket.off('close', ended); };
      const fail = err => { clean(); socket.destroy(); reject(err); };
      const ended = () => fail(proxyError('PROXY_CLOSED'));
      const data = chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 65536) return fail(new Error('上游代理响应过大'));
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const line = buffer.subarray(0, end).toString().split('\r\n')[0];
        const statusCode = Number(/^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(line)?.[1]);
        if (statusCode !== 200) return fail(proxyError(statusCode === 407 ? 'PROXY_AUTH_REQUIRED' : [403, 404, 502, 503, 504].includes(statusCode) ? 'PROXY_TARGET_REFUSED' : 'PROXY_REFUSED', statusCode));
        clean();
        socket.pause();
        if (buffer.length > end + 4) socket.unshift(buffer.subarray(end + 4));
        resolve(socket);
      };
      socket.on('data', data); socket.once('error', fail); socket.once('close', ended);
      const destination = net.isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
      const auth = c.username || c.password ? `Proxy-Authorization: Basic ${Buffer.from(`${c.username}:${c.password}`).toString('base64')}\r\n` : '';
      socket.write(`CONNECT ${destination} HTTP/1.1\r\nHost: ${destination}\r\n${auth}Connection: keep-alive\r\n\r\n`);
    });
  }
  async openSocket(secure) {
    const c = this.sidecar?.config || this.config;
    return new Promise((resolve, reject) => {
      const socket = this.track(secure ? tls.connect({ ca: this.ca, host: c.host, port: c.port, servername: net.isIP(c.host) ? undefined : c.host }) : net.connect({ host: c.host, port: c.port }));
      socket.setNoDelay(true); socket.setKeepAlive(true, 30000);
      const timer = setTimeout(() => fail(proxyError('PROXY_TIMEOUT')), this.timeout);
      const clean = () => { clearTimeout(timer); socket.off('error', fail); socket.off('close', ended); };
      const fail = err => { clean(); socket.destroy(); reject(err); };
      const ended = () => fail(proxyError('PROXY_CLOSED'));
      socket.once('error', fail); socket.once('close', ended);
      socket.once(secure ? 'secureConnect' : 'connect', () => { clean(); resolve(socket); });
    });
  }
  isPolicyFailure(error) {
    return error?.code==='PROXY_AUTH_REQUIRED' || (error?.proxyScope!=='target' && /CERT|TLS|SSL/.test(error?.code || ''));
  }
  reportFailure(error, host, port) {
    if (this.closed || this.status.state !== 'ready') return;
    const isolated = !this.isPolicyFailure(error);
    const allowed = ['PROXY_TARGET_REFUSED', 'TARGET_BLOCKED', 'INVALID_TARGET', 'TARGET_STREAM_ERROR', 'PROXY_AUTH_REQUIRED', 'PROXY_REFUSED', 'PROXY_CLOSED', 'PROXY_TIMEOUT', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'];
    const code = allowed.includes(error?.code) ? error.code : 'PROXY_CONNECTION_ERROR';
    // Only a canonical host and port are retained; never URL paths, credentials or raw errors.
    const target = /^[a-z\d.:[\]-]+$/i.test(host || '') ? `${host}:${port}` : '未知目标';
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : undefined;
    const reason = code === 'PROXY_TARGET_REFUSED' ? `上游代理拒绝目标隧道（HTTP ${statusCode}）；仅本次请求失败，不回退直连` : code === 'TARGET_STREAM_ERROR' ? '目标响应中断；仅本次请求失败，不回退直连' : isolated ? '本次代理请求失败，其他连接保留，不回退直连' : connectionFailureReason(error);
    const failure = { target, code, statusCode, reason, scope: isolated ? 'request' : 'gateway', at: new Date().toISOString() };
    this.status.lastFailure = failure;
    this.emit('requestFailure', failure);
    if (!isolated) {
      this.quarantined = true;
      this.block(`${reason} [${code}] 目标 ${target}`, { recoverable: !this.quarantined });
    }
  }
  async forwardConnect(req, client, head) {
    if (!this.authorized(req)) return client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="workspace"\r\n\r\n');
    let host, port;
    try {
      this.assertOpen();
      const parsed = new URL(`http://${req.url}`);
      host = parsed.hostname.replace(/^\[|\]$/g, ''); port = Number(parsed.port || 443);
      if (parsed.username || parsed.password || parsed.pathname !== '/') throw proxyError('INVALID_TARGET');
      const upstream = await this.tunnel(parsed.hostname.replace(/^\[|\]$/g, ''), Number(parsed.port || 443));
      this.assertOpen();
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client); upstream.resume();
      client.once('close', () => upstream.destroy()); upstream.once('close', () => client.destroy());
      this.update({ connections: this.status.connections + 1 });
    } catch (error) {
      client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      this.reportFailure(error, host, port);
    }
  }
  async forward(req, res) {
    if (!this.authorized(req)) { res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="workspace"' }); return res.end(); }
    let target;
    try { target = new URL(req.url); if (target.protocol !== 'http:') throw new Error(); }
    catch { res.writeHead(400); return res.end('代理仅接受 HTTP 请求或 HTTPS CONNECT'); }
    try {
      this.assertOpen();
      const socket = await this.tunnel(target.hostname, Number(target.port || 80));
      this.assertOpen();
      const headers = { ...req.headers, host: target.host };
      delete headers['proxy-authorization']; delete headers['proxy-connection'];
      const agent = new http.Agent({ keepAlive: false });
      agent.createConnection = () => socket;
      const upstream = http.request(target, { method: req.method, headers, agent }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
        response.once('end', () => socket.destroy());
      });
      upstream.on('error', () => { if (!res.destroyed) { if (!res.headersSent) res.writeHead(502); res.end(); this.reportFailure(proxyError('TARGET_STREAM_ERROR'), target.hostname, Number(target.port || 80)); } socket.destroy(); });
      res.once('close', () => upstream.destroy()); req.pipe(upstream); socket.resume();
    } catch (error) { if (!res.headersSent) res.writeHead(502); res.end('代理未就绪或连接失败'); this.reportFailure(error, target.hostname, Number(target.port || 80)); }
  }
  async checkServiceLatencies(targets = {claude:'https://www.anthropic.com/',openai:'https://openai.com/'}) {
    if(this.closed || this.serviceChecking)return;
    this.serviceChecking=true;
    try {
      if(this.status.state!=='ready')return;
      const results=await Promise.all(Object.entries(targets).map(async([id,url])=>{
        const started=performance.now();
        try { const response=await this.readText(url,{headersOnly:true});return [id,{latencyMs:Math.round(performance.now()-started),statusCode:response.statusCode}]; }
        catch(error){return [id,{error:error.code==='PROXY_TIMEOUT'?'timeout':'unavailable'}];}
      }));
      if(!this.closed && this.status.state==='ready')this.update({serviceLatencies:Object.fromEntries(results)});
    } finally {
      this.serviceChecking=false;
      if(this.monitoring && !this.closed && this.serviceProbes===true){clearTimeout(this.serviceTimer);this.serviceTimer=setTimeout(()=>void this.checkServiceLatencies(),this.healthInterval);this.serviceTimer.unref?.();}
    }
  }
  clearRequestPools() {
    this.poolGeneration++;
    for(const agent of this.requestAgents.values())agent.destroy();
    this.requestAgents.clear();
  }
  requestAgent(target) {
    if(this.closed || this.quarantined || !this.coreAvailable)throw proxyError('GATEWAY_BLOCKED');
    const key=target.origin;
    if(this.requestAgents.has(key))return this.requestAgents.get(key);
    // One gateway belongs to one account/environment and immutable proxy config.
    // No global agents: stop/block/core replacement invalidates this whole generation.
    const generation=this.poolGeneration,client=target.protocol==='https:'?https:http;
    const agent=new client.Agent({keepAlive:true,maxSockets:4,maxTotalSockets:4,maxFreeSockets:2,timeout:90000,maxCachedSessions:0});
    agent.createConnection=(_options,callback)=>{
      let socket;
      const valid=()=>!this.closed && !this.quarantined && this.coreAvailable && generation===this.poolGeneration;
      void (async()=>{
        if(!valid())throw proxyError('GATEWAY_BLOCKED');
        socket=await this.tunnel(target.hostname,Number(target.port || (target.protocol==='https:'?443:80)));
        if(!valid())throw proxyError('GATEWAY_BLOCKED');
        if(target.protocol==='https:'){
          socket=this.track(tls.connect({ca:this.ca,socket,servername:net.isIP(target.hostname)?undefined:target.hostname}));
          await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>socket.destroy(proxyError('PROXY_TIMEOUT')),this.timeout);
            socket.once('secureConnect',()=>{clearTimeout(timer);resolve();});
            socket.once('error',error=>{clearTimeout(timer);error.proxyScope='target';reject(error);});
            socket.once('close',()=>{clearTimeout(timer);reject(proxyError('PROXY_CLOSED'));});
          });
        }
        if(!valid())throw proxyError('GATEWAY_BLOCKED');
        this.poolStats.connections++;socket.resume();callback(null,socket);
      })().catch(error=>{socket?.destroy();callback(error);});
    };
    // Bound origin count without evicting active requests. An ephemeral pool is
    // unnecessary for our fixed probe/API destinations; reject excess origins.
    if(this.requestAgents.size>=32){agent.destroy();throw proxyError('POOL_LIMIT');}
    this.requestAgents.set(key,agent);return agent;
  }
  async readText(url, {headersOnly=false} = {}) {
    const target=new URL(url);
    if(!['http:','https:'].includes(target.protocol) || target.username || target.password)throw new Error('不支持的检测地址');
    const agent=this.requestAgent(target),client=target.protocol==='https:'?https:http;
    return new Promise((resolve,reject)=>{
      const request=client.request(target,{agent,method:headersOnly?'HEAD':'GET',headers:{accept:'application/json'}},response=>{
        let body='';response.setEncoding('utf8');
        response.on('data',chunk=>{body+=chunk;if(body.length>65536)request.destroy(new Error('检测响应过大'));});
        response.once('error',reject);
        response.once('end',()=>headersOnly?resolve({statusCode:response.statusCode}):response.statusCode===200?resolve(body):reject(new Error('出口检测服务响应异常')));
      });
      const deadline=setTimeout(()=>request.destroy(proxyError('PROXY_TIMEOUT')),this.timeout);
      request.once('close',()=>clearTimeout(deadline));
      // No retry, including stale keep-alive sockets. The next scheduled check
      // may create a new proxied connection; it never falls back to direct.
      request.once('socket',()=>{this.poolStats.requests++;if(request.reusedSocket)this.poolStats.reused++;});
      request.once('error',reject);request.end();
    });
  }
  async verify(urls = ['https://api.ipify.org?format=json', 'https://checkip.amazonaws.com/']) {
    if (this.verifying) return this.verifying;
    if (this.closed || this.quarantined || !this.coreAvailable) return this.status;
    this.lastProbeUrls=urls;
    this.verifying = this.verifySources(Array.isArray(urls) ? urls : [urls]).finally(() => { this.verifying = null; });
    return this.verifying;
  }
  async detectRegion(url='https://ipinfo.io/json') {
    this.assertOpen();const pinned=this.status.ip;const body=(await this.readText(url)).trim();let code,city,region;
    try{const data=JSON.parse(body);if(data.error || data.bogon || data.ip!==pinned)throw new Error('地区检测结果与固定出口不一致');const geo=data.geo || data;code=geo.country_code || geo.country;city=typeof geo.city==='string'?geo.city.slice(0,120):'';region=typeof geo.region==='string'?geo.region.slice(0,120):'';}
    catch(error){if(body.startsWith('{'))throw error;const fields=Object.fromEntries(body.split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));if(fields.ip!==pinned)throw new Error('地区检测结果与固定出口不一致');code=fields.loc;}
    this.assertOpen();if(this.status.ip!==pinned || !/^[A-Z]{2}$/.test(code || ''))throw new Error('地区检测结果与固定出口不一致');
    this.update({countryCode:code,city,region,regionLanguage:'en',regionSource:new URL(url).hostname,regionCheckedAt:new Date().toISOString()});return code;
  }
  async verifySources(urls) {
    const generation=this.coreGeneration;
    const invalid=()=>this.closed || this.quarantined || generation!==this.coreGeneration || !this.coreAvailable;
    const failures=[];
    for (const url of urls) {
      if (invalid()) break;
      try {
        const started=performance.now();
        const body = (await this.readText(url)).trim();
        let ip; try { ip = JSON.parse(body).ip; } catch { ip = body; }
        if (!net.isIP(ip)) throw proxyError('INVALID_PROBE_RESPONSE');
        if (invalid()) break;
        if (this.status.ip && this.status.ip !== ip) {
          this.quarantined = true;
          this.block(`出口改变：固定 ${this.status.ip}，检测到 ${ip}。保持锁定；请检查上游，不会自动接受新 IP。`);
          break;
        }
        if (this.onVerified) {
          try { await this.onVerified(ip); } catch { this.quarantined = true; this.block('固定出口记录保存失败，已禁止转发'); break; }
        }
        if (invalid()) break;
        this.update({ state: 'ready', verificationState:'verified', probeFailures:[], ip, checkedAt: new Date().toISOString(), recovering: false, reason: '固定出口核验成功；应用代理就绪', probeSource: new URL(url).hostname,latencyMs:Math.round(performance.now()-started) });
        return this.status;
      } catch (error) {
        if (invalid()) break;
        failures.push({source:new URL(url).hostname,code:error.code || 'PROBE_FAILED',at:new Date().toISOString()});
        if(this.isPolicyFailure(error)){this.quarantined=true;this.block(connectionFailureReason(error));break;}
      }
    }
    if(!invalid())this.update({verificationState:'unavailable',probeFailures:failures,reason:this.status.state==='ready'?'出口检测暂不可用；现有代理连接保留，不回退直连':'尚未成功验证固定出口，暂不开放代理转发'});
    return this.status;
  }
  async stop() {
    clearTimeout(this.serviceTimer);clearTimeout(this.coreTimer);clearTimeout(this.coreStableTimer);
    this.closed = true; this.monitoring = false; clearTimeout(this.healthTimer); this.block('代理已停止');
    if (this.server?.listening) await new Promise(resolve => this.server.close(resolve));
    await this.coreRecovery;
    await this.sidecar?.stop();
  }
}
