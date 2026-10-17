import { validateProxy } from './proxy.mjs';

const aliases = {
  host: 'host', hostname: 'host', ip: 'host', address: 'host', proxyhost: 'host', proxyip: 'host', 主机: 'host', 地址: 'host',
  port: 'port', proxyport: 'port', 端口: 'port',
  user: 'username', username: 'username', proxyuser: 'username', proxyusername: 'username', 用户名: 'username',
  pass: 'password', password: 'password', proxypass: 'password', proxypassword: 'password', 密码: 'password',
  protocol: 'protocol', scheme: 'protocol', 协议: 'protocol',
};
const normalizeHeader = value => value.trim().toLowerCase().replace(/[\s_-]/g, '');
function protocol(value) {
  const text = String(value).toLowerCase().trim();
  if (text === 'http/https' || text === 'http|https') return 'http';
  if (!['http', 'https', 'socks5'].includes(text)) throw new Error('协议必须为 HTTP、HTTPS 或 SOCKS5');
  return text;
}
function hostPort(value) {
  const match = /^(\[[^\]]+\]|[^:\s/@]+):(\d{1,5})$/.exec(value);
  return match ? { host: match[1].replace(/^\[|\]$/g, ''), port: match[2] } : null;
}
function pair(value) {
  const index = value.indexOf(':');
  if (index < 1) throw new Error('缺少用户名或密码字段');
  return { username: value.slice(0, index), password: value.slice(index + 1) };
}
function parseLine(raw, defaultProtocol) {
  const line = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) {
    let url;
    try { url = new URL(line); } catch { throw new Error('代理 URL 格式无效'); }
    if ((url.pathname && url.pathname !== '/') || url.search || url.hash) throw new Error('代理 URL 不能包含路径、查询参数或片段');
    let username, password;
    try { username = decodeURIComponent(url.username); password = decodeURIComponent(url.password); } catch { throw new Error('URL 中的凭据编码无效'); }
    return { protocol: protocol(url.protocol.slice(0, -1)), host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port, username, password };
  }
  // The dashboard supports both endpoint@credentials and credentials@endpoint.
  // Prefer the standard host:port:user:password form first, so '@' in a password is preserved.
  const colon = /^(\[[^\]]+\]|[^:\s/@]+):(\d{1,5}):([^:]+):(.*)$/.exec(line);
  if (colon) return { protocol: defaultProtocol, host: colon[1].replace(/^\[|\]$/g, ''), port: colon[2], username: colon[3], password: colon[4] };
  const at = line.indexOf('@');
  if (at >= 0) {
    const left = line.slice(0, at), right = line.slice(at + 1);
    const endpointLeft = hostPort(left), endpointRight = hostPort(right);
    if (endpointLeft && endpointRight) throw new Error('此格式有歧义，请使用 host:port:user:password 或带协议的 URL');
    if (endpointLeft) return { protocol: defaultProtocol, ...endpointLeft, ...pair(right) };
    if (endpointRight) return { protocol: defaultProtocol, ...endpointRight, ...pair(left) };
    throw new Error('无法识别代理地址与凭据，请使用标准导出格式');
  }
  const endpoint = hostPort(line);
  if (endpoint) return { protocol: defaultProtocol, ...endpoint, username: '', password: '' };
  throw new Error('应为 host:port:user:password、host:port@user:password 或代理 URL');
}
function csvRows(text) {
  const rows = []; let fields = [], field = '', quoted = false, afterQuote = false, rowLine = 1, line = 1;
  const finishField = () => { fields.push(field); field = ''; afterQuote = false; };
  const finishRow = () => { finishField(); if (fields.some(value => value.trim())) rows.push({ fields, line: rowLine }); fields = []; rowLine = line + 1; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; afterQuote = true; } }
      else { field += char; if (char === '\n') line++; }
    } else if (char === ',') finishField();
    else if (char === '\n') { finishRow(); line++; }
    else if (char === '"') { if (field.trim() || afterQuote) throw new Error(`第 ${line} 行：CSV 引号位置无效`); field = ''; quoted = true; }
    else if (afterQuote) { if (!/\s/.test(char)) throw new Error(`第 ${line} 行：CSV 引号后有无效内容`); }
    else field += char;
  }
  if (quoted) throw new Error(`第 ${rowLine} 行：CSV 引号未闭合`);
  if (field || fields.length || afterQuote) finishRow();
  return rows;
}
export function parseIproyalExport(source, { defaultProtocol = 'http', format = 'auto' } = {}) {
  if (typeof source !== 'string' || source.length > 1024 * 1024) throw new Error('导入内容应为文本，且不能超过 1 MB');
  const selectedProtocol = protocol(defaultProtocol);
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new Error('没有读取到代理内容，请先复制 IPRoyal 导出列表');
  let rows;
  if (format === 'csv' || (format === 'auto' && text.split('\n').find(x => x.trim())?.includes(','))) {
    rows = csvRows(text);
    const first = rows[0]?.fields || [];
    const headerLike = first.some(value => aliases[normalizeHeader(value)]) && first.length > 1;
    const dataLike = first.length >= 4 && /^\d+$/.test(first[1]?.trim());
    if (format !== 'csv' && !headerLike && !dataLike) rows = null;
  }
  const entries = [];
  const add = (config, line) => {
    try { entries.push({ ...validateProxy(config), sourceLine: line }); }
    catch { throw new Error(`第 ${line} 行：代理字段无效，请检查协议、地址、端口和凭据格式`); }
    if (entries.length > 500) throw new Error('一次最多导入 500 条代理，请拆分导出文件');
  };
  if (rows) {
    const mapped = rows[0].fields.map(value => aliases[normalizeHeader(value)]);
    const hasHeader = mapped.includes('host') || mapped.includes('port');
    const columns = hasHeader ? mapped : ['host', 'port', 'username', 'password'];
    if (hasHeader && (!columns.includes('host') || !columns.includes('port') || columns.some(x => !x) || new Set(columns).size !== columns.length)) throw new Error('CSV 表头应包含 Host、Port，可选 User、Pass、Protocol，且不能重复');
    for (const row of rows.slice(hasHeader ? 1 : 0)) {
      if (row.fields.length !== columns.length) throw new Error(`第 ${row.line} 行：CSV 列数与表头不一致`);
      const values = Object.fromEntries(columns.map((key, index) => [key, row.fields[index]]));
      let scheme;
      try { scheme = values.protocol ? protocol(values.protocol) : selectedProtocol; } catch { throw new Error(`第 ${row.line} 行：不支持的协议`); }
      add({ ...values, protocol: scheme }, row.line);
    }
  } else {
    text.split('\n').forEach((line, index) => {
      if (!line.trim()) return;
      let parsed;
      try { parsed = parseLine(line, selectedProtocol); }
      catch (error) { throw new Error(`第 ${index + 1} 行：${error.message}`); }
      add(parsed, index + 1);
    });
  }
  if (!entries.length) throw new Error('导出文件只有表头，没有代理记录');
  const warnings = [];
  if (entries.some(item => /(^|\.)(geo|proxy|us|sg)\.iproyal\.com$/i.test(item.host) || /_(session|lifetime|country)-/.test(item.password))) warnings.push('此列表可能使用住宅网关或会话参数；导入不会把轮换代理变成固定 IP，请确认购买的是静态 ISP 或固定出口。');
  return { entries, format: rows ? 'csv' : 'txt', warnings };
}
