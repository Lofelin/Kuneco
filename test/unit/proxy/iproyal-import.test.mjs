import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIproyalExport } from '../../../src/features/proxy/iproyal-import.mjs';

const expected = { protocol: 'http', host: '203.0.113.42', port: 12323, username: 'example_user', password: 'example_pw' };
const config = result => { const { sourceLine, ...rest } = result.entries[0]; return rest; };

test('用户导出 TXT 与 Host,Port,User,Pass CSV 的结构解析一致', () => {
  const txt = '203.0.113.42:12323:example_user:example_pw\n';
  const csv = 'Host,Port,User,Pass\n203.0.113.42,12323,example_user,example_pw\n';
  assert.deepEqual(config(parseIproyalExport(txt)), expected);
  assert.deepEqual(config(parseIproyalExport(csv)), expected);
});
test('CSV 支持 BOM、CRLF、引号、逗号与转义双引号，凭据保持原样', () => {
  const raw = '\uFEFFHost,Port,User,Pass\r\n203.0.113.42,12323,"example_user","pw,with:colon@and""quote"\r\n';
  assert.equal(parseIproyalExport(raw).entries[0].password, 'pw,with:colon@and"quote');
});
test('保留 TXT 密码中的冒号、@ 和网关会话后缀', () => {
  const password = 'pw:segment@tail_country-us_session-test_lifetime-24h';
  const parsed = parseIproyalExport(`geo.iproyal.com:12321:example_user:${password}`);
  assert.equal(parsed.entries[0].password, password); assert.equal(parsed.warnings.length, 1);
});
test('没有协议时使用用户选择的协议，不根据端口猜测或改写', () => {
  const parsed = parseIproyalExport('203.0.113.42:12324:example_user:example_pw', { defaultProtocol: 'socks5' });
  assert.equal(parsed.entries[0].protocol, 'socks5'); assert.equal(parsed.entries[0].port, 12324);
});
test('支持带协议 URL，按 URL 规则解码凭据', () => {
  const parsed = parseIproyalExport('socks5://user%40mail:pw%3A%40%25@203.0.113.42:12324');
  assert.deepEqual(config(parsed), { protocol: 'socks5', host: '203.0.113.42', port: 12324, username: 'user@mail', password: 'pw:@%' });
});
test('支持两种 @ 导出顺序和无凭据白名单格式', () => {
  assert.deepEqual(config(parseIproyalExport('203.0.113.42:12323@example_user:example_pw')), expected);
  assert.deepEqual(config(parseIproyalExport('example_user:example_pw@203.0.113.42:12323')), expected);
  assert.equal(parseIproyalExport('203.0.113.42:12323').entries[0].username, '');
});
test('多条列表完整解析，不自动择一或联网', () => {
  const parsed = parseIproyalExport('Host,Port,User,Pass\n203.0.113.42,12323,user1,pw1\n203.0.113.43,12323,user2,pw2\n');
  assert.equal(parsed.entries.length, 2); assert.equal(parsed.entries[1].host, '203.0.113.43');
});
test('格式错误包含行号，但绝不回显原始密码', () => {
  const secret = 'DO_NOT_EXPOSE_PRIVATE_SECRET';
  for (const raw of [`203.0.113.42:99999:user:${secret}`, `Host,Port,User,Pass\n203.0.113.42,12323,${secret}`, `ftp://user:${secret}@203.0.113.42:12323`, `Host,Port,User,Pass\n203.0.113.42,12323,user,"${secret}`]) {
    assert.throws(() => parseIproyalExport(raw), error => !error.message.includes(secret));
  }
});
test('拒绝空列表、无数据表头、重复表头、超大列表和 URL 中的额外路径', () => {
  for (const raw of ['', 'Host,Port,User,Pass', 'Host,Port,Host,Pass\n203.0.113.42,12323,user,pw', 'http://user:pw@203.0.113.42:12323/path']) assert.throws(() => parseIproyalExport(raw));
  assert.throws(() => parseIproyalExport('203.0.113.42:12323:user:pw\n'.repeat(501)), /500/);
  assert.throws(() => parseIproyalExport('x'.repeat(1024 * 1024 + 1)), /1 MB/);
});
