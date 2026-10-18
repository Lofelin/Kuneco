import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCookieImport, parsePasswordImport } from '../../../src/features/browser/browser-import.mjs';
const base = { domain: '.example.com', name: 'session', value: 'abc', secure: true, httpOnly: true, path: '/', sameSite: 'lax', expirationDate: 1900000000 };
test('cookie JSON arrays and wrapped exports normalize to Electron cookie details', () => {
  const result = parseCookieImport(JSON.stringify([base]));
  assert.deepEqual(result[0], { url: 'https://example.com/', domain: '.example.com', name: 'session', value: 'abc', path: '/', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: 1900000000 });
  const host = parseCookieImport('\uFEFF' + JSON.stringify({ cookies: [{ ...base, domain: 'example.com', hostOnly: true, session: true, sameSite: 'None' }] }))[0];
  assert.equal(host.domain, undefined); assert.equal(host.expirationDate, undefined); assert.equal(host.sameSite, 'no_restriction');
});
test('cookie validation rejects entire malformed batch without exposing secrets', () => {
  for (const patch of [{ domain: 'example.com/secret' }, { url: 'file:///secret' }, { url: 'https://evil.test/' }, { secure: 'true' }, { name: 'bad;name' }, { value: 'secret\nsecret' }, { path: 'bad' }, { sameSite: 'invalid' }, { expirationDate: 'tomorrow' }, { secure: false, sameSite: 'none' }, { session: false, expirationDate: 0 }]) {
    assert.throws(() => parseCookieImport(JSON.stringify([base, { ...base, ...patch }])), error => !error.message.includes('secret'));
  }
  assert.throws(() => parseCookieImport('{secret-invalid-json'), error => !error.message.includes('secret-invalid'));
  assert.throws(() => parseCookieImport(JSON.stringify(Array(5001).fill(base))), /5000/);
  assert.throws(() => parseCookieImport('a'.repeat(5 * 1024 * 1024 + 1)), /5 MB/);
});
test('Netscape imports support HttpOnly prefix and session expiry', () => {
  const cookies = parseCookieImport('# Netscape HTTP Cookie File\n#HttpOnly_.example.com\tTRUE\t/\tTRUE\t1900000000\tsid\tsecret\nexample.com\tFALSE\t/\tFALSE\t0\tpref\tvalue\n');
  assert.equal(cookies[0].httpOnly, true); assert.equal(cookies[0].domain, '.example.com');
  assert.equal(cookies[1].domain, undefined); assert.equal(cookies[1].expirationDate, undefined);
  assert.throws(() => parseCookieImport('example.com\tINVALID\t/\tFALSE\t0\tname\tvalue'), /Invalid/);
});
test('secure cookie prefixes enforce their scope', () => {
  assert.throws(() => parseCookieImport(JSON.stringify([{ ...base, name: '__Secure-id', secure: false }])), /secure/);
  assert.throws(() => parseCookieImport(JSON.stringify([{ ...base, name: '__Host-id' }])), /host/);
  const c = parseCookieImport(JSON.stringify([{ ...base, name: '__Host-id', domain: 'example.com', hostOnly: true }]))[0];
  assert.equal(c.domain, undefined);
});
test('password CSV supports Chrome headers, BOM, quoted commas, quotes and multiline fields', () => {
  const result = parsePasswordImport('\uFEFFname,url,username,password,note\r\nExample,https://example.com/login,"a,b","line 1\nline ""2""",\r\n');
  assert.deepEqual(result, [{ origin: 'https://example.com', username: 'a,b', password: 'line 1\nline "2"' }]);
  assert.deepEqual(parsePasswordImport('origin,username,password\nhttp://localhost:3000,a,p'), [{ origin: 'http://localhost:3000', username: 'a', password: 'p' }]);
});
test('password CSV rejects malformed records, invalid URLs and limits without secrets in errors', () => {
  for (const input of ['url,password\nhttps://example.com,secret', 'url,username,password\nhttps://example.com,a,', 'url,username,password\nfile:///tmp,a,secret', 'url,username,password\nhttps://example.com,a,"secret', 'url,username,password\nhttps://example.com,a,"secret"oops', 'url,username,password\nhttps://example.com,a,secret,extra', 'url,username,password\nhttps://example.com,,secret', 'url,username,password,password\nhttps://example.com,a,secret,secret']) assert.throws(() => parsePasswordImport(input), error => !error.message.includes('secret'));
  assert.throws(() => parsePasswordImport('url,username,password\n' + 'https://example.com,a,p\n'.repeat(5001)), /5000/);
  assert.throws(() => parsePasswordImport('a'.repeat(5 * 1024 * 1024 + 1)), /5 MB/);
});
