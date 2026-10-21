import { parseDocument } from 'yaml';
import { validateSubscriptionProxy } from './subscription-node.mjs';
export { validateSubscriptionProxy } from './subscription-node.mjs';

const MAX_BYTES = 1024 * 1024;
const MAX_NODES = 500;
const SUPPORTED = new Set(['vless', 'hysteria2', 'ss']);
function invalid(message = '节点配置无效') { throw new Error(message); }
function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  return value;
}
function choice(value, options) { if (!options.includes(value)) invalid('节点使用不支持的协议参数'); return value; }
function safeName(value, fallback = '订阅节点') {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 120) || fallback : fallback;
}

function decode64(value) {
  if (typeof value !== 'string' || !value || !/^[a-z0-9+/_-]+={0,2}$/i.test(value) || value.length % 4 === 1) invalid('订阅 Base64 编码无效');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.includes(0) || decoded.toString('utf8').includes('\ufffd')) invalid('订阅 Base64 编码无效');
  return decoded.toString('utf8');
}
function decode(value) { try { return decodeURIComponent(value); } catch { invalid('节点 URI 编码无效'); } }
function uriNode(input) {
  const match = /^([a-z0-9+.-]+):\/\//i.exec(input);
  if (!match) invalid('节点 URI 无效');
  let type = match[1].toLowerCase(); if (type === 'hy2') type = 'hysteria2';
  if (!SUPPORTED.has(type)) return { type, name: '不支持的节点' };
  if (type === 'ss') {
    const hash = input.indexOf('#');
    const name = hash >= 0 ? decode(input.slice(hash + 1)) : 'SS 节点';
    let rest = input.slice(match[0].length, hash >= 0 ? hash : undefined);
    const queryIndex = rest.indexOf('?');
    const query = new URLSearchParams(queryIndex >= 0 ? rest.slice(queryIndex + 1) : '');
    if ([...query.keys()].some(key => key !== 'plugin')) invalid('SS 节点含不支持的 URI 参数');
    if (query.has('plugin')) invalid('暂不支持 Shadowsocks 插件节点');
    rest = (queryIndex >= 0 ? rest.slice(0, queryIndex) : rest).replace(/\/$/, '');
    if (!rest.includes('@')) rest = decode64(rest);
    const at = rest.lastIndexOf('@'); if (at < 1) invalid('SS 节点凭据无效');
    let credentials = rest.slice(0, at);
    if (!credentials.includes(':')) credentials = decode64(credentials);
    const colon = credentials.indexOf(':'); if (colon < 1) invalid('SS 节点凭据无效');
    const endpoint = new URL(`http://${rest.slice(at + 1)}`);
    if (endpoint.username || endpoint.password || endpoint.pathname !== '/') invalid('SS 节点地址无效');
    return { type, name, server: endpoint.hostname, port: endpoint.port, cipher: decode(credentials.slice(0, colon)), password: decode(credentials.slice(colon + 1)) };
  }
  const url = new URL(input);
  const params = url.searchParams;
  const known = type === 'vless'
    ? ['encryption', 'security', 'sni', 'servername', 'alpn', 'fp', 'pbk', 'sid', 'flow', 'type', 'path', 'host', 'serviceName', 'packetEncoding', 'allowInsecure', 'insecure']
    : ['sni', 'alpn', 'obfs', 'obfs-password', 'insecure', 'allowInsecure', 'pinSHA256'];
  if ([...params.keys()].some(key => !known.includes(key))) invalid('节点含不支持的 URI 参数');
  if ([...params.keys()].some(key => params.getAll(key).length > 1)) invalid('节点 URI 参数重复');
  for (const key of ['insecure', 'allowInsecure']) if (params.has(key) && !['0', 'false', ''].includes(params.get(key))) invalid('不允许跳过节点 TLS 证书验证');
  if (url.pathname && url.pathname !== '/') invalid('节点 URI 路径无效');
  if (params.has('sni') && params.has('servername') && params.get('sni') !== params.get('servername')) invalid('节点 TLS 名称不一致');
  const node = { name: decode(url.hash.slice(1)) || `${type.toUpperCase()} 节点`, type, server: url.hostname, port: url.port || (type === 'hysteria2' ? 443 : '') };
  if (params.has('sni') || params.has('servername')) node[type === 'hysteria2' ? 'sni' : 'servername'] = params.get('sni') ?? params.get('servername');
  if (params.has('alpn')) node.alpn = params.get('alpn').split(',');
  if (type === 'hysteria2') {
    node.password = decode(url.username) + (url.password ? `:${decode(url.password)}` : '');
    for (const key of ['obfs', 'obfs-password']) if (params.has(key)) node[key] = params.get(key);
    if (params.has('pinSHA256')) node.fingerprint = params.get('pinSHA256');
  } else {
    if (url.password) invalid('VLESS 用户 ID 无效');
    node.uuid = decode(url.username);
    node.network = params.get('type') || 'tcp';
    if (params.has('serviceName') && node.network !== 'grpc') invalid('节点 URI 传输参数不匹配');
    if ((params.has('path') || params.has('host')) && !['ws', 'h2', 'http'].includes(node.network)) invalid('节点 URI 传输参数不匹配');
    const security = choice(params.get('security') || 'none', ['none', 'tls', 'reality']);
    node.tls = security !== 'none';
    if (params.has('encryption')) node.encryption = params.get('encryption');
    if (params.has('fp')) node['client-fingerprint'] = params.get('fp');
    if (params.has('flow')) node.flow = params.get('flow');
    if (params.has('packetEncoding')) node['packet-encoding'] = params.get('packetEncoding');
    if (security === 'reality') node['reality-opts'] = { 'public-key': params.get('pbk'), 'short-id': params.get('sid') ?? '' };
    else if (params.has('pbk') || params.has('sid')) invalid('Reality 参数缺少 Reality 安全类型');
    if (node.network === 'ws') { node['ws-opts'] = { path: params.get('path') || '/' }; if (params.has('host')) node['ws-opts'].headers = { Host: params.get('host') }; }
    else if (node.network === 'grpc') node['grpc-opts'] = { 'grpc-service-name': params.get('serviceName') ?? '' };
    else if (node.network === 'h2') { node['h2-opts'] = { path: params.get('path') || '/' }; if (params.has('host')) node['h2-opts'].host = params.get('host').split(','); }
    else if (node.network === 'http') { node['http-opts'] = { path: [params.get('path') || '/'] }; if (params.has('host')) node['http-opts'].headers = { Host: params.get('host').split(',') }; }
    else if (params.has('path') || params.has('host') || params.has('serviceName')) invalid('节点 URI 传输参数不匹配');
  }
  return node;
}

/** Imports only proxy outbounds; provider rules, listeners and scripts never cross this boundary. */
export function parseProxySubscription(source) {
  if (typeof source !== 'string' || !source.trim()) invalid('订阅内容为空');
  if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) invalid('订阅内容超过 1 MB 限制');
  let content = source.trim().replace(/^\ufeff/, '');
  let format = 'uri';
  if (/^[a-z0-9+/_=\s-]+$/i.test(content) && !content.includes('://')) {
    content = decode64(content.replace(/\s/g, '')).trim(); format = 'base64';
  }
  const warnings = []; let nodes;
  const uriLines = content.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (uriLines.length && /^[a-z0-9+.-]+:\/\//i.test(uriLines[0])) {
    nodes = uriLines;
  } else {
    try {
      const document = parseDocument(content, { strict: true, uniqueKeys: true, merge: false, customTags: [] });
      if (document.errors.length || document.warnings.length) invalid();
      const data = document.toJS({ maxAliasCount: 0 });
      if (Array.isArray(data)) nodes = data;
      else if (data && Array.isArray(data.proxies)) {
        nodes = data.proxies;
        if (Object.keys(data).some(key => key !== 'proxies')) warnings.push('仅导入订阅节点；订阅内的规则、代理组、监听端口等设置不会应用');
      } else invalid();
      format = /^[\[{]/.test(content) ? 'json' : 'clash';
    } catch { invalid('无法读取订阅：需要 Clash YAML/JSON 或节点 URI 列表'); }
  }
  if (!nodes.length) invalid('订阅未包含节点');
  if (nodes.length > MAX_NODES) invalid('订阅节点超过 500 个限制');
  const entries = []; const seen = new Set();
  for (const [index, input] of nodes.entries()) {
    let raw;
    try {
      raw = typeof input === 'string' ? uriNode(input) : record(input);
      const type = raw.type === 'hy2' ? 'hysteria2' : raw.type;
      if (!SUPPORTED.has(type)) invalid('暂不支持此节点协议，仅支持 VLESS、Hysteria2 和 SS');
      const config = validateSubscriptionProxy({ node: raw });
      if(type==='hysteria2'&&raw['skip-cert-verify']===true)warnings.push(raw.fingerprint?'已移除跳过验证标记，使用订阅提供的 SHA-256 证书指纹校验':'已移除跳过验证标记，强制校验证书链与 TLS 名称');
      if (seen.has(config.nodeId)) { warnings.push(`第 ${index + 1} 个节点与已有节点相同，已合并`); continue; }
      seen.add(config.nodeId); entries.push(config);
    } catch (error) {
      // Only errors created here are surfaced. Native URL/YAML errors can contain credentials.
      const reason = error instanceof TypeError || !error?.message || error.message.length > 90 || /[\r\n]|:\/\//.test(error.message) ? '节点格式无效，无法安全导入' : error.message;
      const protocol = raw && ['vless', 'hysteria2', 'hy2', 'ss', 'trojan', 'vmess', 'socks5', 'http', 'https'].includes(raw.type) ? raw.type : 'unknown';
      entries.push({ unsupported: true, name: safeName(raw?.name, `节点 ${index + 1}`), protocol, reason });
      warnings.push(`第 ${index + 1} 个节点：${reason}`);
    }
  }
  return { entries, warnings, format };
}
