import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProxySubscription, validateSubscriptionProxy } from '../../../src/features/proxy/subscription-import.mjs';

const uuid = '12345678-1234-4234-8234-123456789abc';
const base = { name: '测试节点', type: 'vless', server: 'edge.example.com', port: 443, uuid, tls: true };
const imported = node => parseProxySubscription(JSON.stringify({ proxies: [node] }));

test('imports Clash YAML nodes without importing provider rules or listeners', () => {
  const result = parseProxySubscription(`mixed-port: 7890
rules: [MATCH,DIRECT]
proxies:
  - name: Family
    type: vless
    server: edge.example.com
    port: 443
    uuid: ${uuid}
    tls: true
    network: ws
    servername: tls.example.com
    ws-opts:
      path: /stream
      headers: {Host: tls.example.com}
`);
  assert.equal(result.format, 'clash');
  assert.equal(result.entries.length, 1);
  assert.equal(result.warnings.length, 1);
  const config = result.entries[0];
  assert.equal(config.protocol, 'vless');
  assert.equal(config.host, 'edge.example.com');
  assert.equal(config.node['ws-opts'].headers.Host, 'tls.example.com');
  assert.equal(config.node['ws-opts'].path, '/stream');
  assert.equal(config.node.servername, 'tls.example.com');
  assert.equal(config.password, '');
  assert.equal(config.node['mixed-port'], undefined);
});

test('VLESS URI supports TLS Reality, transport options and stable node identities', () => {
  const uri = `vless://${uuid}@edge.example.com:443?encryption=none&security=reality&sni=tls.example.com&fp=chrome&pbk=${'A'.repeat(43)}&sid=12abcd&flow=xtls-rprx-vision&type=tcp#Home`;
  const result = parseProxySubscription(uri);
  assert.equal(result.warnings.length, 0);
  const config = result.entries[0];
  assert.equal(config.node['reality-opts']['short-id'], '12abcd');
  assert.equal(config.node.flow, 'xtls-rprx-vision');
  assert.equal(config.node.tls, true);
  assert.equal(config.name, 'Home');
  const renamed = validateSubscriptionProxy({ ...config, name: 'Renamed', nodeId: 'untrusted' });
  assert.equal(config.nodeId, renamed.nodeId);
  const reordered = validateSubscriptionProxy({ node: { tls: true, port: 443, type: 'vless', uuid, server: 'edge.example.com', name: 'Other' } });
  assert.equal(imported(base).entries[0].nodeId, reordered.nodeId);
  assert.notEqual(config.nodeId, validateSubscriptionProxy({ ...config, host: '203.0.113.8', node: { ...config.node, server: '203.0.113.8' } }).nodeId);
});

test('imports URI lists and wrapped Base64 with websocket/grpc parameters decoded once', () => {
  const ws = `vless://${uuid}@edge.example.com:443?security=tls&type=ws&path=%2Fproxy%3Fed%3D2048&host=front.example.com#Family%20WS`;
  const grpc = `vless://${uuid}@other.example.com:443?security=tls&type=grpc&serviceName=chat%2Fstream#RPC`;
  const result = parseProxySubscription(Buffer.from(`${ws}\n${grpc}`).toString('base64'));
  assert.equal(result.format, 'base64');
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].name, 'Family WS');
  assert.equal(result.entries[0].node['ws-opts'].path, '/proxy?ed=2048');
  assert.equal(result.entries[1].node['grpc-opts']['grpc-service-name'], 'chat/stream');
});

test('Hysteria2 URI and YAML preserve authenticated TLS, obfuscation and port hopping', () => {
  const result = parseProxySubscription('hy2://user%3Aexample%40secret@edge.example.com:8443?sni=tls.example.com&obfs=salamander&obfs-password=obfuscated&alpn=h3#Family');
  const config = result.entries[0];
  assert.equal(config.protocol, 'hysteria2');
  assert.equal(config.node.password, 'user:example@secret');
  assert.equal(config.node.sni, 'tls.example.com');
  assert.equal(config.node.obfs, 'salamander');
  assert.deepEqual(config.node.alpn, ['h3']);
  const hopping = imported({ name: 'Family', type: 'hysteria2', server: 'edge.example.com', port: 443, password: 'test-password', 'skip-cert-verify': false, ports: '443,10000-11000', mport: '443,10000-11000', 'hop-interval': 30, up: '30 Mbps', down: 200 }).entries[0];
  assert.equal(hopping.node.ports, '443,10000-11000');
  assert.equal(hopping.node.mport, undefined);
  assert.equal(hopping.node.down, '200');
  assert.equal(hopping.node['skip-cert-verify'], undefined);
  assert.equal(parseProxySubscription('hysteria2://password@edge.example.com#Default').entries[0].port, 443);
});

test('SS accepts SIP002 base64 userinfo, plain userinfo and legacy full Base64, IPv6, password colon', () => {
  const credentials = 'aes-128-gcm:example:password';
  const sip = `ss://${Buffer.from(credentials).toString('base64url')}@[2001:db8::1]:8388#Home`;
  const config = parseProxySubscription(sip).entries[0];
  assert.equal(config.host, '2001:db8::1');
  assert.equal(config.node.cipher, 'aes-128-gcm');
  assert.equal(config.node.password, 'example:password');
  const legacy = `ss://${Buffer.from(`${credentials}@edge.example.com:8388`).toString('base64')}#Legacy`;
  assert.equal(parseProxySubscription(legacy).entries[0].node.password, 'example:password');
  assert.equal(parseProxySubscription('ss://aes-256-gcm:example%40pw@edge.example.com:8388#Plain').entries[0].node.password, 'example@pw');
});

test('ECH settings remain bounded node data for secure main-process resolution', () => {
  const config = imported({ ...base, network: 'ws', 'ech-opts': { enable: true, 'query-server-name': 'ech.example.com' } }).entries[0];
  assert.deepEqual(config.node['ech-opts'], { enable: true, 'query-server-name': 'ech.example.com' });
  const resolved = validateSubscriptionProxy({ ...config, node: { ...config.node, 'ech-opts': { enable: true, config: 'AQIDBA==' } } });
  assert.equal(resolved.node['ech-opts'].config, 'AQIDBA==');
  assert.equal(imported({ ...base, tls: false, 'ech-opts': { enable: true, 'query-server-name': 'ech.example.com' } }).entries[0].unsupported, true);
});

test('keeps unsupported/unsafe nodes visible with disabled reason and deduplicates connections', () => {
  const result = parseProxySubscription(JSON.stringify({ proxies: [base, { ...base, name: 'Same connection' }, { name: 'Old protocol', type: 'vmess', server: 'edge.example.com' }, { ...base, name: 'Insecure', 'skip-cert-verify': true }] }));
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries[1].unsupported, true);
  assert.equal(result.entries[1].protocol, 'vmess');
  assert.equal(result.entries[2].unsupported, true);
  assert.match(result.entries[2].reason, /证书验证/);
  assert.equal(result.warnings.length, 3);
});

test('rejects routing, executable plugins, arbitrary headers, invalid nested and unsafe TLS settings', () => {
  const malicious = [
    { 'dialer-proxy': 'DIRECT' }, { 'interface-name': 'en0' }, { 'routing-mark': 1 }, { script: 'anything' },
    { 'skip-cert-verify': true }, { 'skip-cert-verify': 'false' }, { network: 'xhttp' },
    { network: 'ws', 'ws-opts': { headers: { Authorization: 'secret-test' } } },
    { network: 'grpc', 'grpc-opts': { 'grpc-service-name': 'stream', 'dialer-proxy': 'DIRECT' } },
    { 'reality-opts': { 'public-key': 'bad', 'short-id': 'xxx' } },
    { 'ech-opts': { enable: true, 'query-server-name': 'http://invalid.example' } },
  ];
  for (const extra of malicious) assert.equal(imported({ ...base, ...extra }).entries[0].unsupported, true);
  assert.equal(parseProxySubscription('ss://aes-128-gcm:password@edge.example.com:443?plugin=executable#Bad').entries[0].unsupported, true);
  assert.equal(parseProxySubscription(`vless://${uuid}@edge.example.com:443?security=tls&allowInsecure=1`).entries[0].unsupported, true);
  assert.equal(imported({ name: 'H2', type: 'hysteria2', server: 'edge.example.com', port: 443, password: 'example', ports: '65535-65536' }).entries[0].unsupported, true);
});

test('revalidates persisted connection metadata and never trusts supplied IDs or extra node fields', () => {
  const config = imported(base).entries[0];
  assert.throws(() => validateSubscriptionProxy({ ...config, host: 'other.example.com' }), /不一致/);
  assert.throws(() => validateSubscriptionProxy({ ...config, port: 8443 }), /不一致/);
  assert.throws(() => validateSubscriptionProxy({ ...config, protocol: 'ss' }), /不一致/);
  assert.throws(() => validateSubscriptionProxy({ ...config, node: { ...config.node, 'dialer-proxy': 'DIRECT' } }), /不支持/);
  assert.throws(() => validateSubscriptionProxy({ ...config, node: { ...config.node, server: 'bad.example.com/path' } }));
});

test('malformed inputs and parser diagnostics never echo credentials or provider content', () => {
  const secret = 'TOP_SECRET_TEST_CREDENTIAL';
  for (const input of [`proxies: [${secret}`, `ss://${secret}@bad host:443`, `hy2://${secret}@edge.example.com:bad`, `proxies: &x [*x]`, `proxies: !!js/function ${secret}`, 'proxies: []']) {
    let result;
    try { result = parseProxySubscription(input); }
    catch (error) { result = { error: error.message }; }
    assert.ok(!JSON.stringify(result).includes(secret));
  }
  assert.throws(() => parseProxySubscription('a'.repeat(1024 * 1024 + 1)), /1 MB/);
  assert.throws(() => parseProxySubscription(JSON.stringify({ proxies: Array.from({ length: 501 }, () => base) })), /500/);
  assert.throws(() => parseProxySubscription(''), /为空/);
});

test('Hy2 with a subscription certificate pin stays authenticated without enabling insecure TLS',()=>{
 const raw={name:'Pinned Hy2',type:'hysteria2',server:'edge.example.com',port:443,password:'secret',sni:'www.bing.com',fingerprint:'ab'.repeat(32),'skip-cert-verify':true};
 const parsed=imported(raw).entries[0];assert.equal(parsed.unsupported,undefined);assert.equal(parsed.node.fingerprint,'ab'.repeat(32));assert.equal(parsed.node['skip-cert-verify'],undefined);
 const ca=imported({...raw,fingerprint:undefined});assert.equal(ca.entries[0].unsupported,undefined);assert.equal(ca.entries[0].node['skip-cert-verify'],undefined);assert.match(ca.warnings.join(' '),/强制校验证书链/);
 assert.equal(imported({...raw,fingerprint:'invalid'}).entries[0].unsupported,true);
});
test('fixed relay is a bounded TLS VLESS dependency and changes the egress identity',()=>{
 const target={type:'ss',server:'exit.example.com',port:443,cipher:'aes-256-gcm',password:'secret'};
 const direct=validateSubscriptionProxy({node:target});const chain=validateSubscriptionProxy({node:{...target,relay:base}});
 assert.notEqual(chain.nodeId,direct.nodeId);assert.equal(chain.node.relay.type,'vless');
 assert.equal(validateSubscriptionProxy({node:{...target,relay:{...base,name:'Renamed'}}}).nodeId,chain.nodeId);
 for(const relay of [{...base,tls:false},{...base,relay:base},{...base,'dialer-proxy':'DIRECT'},{...target}])assert.throws(()=>validateSubscriptionProxy({node:{...target,relay}}));
});
