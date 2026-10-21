import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAgentTool, ruleFor } from '../../../src/features/browser/browser-agent.mjs';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const scope = { owner: 'owner', environmentId: 'environment' };
  const controller = new AbortController();
  let accessMode='ask',running=true;let currentScope = { ...scope };
  const settings = { agentEnabled: true, siteTools: true, historyAccess: 'allow' };
  const data = { settings, agentRules: [{ pattern: '*', browse: 'allow', download: 'allow' }], history: [{ url: 'https://example.com' }] };
  const calls = { scripts: [], asks: [], downloads: [], navigations: [], opens: [] };
  const tab = { id: 'tab1', url: 'https://example.com/', title: 'Example', started: true, wc: { isDestroyed: () => false, getURL: () => tab.url, executeJavaScript: async code => { calls.scripts.push(code); return { ok: true }; }, downloadURL: url => calls.downloads.push(url), navigationHistory: { canGoBack: () => true, goBack: () => {} } } };
  const features = { preferences: () => settings, library: { get: async () => data }, ask: async (...args) => { calls.asks.push(args); return true; } };
  const tool = createBrowserAgentTool({ features, scope, signal: controller.signal, getScope: () => currentScope, getTabs: () => [tab], getActive: () => tab, openURL: url => { const created = { id: 'created', url }; calls.opens.push(created); return created; }, navigate: (target, url) => { calls.navigations.push(url); target.url = url; }, networkReady: () => true,getAccessMode:()=>accessMode,isRunning:()=>running });
  return { scope, controller, settings, data, calls, tab, features, tool, setScope: scope => { currentScope = scope; },setAccess:mode=>{accessMode=mode;},finish:()=>{running=false;} };
}
test('ruleFor respects exact, subdomain and default origins including ports and protocols', () => {
  const rules = [{ pattern: '*', browse: 'ask' }, { pattern: 'https://*.example.com', browse: 'allow' }, { pattern: 'https://example.com', browse: 'block' }, { pattern: 'https://private.example.com', browse: 'block' }];
  assert.equal(ruleFor(rules, 'https://example.com/path', 'browse'), 'block');
  assert.equal(ruleFor(rules, 'https://private.example.com/path', 'browse'), 'block');
  assert.equal(ruleFor(rules, 'https://a.example.com/path', 'browse'), 'allow');
  assert.equal(ruleFor(rules, 'https://evil-example.com', 'browse'), 'ask');
  assert.equal(ruleFor(rules, 'http://a.example.com', 'browse'), 'ask');
  assert.equal(ruleFor(rules, 'https://a.example.com:8443', 'browse'), 'ask');
  assert.equal(ruleFor([], 'https://example.com', 'download'), 'ask');
});
test('disabled agent blocks tool access before reading data or opening a page', async () => {
  const f = fixture(); f.settings.agentEnabled = false;
  f.features.library.get = async () => { assert.fail('must not read'); };
  await assert.rejects(f.tool.execute({ action: 'navigate', url: 'https://example.com' }), /已关闭/);
  assert.deepEqual(f.calls.opens, []);
});
test('read result is rejected after async page read if account/environment changes', async () => {
  for (const changed of [{ owner: 'other', environmentId: 'environment' }, { owner: 'owner', environmentId: 'other' }]) {
    const f = fixture(), pending = deferred(), entered = deferred();
    f.tab.wc.executeJavaScript = () => { entered.resolve(); return pending.promise; };
    const result = f.tool.execute({ action: 'read' }); await entered.promise;
    f.setScope(changed); pending.resolve({ text: 'old environment secret' });
    await assert.rejects(result, /已切换/);
  }
});
test('history result is rejected after its second async library read if scope changes', async () => {
  const f = fixture(), pending = deferred(), entered = deferred(); let count = 0;
  f.features.library.get = async () => { if (++count === 1) return f.data; entered.resolve(); return pending.promise; };
  const result = f.tool.execute({ action: 'history' }); await entered.promise;
  f.setScope({ ...f.scope, environmentId: null }); pending.resolve(f.data);
  await assert.rejects(result, /已切换/);
});
test('abort blocks initial access and discards an in-flight read result', async () => {
  const first = fixture(); first.controller.abort(); await assert.rejects(first.tool.execute({ action: 'tabs' }), { name: 'AbortError' });
  const f = fixture(), pending = deferred(), entered = deferred();
  f.tab.wc.executeJavaScript = () => { entered.resolve(); return pending.promise; };
  const result = f.tool.execute({ action: 'read' }); await entered.promise; f.controller.abort(); pending.resolve({ text: 'secret' });
  await assert.rejects(result, { name: 'AbortError' });
});
test('download permission is independent of browsing and must authorize destination origin', async () => {
  const f = fixture(); f.data.agentRules = [{ pattern: '*', browse: 'allow', download: 'ask' }];
  f.features.ask = async (...args) => { f.calls.asks.push(args); return false; };
  await assert.rejects(f.tool.execute({ action: 'download', url: 'https://files.example.net/file' }), /拒绝/);
  assert.deepEqual(f.calls.downloads, []); assert.match(f.calls.asks[0][2], /下载/);
  f.data.agentRules = [{ pattern: '*', browse: 'allow', download: 'block' }, { pattern: 'https://example.com', download: 'allow' }];
  await assert.rejects(f.tool.execute({ action: 'download', url: 'https://files.example.net/file' }), /禁止/);
  assert.deepEqual(f.calls.downloads, []);
  f.data.agentRules = [{ pattern: '*', browse: 'allow', download: 'ask' }]; f.features.ask = async (...args) => { f.calls.asks.push(args); return true; };
  await f.tool.execute({ action: 'download', url: 'https://files.example.net/file' });
  assert.deepEqual(f.calls.downloads, ['https://files.example.net/file']);
  assert.equal(f.tab.agentPolicy.grants.has('download|https://files.example.net'), true);
});
test('siteTools setting blocks listing and execution before page scripts run', async () => {
  const f = fixture(); f.settings.siteTools = false;
  await assert.rejects(f.tool.execute({ action: 'siteTools' }), /站点工具已关闭/);
  await assert.rejects(f.tool.execute({ action: 'siteTool', name: 'example' }), /站点工具已关闭/);
  assert.deepEqual(f.calls.scripts, []);
  f.settings.siteTools = true; await f.tool.execute({ action: 'siteTools' });
  assert.match(f.calls.scripts[0], /modelContext/);
});
test('navigation retains agent policy marker with scope, signal and authorized origins', async () => {
  const f = fixture();
  await f.tool.execute({ action: 'navigate', tabId: 'tab1', url: 'https://example.com/next' });
  assert.equal(f.tab.agentPolicy.scope, f.scope); assert.equal(f.tab.agentPolicy.signal, f.controller.signal);
  assert.equal(f.tab.agentPolicy.grants.has('browse|https://example.com'), true);
  await f.tool.execute({ action: 'navigate', url: 'https://other.example/' });
  assert.equal(f.calls.opens[0].agentPolicy.scope, f.scope);
  assert.equal(f.calls.opens[0].agentPolicy.grants.has('browse|https://other.example'), true);
  assert.equal(f.tab.agentPolicy.grants, f.calls.opens[0].agentPolicy.grants);
});
test('full composer access skips browser prompts for this task, respects blocks and expires after completion',async()=>{
 const f=fixture();f.setAccess('full');f.data.agentRules=[{pattern:'*',browse:'ask',download:'ask'}];f.settings.historyAccess='ask';f.features.ask=async()=>{assert.fail('full mode must not prompt');};
 await f.tool.execute({action:'navigate',tabId:'tab1',url:'https://example.com/next'});await f.tool.execute({action:'history'});await f.tool.execute({action:'download',url:'https://files.example/file'});
 assert.equal(f.tab.agentPolicy.getAccessMode(),'full');f.data.agentRules.push({pattern:'https://blocked.example',browse:'block'});await assert.rejects(f.tool.execute({action:'navigate',url:'https://blocked.example/'}),/禁止/);f.finish();await assert.rejects(f.tool.execute({action:'history'}),/已结束/);
});
test('automatic composer approval covers browsing but still asks for downloads',async()=>{const f=fixture();f.setAccess('auto');f.data.agentRules=[{pattern:'*',browse:'ask',download:'ask'}];await f.tool.execute({action:'read'});assert.equal(f.calls.asks.length,0);await f.tool.execute({action:'download',url:'https://files.example/file'});assert.equal(f.calls.asks.length,2);});
