import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import path from 'node:path';
import vm from 'node:vm';
import { parseProxySubscription } from '../../../src/features/proxy/subscription-import.mjs';
import { parseIproyalExport } from '../../../src/features/proxy/iproyal-import.mjs';
import { validateProxy } from '../../../src/features/proxy/proxy.mjs';
import { parseProxyImport } from '../../../src/features/proxy/proxy-import.mjs';

// Execute production IPC handlers against isolated account/environment state. No Electron,
// real network, saved configuration, or real credentials participate in these tests.
const main = await readFile(new URL('../../../src/app/main.mjs', import.meta.url), 'utf8');
const registration = name => {
  const marker = `ipcMain.handle('${name}',`;
  const start = main.indexOf(marker);
  assert.ok(start >= 0, `${name} is registered`);
  const end = main.indexOf('\nipcMain.handle(', start + marker.length);
  assert.ok(end > start);
  return main.slice(start, end);
};
function harness({ content = '', fetch = async () => content } = {}) {
  const handlers = new Map();
  const context = vm.createContext({
    pendingImport: null, connecting: false, activeContainerId: 'env-a', owner: 'owner-a',
    dockerOwner: () => context.owner,
    guarded: fn => fn,
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    clipboard: { readText: () => content },
    parseProxySubscription, parseIproyalExport, parseProxyImport, validateProxy,
    fetchProxySubscription: fetch, randomUUID, path,
    stat: async () => ({ isFile: () => true, size: Buffer.byteLength(content) }),
    readFile: async () => content,
  });
  for (const name of ['workspace:importIproyal', 'workspace:applyIproyal']) vm.runInContext(registration(name), context);
  return { context, import: params => handlers.get('workspace:importIproyal')(params), apply: params => handlers.get('workspace:applyIproyal')(params) };
}
const uuid = '12345678-1234-4234-8234-123456789abc';
const node = { name: 'Home', type: 'vless', server: 'edge.example.com', port: 443, uuid, tls: true };
const subscription = JSON.stringify({ proxies: [node] });

test('generic importer retains existing pasted and file-based IPRoyal CSV behavior', async () => {
  const content = 'Host,Port,User,Pass\n203.0.113.10,8080,example-user,example-password';
  for (const params of [{ source: 'text', text: content }, { source: 'file', filePath: '/fixture/proxy.csv' }]) {
    const h = harness({ content });
    const preview = await h.import(params);
    assert.equal(preview.format, 'csv');
    assert.equal(preview.entries.length, 1);
    assert.equal(preview.entries[0].host, '203.0.113.10');
    assert.equal(preview.entries[0].authenticated, true);
    assert.ok(!JSON.stringify(preview).includes('example-password'));
    const selected = await h.apply({ batchId: preview.batchId, index: 0 });
    assert.equal(selected.protocol, 'http');
    assert.equal(selected.password, 'example-password');
    assert.equal(selected.importScope.environment, 'env-a');
  }
});

test('subscription preview hides connection secrets and import only creates an environment-scoped draft', async () => {
  const h = harness({ content: subscription });
  const preview = await h.import({ source: 'subscription', subscriptionURL: 'https://provider.example/subscription/secret-token' });
  const publicText = JSON.stringify(preview);
  assert.ok(!publicText.includes(uuid));
  assert.ok(!publicText.includes('secret-token'));
  assert.ok(!publicText.includes('"node":'));
  assert.equal(preview.entries[0].name, 'Home');
  const selected = await h.apply({ batchId: preview.batchId, index: 0 });
  assert.equal(selected.node.uuid, uuid);
  assert.equal(selected.importScope.owner, 'owner-a');
  assert.equal(selected.importScope.environment, 'env-a');
  assert.equal(h.context.pendingImport, null);
});

test('delayed subscription fetch cannot publish a draft after account or environment changes', async () => {
  for (const changed of ['owner', 'activeContainerId']) {
    let finish;
    const h = harness({ fetch: () => new Promise(resolve => { finish = resolve; }) });
    const pending = h.import({ source: 'subscription', subscriptionURL: 'https://provider.example/sub' });
    h.context[changed] = 'different';
    finish(subscription);
    await assert.rejects(pending, /账号或环境已变化/);
    assert.equal(h.context.pendingImport, null);
  }
});

test('preview selection rejects cross-account/environment and expired drafts', async () => {
  for (const changed of ['owner', 'activeContainerId']) {
    const h = harness({ content: subscription });
    const preview = await h.import({ source: 'text', text: subscription });
    h.context[changed] = 'different';
    await assert.rejects(h.apply({ batchId: preview.batchId, index: 0 }), /账号或环境已变化/);
  }
  const h = harness({ content: subscription });
  const preview = await h.import({ source: 'text', text: subscription });
  h.context.pendingImport.expires = Date.now() - 1;
  await assert.rejects(h.apply({ batchId: preview.batchId, index: 0 }), /已过期/);
});

test('unsupported and insecure nodes remain visible but cannot be selected', async () => {
  const h = harness();
  const preview = await h.import({ source: 'text', text: JSON.stringify({ proxies: [{ ...node, 'skip-cert-verify': true }, { name: 'Legacy', type: 'vmess' }] }) });
  assert.equal(preview.entries.length, 2);
  for (const entry of preview.entries) {
    assert.equal(entry.unsupported, true);
    assert.ok(entry.reason);
    await assert.rejects(h.apply({ batchId: preview.batchId, index: entry.index }));
  }
});

test('connecting locks before asynchronous DNS/ECH preparation and aborts on account/environment drift', async () => {
  const start = main.indexOf('async function connect(config, remember,');
  const end = main.indexOf('\nasync function createWindow()', start);
  assert.ok(start > 0 && end > start);
  for (const changed of ['owner', 'activeContainerId']) {
    let resolvePreparation, preparationStarted;
    const entered = new Promise(resolve => { preparationStarted = resolve; });
    const touched = [];
    const context = vm.createContext({
      accountChanging: false, containerOperation: false, browserRoutingChanging: false,
      connecting: false, pinsLoadError: false, owner: 'owner-a', activeContainerId: 'env-a',
      shutdown: { requested: false }, browserTabs: new Map(), isIP, validateProxy,
      requireActiveEnvironment() {}, dockerOwner: () => context.owner,
      recordEnvironmentEvent() {},
      prepareSubscriptionProxy: config => { preparationStarted(); return new Promise(resolve => { resolvePreparation = () => resolve(config); }); },
      stopGateway: async () => { touched.push('stop'); },
      saveConfig: async () => { touched.push('save'); },
    });
    vm.runInContext(main.slice(start, end), context);
    const connect = vm.runInContext('connect', context);
    const config = parseProxySubscription(subscription).entries[0];
    const first = connect(config, true);
    assert.equal(context.connecting, true, 'lock is held before any async preparation');
    await entered;
    await assert.rejects(connect(config, true), /正在连接/);
    context[changed] = 'different';
    resolvePreparation();
    await assert.rejects(first, /账号或环境已变化/);
    assert.deepEqual(touched, [], 'stale credentials never stop, launch, or save against the new scope');
    assert.equal(context.connecting, false, 'lock is released after rejection');
  }
});

test('subscription verification pins the captured owner/environment and rejects late callbacks after a switch', async () => {
  const start = main.indexOf('async function connect(config, remember,');
  const end = main.indexOf('\nasync function createWindow()', start);
  const writes = [], identities = [];
  let next;
  class FakeGateway {
    constructor(_config, options) { this.options = options; next = this; }
    async start() { return this; }
    on() {}
    startMonitoring() {}
    async verify() { await this.options.onVerified('203.0.113.22'); return { state: 'ready', ip: '203.0.113.22' }; }
  }
  const context = vm.createContext({
    accountChanging: false, containerOperation: false, browserRoutingChanging: false,
    connecting: false, pinsLoadError: false, owner: 'owner-a', activeContainerId: null,
    shutdown: { requested: false }, browserTabs: new Map(), configuredBrowserSessions: new Map(),
    isIP, validateProxy, requireActiveEnvironment() {}, dockerOwner: () => context.owner,
    recordEnvironmentEvent() {}, prepareSubscriptionProxy: async config => config,
    stopGateway: async () => {}, saveConfig: async () => {}, emit() {},
    browserProxyConfiguration: async () => ({}), egressPins: { scoped: '203.0.113.22' },
    proxyIdentity: (_config, scope) => { identities.push({ ...scope }); return 'scoped'; },
    saveEgressPin: (_config, ip, scope) => { writes.push({ ip, ...scope }); },
    ProxyGateway: FakeGateway, path, here: '/fixture/src', process: { platform: 'linux', arch: 'x64', env: {} },
    fixtureMode: true, probeUrl: 'https://probe.example/', gateway: null,
  });
  vm.runInContext(main.slice(start, end), context);
  const status = await vm.runInContext('connect', context)(parseProxySubscription(subscription).entries[0], true);
  assert.equal(status.state, 'ready');
  assert.equal(next.options.expectedIp, '203.0.113.22');
  assert.deepEqual(identities, [{ owner: 'owner-a', environment: null }]);
  assert.deepEqual(writes, [{ ip: '203.0.113.22', owner: 'owner-a', environment: null }]);
  context.owner = 'owner-b';
  assert.throws(() => next.options.onVerified('203.0.113.23'), /账号或环境已变化/);
  assert.equal(writes.length, 1, 'late health checks cannot create a pin under another account');
});

test('relay selection uses only the current scoped import batch and keeps credentials out of preview',async()=>{
 const content=JSON.stringify({proxies:[node,{name:'Pinned Hy2',type:'hysteria2',server:'hy.example.com',port:443,password:'hy-secret',fingerprint:'ab'.repeat(32),'skip-cert-verify':true}]});
 const h=harness({content});
 // vm-created envelopes cross a realm in this harness; production handlers share one realm.
 h.context.validateProxy=value=>validateProxy(JSON.parse(JSON.stringify(value)));
 const preview=await h.import({source:'subscription',subscriptionURL:'https://provider.example/sub'});
 assert.equal(preview.entries[0].relayEligible,true);assert.ok(!JSON.stringify(preview).includes('hy-secret'));
 await assert.rejects(h.apply({batchId:preview.batchId,index:1,relayIndex:1}),/其他/);
 await assert.rejects(h.apply({batchId:preview.batchId,index:0,relayIndex:1}),/VLESS/);
 const selected=await h.apply({batchId:preview.batchId,index:1,relayIndex:0});
 assert.equal(selected.node.relay.uuid,uuid);assert.equal(selected.importScope.environment,'env-a');assert.equal(selected.node['skip-cert-verify'],undefined);
});
