import {RequestLifecycle,PerformanceStats} from './request-lifecycle.mjs';
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

// Each gateway owns its admission queues. Verification never waits behind traffic.
class AdmissionQueue {
  constructor(limit,capacity,timeout){
    if(!Number.isInteger(limit)||limit<1||!Number.isInteger(capacity)||capacity<0||!Number.isFinite(timeout)||timeout<1)throw new Error('无效代理容量');
    Object.assign(this,{limit,capacity,timeout});this.active=0;this.queue=[];this.admitted=0;this.rejected=0;this.expired=0;this.cancelled=0;
  }
  acquire(signal){
    signal?.throwIfAborted();
    if(this.active<this.limit)return Promise.resolve(this.grant());
    if(this.queue.length>=this.capacity){this.rejected++;return Promise.reject(proxyError('PROXY_BUSY'));}
    return new Promise((resolve,reject)=>{
      const item={resolve,reject,clean:()=>{clearTimeout(item.timer);signal?.removeEventListener('abort',cancel);}};
      const cancel=()=>{const i=this.queue.indexOf(item);if(i<0)return;this.queue.splice(i,1);item.clean();if(signal?.aborted)this.cancelled++;else this.expired++;reject(signal?.aborted?signal.reason:proxyError('PROXY_QUEUE_TIMEOUT'));};
      item.timer=setTimeout(cancel,this.timeout);this.queue.push(item);signal?.addEventListener('abort',cancel,{once:true});
    });
  }
  snapshot(){return {active:this.active,queued:this.queue.length,limit:this.limit,queueLimit:this.capacity,admittedTotal:this.admitted,rejectedTotal:this.rejected,queueTimeoutTotal:this.expired,queueCancelledTotal:this.cancelled};}
  grant(){this.active++;this.admitted++;let released=false;return()=>{if(released)return;released=true;this.active--;const next=this.queue.shift();if(next){next.clean();next.resolve(this.grant());}};}
}

export class ProxyGateway extends EventEmitter {
  constructor(config, { timeout = 15000, allowLocalTargets = false, ca = undefined, expectedIp = null, healthInterval = 60000, retryBase = 5000, retryMax = 300000, leaseMs = 180000, jitter = 0.2, onVerified = null, listenHost = '127.0.0.1', listenPort = 0, gostBinary = null, coreRetryBase = 1000, coreRetryMax = 30000, coreRetryLimit = 5, coreStableMs = 60000, forwardingLimit = 64, forwardingQueueLimit = 128, queueTimeout = 15000, responseHeadersTimeout = 30000, responseBodyTimeout = 30000, uploadIdleTimeout = 30000, downstreamIdleTimeout = 30000 } = {}) {
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
    for(const value of [responseHeadersTimeout,responseBodyTimeout,uploadIdleTimeout,downstreamIdleTimeout])if(!Number.isFinite(value)||value<=0)throw new Error('无效响应超时');
    Object.assign(this,{responseHeadersTimeout,responseBodyTimeout,uploadIdleTimeout,downstreamIdleTimeout});
    this.performanceStats=new PerformanceStats();
    this.forwardMetrics={http:0,connect:0,establishedTotal:0,clientCancelledTotal:0,abortedTotal:0,responseTimeouts:{headers:0,body:0,upload:0,downstream:0}};
    this.ca = ca;
    this.allowLocalTargets = allowLocalTargets;
    this.sockets = new Set();
    this.forwarding=new AdmissionQueue(forwardingLimit,forwardingQueueLimit,queueTimeout);
    this.probeAdmission=new AdmissionQueue(4,16,queueTimeout);
    this.exitAdmission=new AdmissionQueue(1,2,queueTimeout);
    this.forwardControllers=new Set();
    this.requestAgents = new Map(); this.poolGeneration = 0;this.pendingRequests=new Set();
    this.token = randomBytes(24).toString('hex');
    this.poolStats={connections:0,requests:0,reused:0};
    this.status = { requestPool:this.poolStats,state: 'blocked', ip: expectedIp, reason: '尚未验证出口', connections: 0 };
    this.closed = false;
  }
  get status(){
    if(!this._status)return this._status;
    const count=group=>Object.values(group).reduce((n,list)=>n+list.length,0);
    let active=0,idle=0;for(const agent of this.requestAgents.values()){active+=count(agent.sockets);idle+=count(agent.freeSockets);}
    this._status.performance=this.performanceStats.snapshot();
    this._status.performanceReuse=this.performanceStats.reuse();
    this._status.connections=this.forwardMetrics.http+this.forwardMetrics.connect;
    this._status.capacity={forwarding:{...this.forwarding.snapshot(),...this.forwardMetrics,responseTimeouts:{...this.forwardMetrics.responseTimeouts}},probes:this.probeAdmission.snapshot(),verification:this.exitAdmission.snapshot()};
    this._status.requestPool={...this.poolStats,activeSockets:active,idleSockets:idle};
    return this._status;
  }
  set status(value){this._status=value;}
  update(patch) { this.status = { ...this.status, ...patch }; this.emit('status', this.status); }
  track(socket) {
    this.sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => this.sockets.delete(socket));
    return socket;
  }
  block(reason = '代理已停止', { recoverable = false } = {}) {
    for(const c of this.forwardControllers)c.abort(proxyError('GATEWAY_BLOCKED'));
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
    // Bound unauthenticated/idle inbound TCP sockets as well as admitted work.
    this.server.maxConnections=this.forwarding.limit+this.forwarding.capacity+32;
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
  async tunnel(host, port, {signal,onPhase=()=>{}}={}) {
    signal?.throwIfAborted();onPhase('connect');
    if (this.closed || !this.coreAvailable) throw proxyError('GATEWAY_BLOCKED');
    if (!this.allowLocalTargets && localTarget(host)) throw proxyError('TARGET_BLOCKED');
    const c = this.sidecar?.config || this.config;
    if (c.protocol === 'socks5') {
      // Build and track the upstream socket before the SOCKS handshake so stop() also cancels pending handshakes.
      const existing_socket = await this.openSocket(false,signal);
      onPhase('tunnel');
      const result = await SocksClient.createConnection({
        proxy: { host: c.host, port: c.port, type: 5, userId: c.username, password: c.password },
        command: 'connect', destination: { host, port }, existing_socket, timeout: this.timeout,
      });
      if (this.closed) { result.socket.destroy(); throw new Error('代理已停止'); }
      return this.track(result.socket);
    }
    const socket = await this.openSocket(c.protocol === 'https',signal);
    onPhase('tunnel');
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
  async openSocket(secure,signal) {
    signal?.throwIfAborted();
    const c = this.sidecar?.config || this.config;
    return new Promise((resolve, reject) => {
      const socket = this.track(secure ? tls.connect({ ca: this.ca, host: c.host, port: c.port, servername: net.isIP(c.host) ? undefined : c.host }) : net.connect({ host: c.host, port: c.port }));
      const abort=()=>socket.destroy(signal.reason);signal?.addEventListener('abort',abort,{once:true});socket.once('close',()=>signal?.removeEventListener('abort',abort));if(signal?.aborted)abort();
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
    const allowed = ['REQUEST_TIMEOUT','PROXY_BUSY','PROXY_QUEUE_TIMEOUT','PROXY_TARGET_REFUSED', 'TARGET_BLOCKED', 'INVALID_TARGET', 'TARGET_STREAM_ERROR', 'PROXY_AUTH_REQUIRED', 'PROXY_REFUSED', 'PROXY_CLOSED', 'PROXY_TIMEOUT', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'];
    const code = allowed.includes(error?.code) ? error.code : 'PROXY_CONNECTION_ERROR';
    // Only a canonical host and port are retained; never URL paths, credentials or raw errors.
    const target = /^[a-z\d.:[\]-]+$/i.test(host || '') ? `${host}:${port}` : '未知目标';
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : undefined;
    const reason = code === 'PROXY_TARGET_REFUSED' ? `上游代理拒绝目标隧道（HTTP ${statusCode}）；仅本次请求失败，不回退直连` : code === 'TARGET_STREAM_ERROR' ? '目标响应中断；仅本次请求失败，不回退直连' : isolated ? '本次代理请求失败，其他连接保留，不回退直连' : connectionFailureReason(error);
    const failure = { target, code, statusCode, ...(error?.phase?{phase:error.phase}:{}), reason, scope: isolated ? 'request' : 'gateway', at: new Date().toISOString() };
    this.status.lastFailure = failure;
    this.emit('requestFailure', failure);
    if (!isolated) {
      this.quarantined = true;
      this.block(`${reason} [${code}] 目标 ${target}`, { recoverable: !this.quarantined });
    }
  }
  forwardingScope(client){
    const controller=new AbortController();this.forwardControllers.add(controller);
    let release,kind,done=false;
    const cancel=()=>controller.abort(Object.assign(new Error('客户端已取消'),{code:'CLIENT_CANCELLED'}));
    const finish=()=>{if(done)return;done=true;release?.();release=null;if(kind)this.forwardMetrics[kind]--;client.off('close',cancel);client.off('end',cancel);this.forwardControllers.delete(controller);};
    client.once('close',cancel);client.once('end',cancel);controller.signal.addEventListener('abort',()=>{if(!done){if(controller.signal.reason?.code==='CLIENT_CANCELLED')this.forwardMetrics.clientCancelledTotal++;else this.forwardMetrics.abortedTotal++;}finish();},{once:true});
    if(client.destroyed)cancel();
    return {signal:controller.signal,finish,connected:(type)=>{client.off('end',cancel);if(!done&&!kind){kind=type;this.forwardMetrics[kind]++;this.forwardMetrics.establishedTotal++;}},acquire:async()=>{const slot=await this.forwarding.acquire(controller.signal);if(controller.signal.aborted){slot();controller.signal.throwIfAborted();}release=slot;}};
  }
  async forwardConnect(req, client, head) {
    if (!this.authorized(req)) return client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="workspace"\r\n\r\n');
    const scope=this.forwardingScope(client),timings=this.performanceStats.start('connect');let host,port,upstream;
    try {
      this.assertOpen();
      const parsed=new URL(`http://${req.url}`);host=parsed.hostname.replace(/^\[|\]$/g,'');port=Number(parsed.port || 443);
      if(parsed.username || parsed.password || parsed.pathname!=='/')throw proxyError('INVALID_TARGET');
      await scope.acquire();this.assertOpen();scope.signal.throwIfAborted();
      upstream=await this.tunnel(host,port,{signal:scope.signal,onPhase:phase=>timings.advance(phase)});
      this.assertOpen();scope.signal.throwIfAborted();
      timings.finish('success');
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if(head.length)upstream.write(head);
      scope.connected('connect');client.pipe(upstream);upstream.pipe(client);upstream.resume();
      upstream.once('close',()=>{scope.finish();client.destroy();});
      this.update({});
    }catch(error){
      timings.finish(scope.signal.aborted?'cancelled':error.code==='PROXY_QUEUE_TIMEOUT'?'timeout':'error');upstream?.destroy();scope.finish();
      if(!client.destroyed)client.end(`HTTP/1.1 ${['PROXY_BUSY','PROXY_QUEUE_TIMEOUT'].includes(error.code)?'503 Service Unavailable':'502 Bad Gateway'}\r\nConnection: close\r\n\r\n`);
      if(!scope.signal.aborted)this.reportFailure(error,host,port);
    }
  }
  async forward(req,res){
    if(!this.authorized(req)){res.writeHead(407,{'Proxy-Authenticate':'Basic realm="workspace"'});return res.end();}
    let target;try{target=new URL(req.url);if(target.protocol!=='http:')throw new Error();}catch{res.writeHead(400);return res.end('代理仅接受 HTTP 请求或 HTTPS CONNECT');}
    const scope=this.forwardingScope(res),timings=this.performanceStats.start('http');res.once('finish',scope.finish);let socket,upstream,life;
    try{
      this.assertOpen();await scope.acquire();this.assertOpen();scope.signal.throwIfAborted();
      socket=await this.tunnel(target.hostname,Number(target.port || 80),{signal:scope.signal,onPhase:phase=>timings.advance(phase)});
      this.assertOpen();scope.signal.throwIfAborted();
      const headers={...req.headers,host:target.host};delete headers['proxy-authorization'];delete headers['proxy-connection'];
      const agent=new http.Agent({keepAlive:false});agent.createConnection=()=>socket;
      life=new RequestLifecycle({signal:scope.signal,timings,timeouts:{queue:0,connect:0,tunnel:0,tls:0,headers:this.responseHeadersTimeout,body:this.responseBodyTimeout,upload:this.uploadIdleTimeout,downstream:this.downstreamIdleTimeout,total:0}});
      life.rejectOnAbort(error=>{if(error.code==='REQUEST_TIMEOUT'){
        this.forwardMetrics.responseTimeouts[error.phase]++;scope.finish();
        this.reportFailure(error,target.hostname,Number(target.port || 80));
        if(!res.headersSent){res.writeHead(504);res.end('目标响应超时');}else res.destroy();
      }});
      upstream=http.request(target,{method:req.method,headers,agent,signal:life.signal},response=>{
        res.writeHead(response.statusCode,response.headers);response.pipe(res);
        response.once('error',()=>res.destroy());response.once('end',()=>socket.destroy());
      });
      life.bind(upstream,{customConnection:true,uploadSource:req,downstream:res});scope.connected('http');
      upstream.once('close',()=>{socket.destroy();agent.destroy();});
      upstream.on('error',()=>{if(!res.destroyed){if(!res.headersSent)res.writeHead(502);res.end();if(!scope.signal.aborted&&!life.signal.aborted)this.reportFailure(proxyError('TARGET_STREAM_ERROR'),target.hostname,Number(target.port || 80));}socket.destroy();});
      req.pipe(upstream);socket.resume();
    }catch(error){timings.finish(scope.signal.aborted?'cancelled':error.code==='PROXY_QUEUE_TIMEOUT'?'timeout':'error');life?.finish();socket?.destroy();scope.finish();if(!res.destroyed){if(!res.headersSent)res.writeHead(['PROXY_BUSY','PROXY_QUEUE_TIMEOUT'].includes(error.code)?503:502);res.end('代理未就绪或连接繁忙');}if(!scope.signal.aborted)this.reportFailure(error,target.hostname,Number(target.port || 80));}
  }
  async checkServiceLatencies(targets = {claude:'https://www.anthropic.com/',openai:'https://openai.com/'}) {
    if(this.closed || this.serviceChecking)return;
    this.serviceChecking=true;
    try {
      if(this.status.state!=='ready')return;
      const results=await Promise.all(Object.entries(targets).map(async([id,url])=>{
        const started=performance.now();
        try { const response=await this.readText(url,{headersOnly:true});return [id,{latencyMs:Math.round(performance.now()-started),statusCode:response.statusCode}]; }
        catch(error){return [id,{error:['PROXY_TIMEOUT','REQUEST_TIMEOUT'].includes(error.code)?'timeout':'unavailable',...(error.phase?{phase:error.phase}:{})}];}
      }));
      if(!this.closed && this.status.state==='ready')this.update({serviceLatencies:Object.fromEntries(results)});
    } finally {
      this.serviceChecking=false;
      if(this.monitoring && !this.closed && this.serviceProbes===true){clearTimeout(this.serviceTimer);this.serviceTimer=setTimeout(()=>void this.checkServiceLatencies(),this.healthInterval);this.serviceTimer.unref?.();}
    }
  }
  clearRequestPools() {
    this.poolGeneration++;
    for(const life of this.pendingRequests)life.abort(proxyError('GATEWAY_BLOCKED'));this.pendingRequests.clear();
    for(const agent of this.requestAgents.values())agent.destroy();
    this.requestAgents.clear();
  }
  requestAgent(target,{fresh=false}={}) {
    if(this.closed || this.quarantined || !this.coreAvailable)throw proxyError('GATEWAY_BLOCKED');
    const key=target.origin;
    if(!fresh && this.requestAgents.has(key))return this.requestAgents.get(key);
    // One gateway belongs to one account/environment and immutable proxy config.
    // No global agents: stop/block/core replacement invalidates this whole generation.
    const generation=this.poolGeneration,client=target.protocol==='https:'?https:http;
    const agent=new client.Agent({keepAlive:true,maxSockets:4,maxTotalSockets:4,maxFreeSockets:2,timeout:90000,maxCachedSessions:0});
    agent.createConnection=(_options,callback)=>{
      const life=_options.requestLifecycle;
      let socket;
      const valid=()=>!this.closed && !this.quarantined && this.coreAvailable && generation===this.poolGeneration && !life?.signal.aborted;
      void (async()=>{
        if(!valid())throw proxyError('GATEWAY_BLOCKED');
        socket=await this.tunnel(target.hostname,Number(target.port || (target.protocol==='https:'?443:80)),{signal:life?.signal,onPhase:phase=>life?.advance(phase)});
        if(!valid())throw proxyError('GATEWAY_BLOCKED');
        if(target.protocol==='https:'){
          life?.advance('tls');
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
    if(!fresh && this.requestAgents.size>=32){agent.destroy();throw proxyError('POOL_LIMIT');}
    if(!fresh)this.requestAgents.set(key,agent);return agent;
  }
  async readText(url, {headersOnly=false,fresh=false,signal,timeouts} = {}) {
    const target=new URL(url);
    if(!['http:','https:'].includes(target.protocol) || target.username || target.password)throw new Error('不支持的检测地址');
    const agent=this.requestAgent(target,{fresh}),client=target.protocol==='https:'?https:http;
    const life=new RequestLifecycle({signal,timings:this.performanceStats.start(fresh?'verification':'probe'),timeouts:{queue:this.timeout,connect:this.timeout,tunnel:this.timeout,tls:this.timeout,headers:this.timeout,body:this.timeout,total:this.timeout*3,...timeouts}});this.pendingRequests.add(life);
    let release;
    try{release=await (fresh?this.exitAdmission:this.probeAdmission).acquire(life.signal);life.signal.throwIfAborted();return await new Promise((resolve,reject)=>{
      life.rejectOnAbort(reject);
      const request=client.request(target,{agent,signal:life.signal,requestLifecycle:life,method:headersOnly?'HEAD':'GET',headers:{accept:'application/json'}},response=>{
        let body='';response.setEncoding('utf8');
        response.on('data',chunk=>{body+=chunk;if(body.length>65536)request.destroy(new Error('检测响应过大'));});
        response.once('error',reject);
        response.once('end',()=>headersOnly?resolve({statusCode:response.statusCode}):response.statusCode===200?resolve(body):reject(new Error('出口检测服务响应异常')));
      });
      life.bind(request,{customConnection:true});
      // No retry, including stale keep-alive sockets. The next scheduled check
      // may create a new proxied connection; it never falls back to direct.
      request.once('socket',()=>{this.poolStats.requests++;if(request.reusedSocket)this.poolStats.reused++;});
      request.once('error',error=>reject(life.signal.aborted?life.signal.reason:error));request.end();
    });}finally{release?.();life.finish();this.pendingRequests.delete(life);if(fresh)agent.destroy();}
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
        const body = (await this.readText(url,{fresh:true})).trim();
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
        this.update({ state: 'ready', verificationState:'verified', probeFailures:[], ip, checkedAt: new Date().toISOString(), recovering: false, reason: '固定出口核验成功；应用代理就绪', probeSource: new URL(url).hostname,verificationConnection:'fresh',latencyMs:Math.round(performance.now()-started) });
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
