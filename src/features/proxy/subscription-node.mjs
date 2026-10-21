import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

const SUPPORTED = new Set(['vless', 'hysteria2', 'ss']);
const COMMON = ['name', 'type', 'server', 'port', 'udp', 'tfo', 'ip-version', 'skip-cert-verify', 'relay'];
const TLS = ['tls', 'servername', 'sni', 'alpn', 'client-fingerprint', 'fingerprint'];
const KEYS = {
  vless: [...COMMON, ...TLS, 'uuid', 'flow', 'packet-encoding', 'encryption', 'network', 'ws-opts', 'grpc-opts', 'h2-opts', 'http-opts', 'reality-opts', 'ech-opts'],
  hysteria2: [...COMMON, ...TLS, 'password', 'obfs', 'obfs-password', 'up', 'down', 'ports', 'mport', 'hop-interval'],
  ss: [...COMMON, 'cipher', 'password', 'plugin', 'plugin-opts', 'udp-over-tcp', 'udp-over-tcp-version'],
};
const CIPHERS = new Set(['aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305', '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305']);

function invalid(message = '节点配置无效') { throw new Error(message); }
function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  return value;
}
function allowed(value, keys) {
  record(value);
  if (Object.keys(value).some(key => !keys.includes(key))) invalid('节点含不支持的设置，不能安全导入');
}
function text(value, max = 1024, empty = false) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value) || (!empty && !value)) invalid();
  return value;
}
function password(value, max) {
  if (typeof value !== 'string' && typeof value !== 'number') invalid('节点凭据无效');
  return text(String(value), max);
}
function bool(value) { if (typeof value !== 'boolean') invalid(); return value; }
function choice(value, options) { if (!options.includes(value)) invalid('节点使用不支持的协议参数'); return value; }
function safeName(value, fallback = '订阅节点') {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 120) || fallback : fallback;
}
function host(value) {
  const input = text(value, 253).trim().replace(/^\[|\]$/g, '');
  if (isIP(input)) return input.toLowerCase();
  const ascii = domainToASCII(input).toLowerCase().replace(/\.$/, '');
  if (!ascii || ascii.length > 253 || !ascii.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) invalid('节点服务器地址无效');
  return ascii;
}
function port(value) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value))) invalid('节点端口必须为 1～65535');
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) invalid('节点端口必须为 1～65535');
  return parsed;
}
function list(value, max = 16) {
  if (!Array.isArray(value) || !value.length || value.length > max) invalid();
  return value.map(item => text(item, 255));
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).filter(key => key !== 'name').sort().map(key => [key, stable(value[key])]));
}
function tlsOptions(raw, node) {
  if (raw.tls !== undefined) node.tls = bool(raw.tls);
  if (raw.servername !== undefined || raw.sni !== undefined) {
    if (raw.servername && raw.sni && raw.servername !== raw.sni) invalid('节点 TLS 名称不一致');
    const key = node.type === 'hysteria2' ? 'sni' : 'servername';
    node[key] = host(raw.servername ?? raw.sni);
  }
  if (raw.alpn !== undefined) node.alpn = list(raw.alpn);
  if (raw['client-fingerprint'] !== undefined) node['client-fingerprint'] = choice(raw['client-fingerprint'], ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', '360', 'qq', 'random', 'randomized']);
  if (raw.fingerprint !== undefined) {
    const fingerprint = text(raw.fingerprint, 128).replace(/:/g, '');
    if (!/^[a-f0-9]{64}$/i.test(fingerprint)) invalid('节点证书指纹无效');
    node.fingerprint = fingerprint;
  }
}
function vlessOptions(raw, node) {
  node.uuid = text(raw.uuid, 36).toLowerCase();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(node.uuid)) invalid('VLESS 用户 ID 无效');
  node.tls = raw.tls === undefined ? false : bool(raw.tls);
  if (raw.flow) node.flow = choice(raw.flow, ['xtls-rprx-vision']);
  if (raw['packet-encoding'] !== undefined) node['packet-encoding'] = choice(raw['packet-encoding'], ['', 'xudp', 'packetaddr']);
  if (raw.encryption && raw.encryption !== 'none') invalid('暂不支持此 VLESS 加密扩展');
  node.network = choice(raw.network ?? 'tcp', ['tcp', 'ws', 'grpc', 'h2', 'http']);
  const optionKeys = { ws: 'ws-opts', grpc: 'grpc-opts', h2: 'h2-opts', http: 'http-opts' };
  for (const key of Object.values(optionKeys)) if (raw[key] !== undefined && optionKeys[node.network] !== key) invalid('节点传输配置与传输类型不一致');
  if (raw['ws-opts'] !== undefined) {
    const ws = raw['ws-opts'];
    allowed(ws, ['path', 'headers', 'max-early-data', 'early-data-header-name', 'v2ray-http-upgrade', 'v2ray-http-upgrade-fast-open']);
    node['ws-opts'] = {};
    if (ws.path !== undefined) node['ws-opts'].path = text(ws.path, 2048, true);
    if (ws.headers !== undefined) {
      allowed(ws.headers, ['Host', 'host']);
      if (ws.headers.Host && ws.headers.host) invalid();
      node['ws-opts'].headers = { Host: host(ws.headers.Host ?? ws.headers.host) };
    }
    if (ws['max-early-data'] !== undefined) {
      if (!Number.isInteger(ws['max-early-data']) || ws['max-early-data'] < 0 || ws['max-early-data'] > 65535) invalid();
      node['ws-opts']['max-early-data'] = ws['max-early-data'];
    }
    if (ws['early-data-header-name'] !== undefined) {
      const header = text(ws['early-data-header-name'], 80);
      if (!/^[a-z0-9-]+$/i.test(header)) invalid();
      node['ws-opts']['early-data-header-name'] = header;
    }
    for (const key of ['v2ray-http-upgrade', 'v2ray-http-upgrade-fast-open']) if (ws[key] !== undefined) node['ws-opts'][key] = bool(ws[key]);
  }
  if (raw['grpc-opts'] !== undefined) {
    allowed(raw['grpc-opts'], ['grpc-service-name']);
    node['grpc-opts'] = { 'grpc-service-name': text(raw['grpc-opts']['grpc-service-name'] ?? '', 1024, true) };
  }
  if (raw['h2-opts'] !== undefined) {
    allowed(raw['h2-opts'], ['host', 'path']);
    node['h2-opts'] = {};
    if (raw['h2-opts'].host !== undefined) node['h2-opts'].host = list(raw['h2-opts'].host).map(host);
    if (raw['h2-opts'].path !== undefined) node['h2-opts'].path = text(raw['h2-opts'].path, 2048, true);
  }
  if (raw['http-opts'] !== undefined) {
    const http = raw['http-opts']; allowed(http, ['method', 'path', 'headers']);
    node['http-opts'] = {};
    if (http.method !== undefined) node['http-opts'].method = choice(http.method, ['GET', 'POST', 'HEAD']);
    if (http.path !== undefined) node['http-opts'].path = list(http.path);
    if (http.headers !== undefined) { allowed(http.headers, ['Host']); node['http-opts'].headers = { Host: list(http.headers.Host).map(host) }; }
  }
  if (raw['reality-opts'] !== undefined) {
    if (!node.tls || !['tcp', 'grpc'].includes(node.network)) invalid('Reality 需要 TLS 及兼容传输');
    const reality = raw['reality-opts']; allowed(reality, ['public-key', 'short-id']);
    const key = text(reality['public-key'], 43), short = text(reality['short-id'] ?? '', 16, true);
    if (!/^[a-z0-9_-]{43}$/i.test(key) || !/^(?:[a-f0-9]{2}){0,8}$/i.test(short)) invalid('Reality 参数无效');
    node['reality-opts'] = { 'public-key': key, 'short-id': short };
  }
  if (node.flow && (node.network !== 'tcp' || !node.tls)) invalid('Vision 需要 TCP 与 TLS');
  if (raw['ech-opts'] !== undefined) {
    const ech = raw['ech-opts']; allowed(ech, ['enable', 'config', 'query-server-name']);
    const enable = bool(ech.enable);
    if (enable) {
      if (!node.tls) invalid('ECH 需要启用 TLS');
      node['ech-opts'] = { enable: true };
      if (ech.config !== undefined) {
        const config = text(ech.config, 16384);
        if (!/^[a-z0-9+/]+={0,2}$/i.test(config)) invalid('ECH 配置无效');
        node['ech-opts'].config = config;
      }
      if (ech['query-server-name'] !== undefined) node['ech-opts']['query-server-name'] = host(ech['query-server-name']);
      if (!node['ech-opts'].config && !node['ech-opts']['query-server-name']) invalid('ECH 配置不完整');
    }
  }
}
function hysteriaOptions(raw, node) {
  if (raw.tls === false) invalid('Hysteria2 必须验证 TLS');
  node.password = password(raw.password, 2048);
  if (raw.obfs) node.obfs = choice(raw.obfs, ['salamander']);
  if (raw['obfs-password'] !== undefined) {
    if (!node.obfs) invalid('混淆密码缺少混淆类型');
    node['obfs-password'] = text(raw['obfs-password'], 2048);
  }
  if (node.obfs && !node['obfs-password']) invalid('混淆密码不能为空');
  for (const key of ['up', 'down']) if (raw[key] !== undefined) {
    const value = String(raw[key]);
    if (!/^\d+(?:\.\d+)?(?:\s*(?:[KMGT]?bps|[KMGT]?b\/s))?$/i.test(value) || !Number.parseFloat(value)) invalid('Hysteria2 速率参数无效');
    node[key] = value;
  }
  if (raw.ports !== undefined || raw.mport !== undefined) {
    const ports = text(String(raw.ports ?? raw.mport), 256);
    if (raw.ports !== undefined && raw.mport !== undefined && String(raw.ports) !== String(raw.mport)) invalid('Hysteria2 跳跃端口配置不一致');
    const spans = ports.split(',');
    if (spans.length > 16) invalid('Hysteria2 跳跃端口配置无效');
    for (const span of spans) {
      if (!/^\d+(?:-\d+)?$/.test(span)) invalid('Hysteria2 跳跃端口配置无效');
      const [start, end = start] = span.split('-').map(port);
      if (start > end) invalid('Hysteria2 跳跃端口配置无效');
    }
    node.ports = ports;
  }
  if (raw['hop-interval'] !== undefined) {
    if (!Number.isInteger(raw['hop-interval']) || raw['hop-interval'] < 5 || raw['hop-interval'] > 3600) invalid('Hysteria2 跳跃间隔无效');
    node['hop-interval'] = raw['hop-interval'];
  }
}
function ssOptions(raw, node) {
  node.cipher = choice(raw.cipher, [...CIPHERS]);
  node.password = password(raw.password, 4096);
  if (raw.plugin || raw['plugin-opts']) invalid('暂不支持 Shadowsocks 插件节点');
  if (raw['udp-over-tcp'] !== undefined) node['udp-over-tcp'] = bool(raw['udp-over-tcp']);
  if (raw['udp-over-tcp-version'] !== undefined) node['udp-over-tcp-version'] = choice(raw['udp-over-tcp-version'], [1, 2]);
}

/** Revalidate an untrusted persisted/IPC node before it can reach the sidecar. */
export function validateSubscriptionProxy(config, depth = 0) {
  if (depth > 1) invalid('前置节点不能再包含代理链');
  record(config);
  const raw = record(config.node);
  const type = raw.type === 'hy2' ? 'hysteria2' : raw.type;
  if (!SUPPORTED.has(type)) invalid('仅支持 VLESS、Hysteria2 和 SS 订阅节点');
  allowed(raw, KEYS[type]);
  if (raw['skip-cert-verify'] !== undefined) {
    bool(raw['skip-cert-verify']);
    if (raw['skip-cert-verify'] && type !== 'hysteria2') invalid('不允许跳过节点 TLS 证书验证');
  }
  const node = { name: safeName(config.name ?? raw.name), type, server: host(raw.server), port: port(raw.port) };
  if (config.protocol !== undefined && config.protocol !== type) invalid('节点协议与配置不一致');
  if (config.host !== undefined && host(config.host) !== node.server) invalid('节点服务器与配置不一致');
  if (config.port !== undefined && port(config.port) !== node.port) invalid('节点端口与配置不一致');
  if (raw.udp !== undefined) node.udp = bool(raw.udp);
  if (raw.tfo !== undefined) node.tfo = bool(raw.tfo);
  if (raw['ip-version'] !== undefined) node['ip-version'] = choice(raw['ip-version'], ['dual', 'ipv4', 'ipv6', 'ipv4-prefer', 'ipv6-prefer']);
  if (type !== 'ss') tlsOptions(raw, node);
  if (type === 'vless') vlessOptions(raw, node);
  else if (type === 'hysteria2') hysteriaOptions(raw, node);
  else ssOptions(raw, node);
  if (raw.relay !== undefined) {
    if (!['hysteria2','ss'].includes(type)) invalid('仅 Hysteria2 和 SS 可配置前置节点');
    const relay = validateSubscriptionProxy({node:raw.relay}, depth + 1);
    if (relay.protocol !== 'vless' || !relay.node.tls || relay.node.relay) invalid('前置节点必须是启用 TLS 的单个 VLESS 节点');
    node.relay = relay.node;
  }
  const { name, ...connection } = node;
  const nodeId = createHash('sha256').update(JSON.stringify(stable(connection))).digest('hex');
  return { protocol: type, host: node.server, port: node.port, username: '', password: '', name, nodeId, node };
}
