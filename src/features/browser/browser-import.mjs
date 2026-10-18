const MAX_BYTES = 5 * 1024 * 1024;
const MAX_RECORDS = 5000;
function source(input) {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > MAX_BYTES) throw new Error('Import must be text smaller than 5 MB');
  return input.replace(/^\uFEFF/, '');
}
function webUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid import URL');
  let parsed; try { parsed = new URL(value); } catch { throw new Error('Invalid import URL'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid import URL');
  return parsed;
}
function domain(value) {
  if (typeof value !== 'string' || !value || value.length > 253 || /[\s/:@?#\\]/.test(value)) throw new Error('Invalid cookie domain');
  const host = value.replace(/^\./, '');
  if (!host || host.split('.').some(label => !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label))) throw new Error('Invalid cookie domain');
  return value.toLowerCase();
}
function cookie(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid cookie record');
  if (typeof record.name !== 'string' || !record.name || /[\x00-\x20\x7f()<>@,;:\\"/\[\]?={}]/.test(record.name)) throw new Error('Invalid cookie name');
  if (typeof record.value !== 'string' || /[\x00-\x1f\x7f;]/.test(record.value)) throw new Error('Invalid cookie value');
  for (const key of ['secure', 'httpOnly', 'session', 'hostOnly']) if (record[key] !== undefined && typeof record[key] !== 'boolean') throw new Error('Invalid cookie flags');
  const host = domain(record.domain);
  const cookiePath = record.path ?? '/';
  if (typeof cookiePath !== 'string' || !cookiePath.startsWith('/') || /[\x00-\x1f\x7f;]/.test(cookiePath)) throw new Error('Invalid cookie path');
  const secure = record.secure ?? false;
  const parsed = record.url ? webUrl(record.url) : new URL(`${secure ? 'https' : 'http'}://${host.replace(/^\./, '')}${cookiePath}`);
  const plainHost = host.replace(/^\./, '');
  if (parsed.hostname !== plainHost && (record.hostOnly || !parsed.hostname.endsWith(`.${plainHost}`))) throw new Error('Cookie URL does not match its domain');
  if (secure && parsed.protocol !== 'https:') throw new Error('Secure cookie requires HTTPS');
  const output = { url: parsed.href, name: record.name, value: record.value, path: cookiePath, secure, httpOnly: record.httpOnly ?? false };
  // Omitting domain preserves host-only semantics in Electron.
  if (record.hostOnly !== true) output.domain = host;
  const sameSite = record.sameSite ?? 'unspecified';
  const sameSiteMap = { unspecified: 'unspecified', no_restriction: 'no_restriction', none: 'no_restriction', lax: 'lax', strict: 'strict' };
  if (typeof sameSite !== 'string' || !Object.hasOwn(sameSiteMap, sameSite.toLowerCase())) throw new Error('Invalid cookie SameSite');
  output.sameSite = sameSiteMap[sameSite.toLowerCase()];
  if (output.sameSite === 'no_restriction' && !secure) throw new Error('SameSite=None cookie requires secure flag');
  const expires = record.expirationDate ?? record.expires;
  if (expires !== undefined && (typeof expires !== 'number' || !Number.isFinite(expires) || expires < -1)) throw new Error('Invalid cookie expiry');
  if (record.session !== true && expires !== undefined && expires !== -1 && expires !== 0) output.expirationDate = expires;
  if (record.session === false && (expires === undefined || expires <= 0)) throw new Error('Persistent cookie requires expiry');
  if (record.name.startsWith('__Secure-') && !secure) throw new Error('Invalid secure cookie prefix');
  if (record.name.startsWith('__Host-') && (!secure || cookiePath !== '/' || record.hostOnly === false || host.startsWith('.'))) throw new Error('Invalid host cookie prefix');
  if (record.name.startsWith('__Host-')) delete output.domain;
  return output;
}
function netscape(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;
    const fields = line.replace(/^#HttpOnly_/, '').split('\t');
    if (fields.length !== 7 || !['TRUE', 'FALSE'].includes(fields[1]) || !['TRUE', 'FALSE'].includes(fields[3]) || !/^\d+$/.test(fields[4])) throw new Error('Invalid Netscape cookie file');
    rows.push({ domain: fields[0], hostOnly: fields[1] === 'FALSE', path: fields[2], secure: fields[3] === 'TRUE', expirationDate: Number(fields[4]), session: Number(fields[4]) === 0, name: fields[5], value: fields[6], httpOnly: line.startsWith('#HttpOnly_') });
    if (rows.length > MAX_RECORDS) throw new Error('Import exceeds 5000 records');
  }
  return rows;
}
export function parseCookieImport(input) {
  const text = source(input); let records;
  if (/^[\s]*[\[{]/.test(text)) {
    let parsed; try { parsed = JSON.parse(text); } catch { throw new Error('Invalid cookie JSON'); }
    records = Array.isArray(parsed) ? parsed : parsed?.cookies;
  } else records = netscape(text);
  if (!Array.isArray(records) || !records.length || records.length > MAX_RECORDS) throw new Error('Cookie import must contain 1 to 5000 records');
  return records.map(cookie);
}
function csv(text) {
  const rows = []; let row = [], field = '', quoted = false, endedQuote = false;
  const cell = () => { row.push(field); field = ''; endedQuote = false; };
  const line = () => { cell(); if (row.some(v => v !== '')) rows.push(row); row = []; if (rows.length > MAX_RECORDS + 1) throw new Error('Import exceeds 5000 records'); };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; endedQuote = true; } } else field += ch; continue; }
    if (ch === ',') cell();
    else if (ch === '\r' || ch === '\n') { if (ch === '\r' && text[i + 1] === '\n') i++; line(); }
    else if (ch === '"' && !field && !endedQuote) quoted = true;
    else { if (endedQuote || ch === '"') throw new Error('Invalid password CSV quoting'); field += ch; }
  }
  if (quoted) throw new Error('Unterminated password CSV field');
  if (field || row.length || endedQuote) line();
  return rows;
}
export function parsePasswordImport(input) {
  const rows = csv(source(input));
  if (rows.length < 2 || rows.length > MAX_RECORDS + 1) throw new Error('Password import must contain 1 to 5000 records');
  const headers = rows.shift().map(v => v.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate password CSV column');
  const urlIndex = headers.includes('origin') ? headers.indexOf('origin') : headers.indexOf('url');
  const usernameIndex = headers.indexOf('username'), passwordIndex = headers.indexOf('password');
  if (urlIndex < 0 || usernameIndex < 0 || passwordIndex < 0) throw new Error('Password CSV requires URL, username and password columns');
  return rows.map(row => {
    if (row.length !== headers.length || !row[usernameIndex]?.trim() || !row[passwordIndex] || row[usernameIndex].length > 2048 || row[passwordIndex].length > 65536) throw new Error('Invalid password CSV record');
    return { origin: webUrl(row[urlIndex]).origin, username: row[usernameIndex], password: row[passwordIndex] };
  });
}
