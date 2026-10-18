import {createShutdownBarrier} from './shutdown.mjs';
import {createChatPopouts} from '../features/chat/chat-popout-main.mjs';
import {normalizeDocuments,documentPrompt} from '../features/chat/document-attachments.mjs';
import {createToolApprovalBroker} from '../features/runtimes/tool-approval.mjs';
import {sandboxHTML,artifactCSP} from '../features/chat/artifact-sandbox.mjs';
import {usageDetails,recordArtifacts,insightView} from '../features/chat/chat-insights.mjs';
import {readArtifact} from '../features/runtimes/artifact-read.mjs';
import {deepSeekMaintenance,compactCodex} from '../features/runtimes/compact-runner.mjs';
import {readTextSnapshot} from '../features/runtimes/file-snapshot.mjs';
import {createFileChangeHooks} from '../features/runtimes/file-change-hooks.mjs';
import {readContainerDisplay,readNetworkDisplay} from '../features/environments/container-display.mjs';
import {listChatContext,reconcileClaudeSkills} from '../features/runtimes/context-catalog.mjs';
import {executeGitOperation} from '../features/git/git-executor.mjs';
import {createClaudeActivityAdapter} from '../features/runtimes/claude-activity.mjs';
import {ChatRuns} from '../features/chat/chat-runs.mjs';
import {rewindPrefix,replayPrompt,deepSeekPrefix} from '../features/chat/message-rewind.mjs';
import {connectEnvironmentProxy,restoreSelectedEnvironment} from '../features/environments/environment-proxy.mjs';
import {prepareKeychainMigration,verifyKeychainMigration} from './keychain-migration.mjs';
import {mountLocalProject} from '../features/projects/project-mount.mjs';
import {browseEnvironmentProject,selectEnvironmentProject,importEnvironmentProject} from '../features/projects/project-files.mjs';
import {normalizeCodexInput} from '../features/runtimes/codex-images.mjs';
import {recoverDeepSeekMessages} from '../features/runtimes/deepseek-history-recovery.mjs';
import {LearningAutomations} from '../features/automation/learning-automation.mjs';
import {mergeChatPayload,saveChatSnapshot} from '../features/chat/chat-sync.mjs';
import {chatRuntimeEnvironment,chatRequestRoute,chatNetworkMode,directChatEnvironment,createDirectChatSpawner} from '../features/chat/chat-network.mjs';
import {createBrowserDirectTransport} from '../features/browser/browser-direct.mjs';
import {browserRoute} from '../features/browser/browser-routing.mjs';
import {RUNTIME_CATALOG,CLI_RUNTIMES,supportsChat} from '../features/runtimes/runtime-install-config.mjs';
import {removeCLIRuntime} from '../features/runtimes/runtime-removal.mjs';
import {ConnectionRecords} from '../features/proxy/connection-records.mjs';
import {runDeepSeek} from '../features/runtimes/deepseek-runner.mjs';
import {normalizeDeepSeekInput} from '../features/runtimes/deepseek-runtime.mjs';
import {ContainerTerminal} from '../features/terminal/container-terminal.mjs';
import {createDesktopReturn} from './desktop-return.mjs';
import {restoredChat} from '../features/chat/chat-selection.mjs';
import {totalUsageTokens} from '../features/chat/token-usage.mjs';
import {hostname} from 'node:os';
import {DockerEnvironments,resourcePrefix} from '../features/environments/docker-environments.mjs';
import {validateSessionOptions} from '../features/chat/session-options.mjs';
import { app, protocol, Menu, Notification, BrowserWindow, WebContentsView, ipcMain, safeStorage, clipboard, powerMonitor, session, shell, nativeImage, dialog } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, access, rm, stat, rename, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ProxyGateway, proxyEnvironment, validateProxy } from '../features/proxy/proxy.mjs';
import { parseAuthStatus, detectAIAuth } from '../features/runtimes/ai-auth.mjs';
import { readCodexModel, listCodexModels } from '../features/runtimes/codex-runner.mjs';
import {runCodexStream as runCodex} from '../features/runtimes/codex-stream.mjs';
import { createRestrictedCCSpawner } from '../features/runtimes/cc-network-guard.mjs';
import { evaluateEnvironment, readSystemEnvironment } from '../features/environments/environment-gate.mjs';
import { protectBrowserContents } from '../features/browser/browser-policy.mjs';
import {BrowserCookieSync} from '../features/browser/browser-cookies.mjs';
import {AccountClient} from '../features/account/account-client.mjs';
import { parseIproyalExport } from '../features/proxy/iproyal-import.mjs';

const here = fileURLToPath(new URL('../',import.meta.url));
let connectionRecords,chatNetworkChanging=false;
let dockerEnvs,activeContainerId=null,containerLogin=null,containerOperation=false,localEnvironmentEnabled=true;
const dockerOwner=()=>account?.user?.id || null;
let consoleSession=null,consoleOpening=false;
function closeConsole(){const previous=consoleSession;consoleSession=null;previous?.close();}

const browserPartition=()=>environmentBrowserPartition(dockerOwner(),activeContainerId);
const environmentBrowserPartition=(owner,id)=>'persist:dingtu-'+createHash('sha256').update(String(owner)+String(id)).digest('hex');
let cookiePreferences={};const cookieSyncs=new Map();
const cookiePreferenceKey=(owner,id)=>JSON.stringify([owner,id]);
function cookieContext(){
 const owner=dockerOwner(),id=activeContainerId,key=cookiePreferenceKey(owner,id),storage=session.fromPartition(browserPartition());
 if(cookieSyncs.has(key))return cookieSyncs.get(key);
 const pref={mode:cookiePreferences[key]?.mode==='account'?'account':'local'};
 const ctx={owner,id,pref,error:'',sync:null};
 ctx.sync=new BrowserCookieSync({storage,valid:()=>dockerOwner()===owner && activeContainerId===id && !accountChanging && !containerOperation,
 request:async body=>{
  if(ctx.sync.mode!=='account' || dockerOwner()!==owner || activeContainerId!==id || !account?.token)throw new Error('账号或环境已变化');
  const token=account.token,url=account.serverURL+'/v1/me/browser-cookies?environment='+encodeURIComponent(id || 'local');
  const result=await account.transport(url,{token,method:body?'PUT':'GET',body});let data;try{data=JSON.parse(result.data);}catch{throw new Error('Cookie 同步服务不可用');}
  if(result.status>=400)throw new Error(data.error || 'Cookie 同步失败');ctx.error='';return data;
 },onError:()=>{ctx.error='Cookie 同步失败，请检查账号服务后刷新重试';}});
 ctx.sync.mode=pref.mode;cookieSyncs.set(key,ctx);return ctx;
}
async function saveCookiePreferences(){await writeFile(path.join(app.getPath('userData'),'cookie-preferences.json'),JSON.stringify(cookiePreferences),{mode:0o600});}
setInterval(()=>{if(account?.user && !accountChanging && !containerOperation){const ctx=cookieContext();void ctx.sync.sync().catch(ctx.sync.onError);}},15000).unref();
function requireActiveEnvironment(){if(!activeContainerId && !localEnvironmentEnabled)throw new Error('请先创建环境并检测运行时');}
let account=null,accountChanging=false,registeredRuntimes=null,runtimeOwner=null,runtimeDetection=null;
async function loadUserRuntimes(){const owner=account?.user?.id || null;registeredRuntimes=null;runtimeOwner=owner;const data=await dockerEnvs?.load(owner);activeContainerId=data?.activeId || null;localEnvironmentEnabled=data?.localEnabled!==false;const registry=activeContainerId?(await dockerEnvs.get(owner,activeContainerId)).item.registry:localEnvironmentEnabled?await account.runtimes(hostname()).catch(()=>null):null;if(owner===(account?.user?.id || null)){registeredRuntimes=registry;if(registry?.runtimes?.some(item=>!item.auth))await runtimeView(registry).catch(()=>{});}}

const accountProxyView=()=>({...savedConfig,password:undefined,hasPassword:Boolean(savedConfig.password)});
async function applyAccount(){closeConsole();accountChanging=true;try{containerLogin?.kill();containerLogin=null;await stopGateway();emit('network',{state:'blocked',reason:'账号配置已切换，请连接并核验出口'});await loadUserRuntimes();if(window)resetEnvironmentBrowser();await loadAccountChats(false);savedConfig={protocol:'http',host:'',port:8080,username:'',password:''};if(account.user){const saved=activeContainerId?(await dockerEnvs.get(dockerOwner(),activeContainerId)).item.proxy:await account.proxy();if(saved)savedConfig=validateProxy(saved);}return {...account.state(),proxy:accountProxyView()};}finally{accountChanging=false;if(account?.user){const ctx=cookieContext();await ctx.sync.sync().catch(ctx.sync.onError);}emit('account',{...account.state(),proxy:accountProxyView()});}}

const fixtureMode = process.argv.includes('--test-fixture');
const authRequired=!fixtureMode || Boolean(process.env.WORKSPACE_TEST_AUTH_ONLY);
let desktopReturn;
let accountWindowSignedIn,workspaceWindowBounds=null,workspaceWindowMaximized=false;
function syncAccountWindow(){
 if(!window || !authRequired)return;const signedIn=Boolean(account?.user);if(accountWindowSignedIn===signedIn)return;accountWindowSignedIn=signedIn;
 if(!signedIn){workspaceWindowMaximized=window.isMaximized();workspaceWindowBounds=window.getNormalBounds();if(window.isMaximized())window.unmaximize();window.setMinimumSize(640,560);window.setSize(860,720);window.center();}
 else{window.setMinimumSize(1050,760);window.setBounds(workspaceWindowBounds || {width:1400,height:950});if(!workspaceWindowBounds)window.center();if(workspaceWindowMaximized)window.maximize();}
}

const probeUrl = fixtureMode ? process.env.WORKSPACE_TEST_PROBE_URL : undefined;
const browserHomeUrl = fixtureMode ? process.env.WORKSPACE_TEST_HOME_URL || 'https://www.google.com/?hl=en' : 'https://www.google.com/?hl=en';
if (fixtureMode && process.env.WORKSPACE_TEST_DATA_DIR) app.setPath('userData', process.env.WORKSPACE_TEST_DATA_DIR);
protocol.registerSchemesAsPrivileged([{scheme:'kuneco-artifact',privileges:{standard:true,secure:true}}]);
const artifactPages=new Map();
function serveArtifact(result,owner,environment){if(result.kind!=='html')return result;const id=randomUUID();artifactPages.set(id,{owner,environment,html:sandboxHTML(result.text)});while(artifactPages.size>64)artifactPages.delete(artifactPages.keys().next().value);return {...result,url:'kuneco-artifact://preview/'+id};}
const exec = promisify(execFile);
// Keep the profile path stable; only the Keychain identity is migrated.
const legacyProfileName = '定途工作空间';
app.setName(fixtureMode ? 'Kuneco Test' : 'Kuneco');
if (!fixtureMode) app.setPath('userData', path.join(app.getPath('appData'), legacyProfileName));
if(!fixtureMode){
 if(!app.requestSingleInstanceLock())app.exit(0);
 app.on('second-instance',()=>{if(window && !window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus();}});
}
let keychainMigration;
if(process.platform==='darwin' && !fixtureMode){
 try{keychainMigration=prepareKeychainMigration({directory:app.getPath('userData'),executable:process.execPath});}
 catch(error){console.error(error.message);app.exit(1);}
}
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('hide-scrollbars');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE ::1');
app.commandLine.appendSwitch('dns-prefetch-disable');
app.commandLine.appendSwitch('lang', 'en-US');
app.commandLine.appendSwitch('accept-lang', 'en-US,en');
let environmentStatus = {allowed:false,reasons:['尚未完成系统环境检测'],languages:[],countries:[]}, environmentPromise, environmentTimer;
let fixtureEnvironment = fixtureMode && process.env.WORKSPACE_TEST_ENV ? JSON.parse(process.env.WORKSPACE_TEST_ENV) : null;
let window, browser, gateway, healthTimer, project = '', sessionId, claudePath = '', codexPath = '', codexSessionId, selectedEngine = 'cc', codexModel = null, connecting = false;
const runs=new ChatRuns();
const toolApprovals=createToolApprovalBroker();
const browserTabs = new Map();
let activeTabId, browserBounds = { x: 0, y: 0, width: 1, height: 1 }, browserVisible = false;
let pendingImport = null;
let egressPins = {};
const proxyIdentity = config => createHash('sha256').update(JSON.stringify([config.protocol, config.host, config.port, config.username])).digest('hex');
let pinWrite = Promise.resolve(), pinsLoadError = false;
function saveEgressPin(config, ip) {
  const key = proxyIdentity(config);
  if (egressPins[key] === ip) return Promise.resolve();
  pinWrite = pinWrite.catch(() => {}).then(async () => {
    if (egressPins[key] === ip) return;
    const pins = { ...egressPins, [key]: ip };
    const file = path.join(app.getPath('userData'), 'egress-pins.json');
    await mkdir(app.getPath('userData'), { recursive: true, mode: 0o700 });
    await writeFile(`${file}.tmp`, JSON.stringify(pins), { mode: 0o600 });
    await rename(`${file}.tmp`, file); egressPins = pins;
  });
  return pinWrite;
}
let browserMode='proxy',browserRoutingChanging=false,directBrowserTransport,directBrowserTransportPromise;
const browserNetworkReady=(url)=>!browserRoutingChanging && (browserMode==='direct' || gateway?.status.state==='ready');
async function browserProxyConfiguration(){
 if(browserMode!=='proxy'){directBrowserTransport=await (directBrowserTransportPromise ||= createBrowserDirectTransport({routeProxy:host=>{if(browserMode==='direct')return null;if(gateway?.status.state!=='ready')throw new Error('代理未连接');return gateway;},onRouteSelected:()=>publishTabs()}).catch(error=>{directBrowserTransportPromise=null;throw error;}));return {mode:'fixed_servers',proxyRules:directBrowserTransport.address,proxyBypassRules:'<-loopback>'};}
 return {mode:'fixed_servers',proxyRules:gateway?.address || 'http://127.0.0.1:1',proxyBypassRules:'<-loopback>'};
}
let savedConfig = { protocol: 'http', host: '', port: 8080, username: '' };
const emit = (type, data, context={}) => {
 const owner=account?.user?.id;
 if(connectionRecords && owner && !accountChanging && ['network','requestFailure'].includes(type)){
  const message=type==='network'?[data.reason || '网络状态更新',data.ip].filter(Boolean).join(' · '):[data.reason,data.target,data.code].filter(Boolean).join(' · ');
  const environmentId=activeContainerId;void connectionRecords.append(owner,message,environmentId).then(entries=>{if(owner===account?.user?.id && environmentId===activeContainerId)emit('connectionRecords',{owner,environmentId,entries:entries.filter(item=>Object.hasOwn(item,'environmentId') && item.environmentId===environmentId)});}).catch(()=>{});
 }
 if(type==='account'){syncAccountWindow();data={...data,authRequired};}if (window && !window.isDestroyed()) window.webContents.send('workspace:event', { type, data, ...context }); };
async function checkEnvironment() {
  if (environmentPromise) return environmentPromise;
  environmentPromise = (async () => {
    const result = fixtureEnvironment ? evaluateEnvironment(fixtureEnvironment) : await readSystemEnvironment();
    environmentStatus = result;
    if (!result.allowed) { directBrowserTransport?.closeConnections();stopBrowserTabs();await stopGateway(); emit('network',{state:'blocked',reason:'系统环境检测未通过，访问已禁止'}); }
    showBrowserViews(); emit('environment',result); return result;
  })().finally(() => { environmentPromise = null; });
  return environmentPromise;
}
async function requireEnvironment() {
  const result = await checkEnvironment();
  if (!result.allowed) throw new Error('系统环境检测未通过：' + result.reasons.join('；'));
}
function guarded(handler) {
  return async (event, ...args) => {
    if (event.sender !== window?.webContents || !event.senderFrame?.url.startsWith('file://')) throw new Error('非法调用来源');
    if(shutdown.requested)throw new Error('应用正在退出，请等待清理完成或重试退出');
    return handler(...args);
  };
}
function handleContainerLoginCallback(raw){
 const connection=consoleSession;
 if(!connection || connection.owner!==dockerOwner() || connection.id!==activeContainerId || !connection.acceptsLoginCallback(raw))return false;
 if(!connection.callbackReported){
  connection.callbackReported=true;
  void connection.forwardLoginCallback(raw).then(async()=>{
   if(consoleSession!==connection || connection.owner!==dockerOwner() || connection.id!==activeContainerId)return;
   const auth=await containerAuth('codex');
   if(consoleSession!==connection || connection.owner!==dockerOwner() || connection.id!==activeContainerId)return;
   const ok=auth.state==='signed-in';
   emit('console',{token:connection.token,type:'login-result',ok,text:ok?'Codex 已登录成功，凭证已保存在当前容器环境。':'Codex 尚未确认登录成功，请查看上方输出后重试。'});
   emit('runtimeLoginCallback',{ok,owner:connection.owner,environmentId:connection.id});
  }).catch(()=>{if(consoleSession===connection){emit('console',{token:connection.token,type:'login-result',ok:false,text:'登录回调失败，请查看上方输出后重试。'});emit('runtimeLoginCallback',{ok:false,owner:connection.owner,environmentId:connection.id});}});
 }
 return true;
}
function localBrowserUrl(raw) {
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持普通 HTTP／HTTPS 页面');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || /^127\./.test(host) || host === '::1' || host === '0.0.0.0') throw new Error('原型浏览器不开放本机回调页面，请使用现有 CC 登录');
  return url.href;
}
function browserActualRoute(url){
 try{const target=new URL(url);if(!/^https?:$/.test(target.protocol))return null;return browserMode==='mixed'?directBrowserTransport?.getRoute(target.hostname)||null:browserMode==='direct'?'direct':'proxy';}catch{return null;}
}
function browserState() {
  return { mode:browserMode, activeId: activeTabId, tabs: [...browserTabs.values()].map(({ id, url, title, started, loading, error }) => ({ id, url, title, started, loading, error, route:started?browserActualRoute(url):null })) };
}
function showBrowserViews() {
  for (const tab of browserTabs.values()) {
    if (!tab.wc || tab.wc.isDestroyed()) continue;
    tab.view.setBounds(browserBounds);
    tab.view.setVisible(environmentStatus.allowed && browserVisible && browserNetworkReady() && tab.id === activeTabId && tab.started);
  }
}
function publishTabs() { showBrowserViews(); emit('browserTabs', browserState()); }
function stopBrowserTabs() { for (const tab of browserTabs.values()) { if (tab.wc && !tab.wc.isDestroyed()) tab.wc.stop(); } showBrowserViews(); }
function removeBrowserTab(tab, closeContents = false) {
  tab.closing = true;
  if (!browserTabs.delete(tab.id)) return;
  if (window && !window.isDestroyed()) window.contentView.removeChildView(tab.view);
  if (closeContents && tab.wc && !tab.wc.isDestroyed()) tab.wc.close();
  if (!window || window.isDestroyed()) return;
  if (!browserTabs.size) createBrowserTab();
  else if (activeTabId === tab.id) activateBrowserTab(browserTabs.has(tab.openerId) ? tab.openerId : [...browserTabs.keys()].at(-1));
  publishTabs();
}
function activateBrowserTab(id) {
  const tab = browserTabs.get(id);
  if (!tab || !tab.wc || tab.wc.isDestroyed()) throw new Error('标签已关闭，请切换到其他标签');
  activeTabId = id; browser = tab.view; publishTabs();
  return tab;
}
function navigateBrowserTab(tab, url) {
  const target = localBrowserUrl(url);
  if (!tab?.wc || tab.wc.isDestroyed()) throw new Error('标签已关闭，请重新打开');
  if (!browserNetworkReady(target)) {
    tab.url = target; tab.error = '此网站需要应用代理，请连接代理后重试。'; tab.loading = false; publishTabs(); return;
  }
  tab.url = target; tab.started = true; tab.error = ''; tab.loading = true;
  publishTabs();
  // loadURL may reject with -3 when a newer navigation or redirect takes over.
  // WebContents events own the final state, independent of this promise.
  void tab.privacyReady.then(() => { if (tab.privacyError || tab.wc.isDestroyed()) throw new Error('Privacy protection unavailable'); return tab.wc.loadURL(target); }).catch(error => {
    if (!browserTabs.has(tab.id) || error.code === 'ERR_ABORTED' || error.errno === -3) return;
    tab.error = '页面加载失败，请检查代理和目标网站。'; tab.loading = false; publishTabs();
  });
}
const configuredBrowserSessions=new Map();
const failedBrowserSessions=new WeakSet();
function configureBrowserSession(browserSession){
 if(configuredBrowserSessions.has(browserSession))return configuredBrowserSessions.get(browserSession);
 browserSession.registerPreloadScript({type:'frame',id:'browser-font-policy',filePath:path.join(here,'features/browser/browser-font-policy.cjs')});
 browserSession.registerPreloadScript({type:'service-worker',id:'browser-worker-policy',filePath:path.join(here,'features/browser/browser-worker-policy.cjs')});
  browserSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  // Apply the closed local proxy even before configuration; no system-proxy fallback.
  const ready=browserProxyConfiguration().then(config=>browserSession.setProxy(config));
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    if(details.resourceType==='mainFrame' && browserSession===session.fromPartition(browserPartition()) && handleContainerLoginCallback(details.url)){callback({cancel:true});return;}
    let blocked = !environmentStatus.allowed || !browserNetworkReady(details.url) || failedBrowserSessions.has(browserSession);
    if (/^(https?|wss):/.test(details.url)) {
      try { localBrowserUrl(details.url.replace(/^wss:/, 'https:')); } catch { blocked = true; }
    } else if (!/^(about:|data:|blob:)/.test(details.url)) blocked = true;
    callback({ cancel: blocked });
  });
  browserSession.on('will-download', (event, item) => {
    if (!browserNetworkReady(item.getURL())) { event.preventDefault(); return; }
    const owner=gateway,mode=browserMode;
    const cancel=()=>{if(!browserNetworkReady(item.getURL()) || browserMode!==mode)item.cancel();};
    if(browserRoute(mode,item.getURL())==='proxy' && owner){owner.on('status',cancel);item.once('done',()=>owner.off('status',cancel));}
  });
 configuredBrowserSessions.set(browserSession,ready);return ready;
}
function createBrowserTab(url, popupOptions, openerId) {
  const browserSession = session.fromPartition(browserPartition());
  browserSession.setUserAgent(browserSession.getUserAgent(), 'en-US,en');
  const routingReady=configureBrowserSession(browserSession);
  const cookiesReady=account?.user?cookieContext().sync.sync().catch(error=>{cookieContext().error='Cookie 同步失败，请在浏览器设置中重试';}):Promise.resolve();
  const view = new WebContentsView({ ...(popupOptions?.webContents ? { webContents: popupOptions.webContents } : {}), webPreferences: { ...popupOptions?.webPreferences, partition: browserPartition(), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const tab = { id: randomUUID(), view, wc: view.webContents, openerId, url: 'https://www.google.com/?hl=en', title: '新标签页', started: false, loading: false, error: '' };
  browserTabs.set(tab.id, tab); window.contentView.addChildView(view); view.setVisible(false);
  const wc = view.webContents;
  wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  tab.privacyReady = Promise.all([routingReady,cookiesReady,protectBrowserContents(wc, () => {
    if (tab.closing || wc.isDestroyed()) return;
    failedBrowserSessions.add(browserSession);
    tab.privacyError = true; tab.error = '浏览器隐私防护失效，已停止访问';
    if (gateway) { gateway.quarantined = true; gateway.block(tab.error); }
    wc.stop(); publishTabs();
  }, { initializeBlank: !popupOptions })]).catch(error => { failedBrowserSessions.add(browserSession); tab.privacyError = true; tab.error = '隐私防护初始化失败，访问已禁止'; if (fixtureMode) console.error('PRIVACY_INIT', error.message); publishTabs(); });
  wc.setWindowOpenHandler(details => {
    if (!environmentStatus.allowed || !browserNetworkReady()) return { action: 'deny' };
    try { if (details.url !== 'about:blank') localBrowserUrl(details.url); }
    catch { return { action: 'deny' }; }
    // Chromium owns the popup navigation, POST body and opener relationship.
    return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: browserPartition(), sandbox: true, contextIsolation: true, nodeIntegration: false } }, createWindow: options => {
      const child = createBrowserTab(undefined, options, tab.id);
      child.url = details.url; child.started = true; child.loading = true; publishTabs();
      if (details.disposition === 'background-tab' && !options.webContents) navigateBrowserTab(child, details.url);
      return child.wc;
    } };
  });
  wc.once('destroyed', () => removeBrowserTab(tab));
  wc.on('will-redirect',(event,url)=>{if(handleContainerLoginCallback(url))event.preventDefault();});
  wc.on('will-navigate', (event, url) => { if(handleContainerLoginCallback(url)){event.preventDefault();return;}try { localBrowserUrl(url); if (!browserNetworkReady()) event.preventDefault(); } catch { event.preventDefault(); } });
  wc.on('did-start-loading', () => { tab.loading = true; tab.error = ''; publishTabs(); });
  wc.on('did-stop-loading', () => { tab.loading = false; publishTabs(); });
  const navigated = (_event, url) => { if (url === 'about:blank' && !popupOptions) return; tab.url = url; tab.started = true; tab.error = ''; publishTabs(); };
  wc.on('did-navigate', navigated);
  wc.on('did-navigate-in-page', (event, url, isMainFrame) => { if (isMainFrame) navigated(event, url); });
  wc.on('page-title-updated', (_event, title) => { tab.title = title || '网页'; publishTabs(); });
  wc.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    tab.error = `页面加载失败（${code}），请检查代理和目标网站。`; tab.loading = false; publishTabs();
  });
  activateBrowserTab(tab.id);
  if (url) navigateBrowserTab(tab, url);
  return tab;
}
async function findExecutable(name) {
  const dirs=[...new Set((process.env.PATH || '').split(path.delimiter))];
  dirs.push(path.join(app.getPath('home'),'.local/bin'));
  for(const dir of dirs) {const candidate=path.join(dir,process.platform==='win32'?name+'.exe':name);try{await access(candidate,constants.X_OK);return candidate}catch{}}
  return '';
}
async function findClaude() {
  const dirs = [...new Set((process.env.PATH || '').split(path.delimiter))];
  dirs.push(path.join(app.getPath('home'), '.local/bin'));
  for (const dir of dirs) {
    const candidate = path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude');
    try { await access(candidate, constants.X_OK); claudePath = candidate; return candidate; } catch {}
  }
  return '';
}
function abortRun(predicate=()=>true) {
  void runs.abortWhere(predicate);
}
async function stopGateway({preserveDirectChat=false}={}) {
  account?.closeConnections();
  clearInterval(healthTimer); healthTimer = null;
  abortRun(task=>!preserveDirectChat || task.networkMode!=='direct');
  if (gateway) { const old = gateway; gateway = null; await old.stop(); }
  if(browserMode!=='direct')stopBrowserTabs();
}
const aiSessions=new Map(); let activeAISessionId, defaultEngine='cc', defaultCodexModel=null;
let sessionSave=Promise.resolve(),chatOwner=null,chatRevision=0,chatViews=[],chatReady=false,legacyChatOwner=null,chatImportLegacy=false,chatDirty=false,chatBase=null,chatGeneration=0;
function chatCacheFile(owner){return path.join(app.getPath('userData'),'chat-cache-'+createHash('sha256').update(owner).digest('hex')+'.bin');}
async function writeChatCache(owner,payload){
 if(!safeStorage.isEncryptionAvailable())throw new Error('本机加密存储不可用，对话未同步');
 const file=chatCacheFile(owner);await writeFile(file+'.tmp',safeStorage.encryptString(JSON.stringify({revision:chatRevision,payload,base:chatBase})),{mode:0o600});await rename(file+'.tmp',file);
}
function chatPayload(){return {activeAISessionId,sessions:[...aiSessions.values()],views:chatViews};}
function persistAISessions(){
 const owner=chatOwner,generation=chatGeneration;
 sessionSave=sessionSave.catch(()=>{}).then(async()=>{
  if(generation!==chatGeneration || owner!==chatOwner)return;
  let payload=structuredClone(chatPayload());
  if(!owner){if(!account?.user)await writeFile(path.join(app.getPath('userData'),'ai-sessions.json'),JSON.stringify(payload),{mode:0o600});return;}
  if(!chatReady || account?.user?.id!==owner)return;
  await writeChatCache(owner,payload);
  if(generation!==chatGeneration || owner!==chatOwner || account?.user?.id!==owner)return;
  chatDirty=true;try{const result=await saveChatSnapshot({client:account,owner,revision:chatRevision,payload,base:chatBase,isCurrent:()=>generation===chatGeneration && chatOwner===owner && account?.user?.id===owner});if(generation===chatGeneration && chatOwner===owner && account?.user?.id===owner){chatRevision=result.revision;
   if(JSON.stringify(payload)!==JSON.stringify(result.payload)){
    const merged=mergeChatPayload(payload,chatPayload(),result.payload);const previous=new Map(aiSessions);aiSessions.clear();for(const item of merged.sessions || []){const existing=previous.get(item.id);aiSessions.set(item.id,existing?Object.assign(existing,item):item);}chatViews=merged.views || [];
    emit('chatMerged',{owner,base:payload,payload:result.payload});
   }
   chatBase=result.payload;payload=structuredClone(chatPayload());chatDirty=JSON.stringify(payload)!==JSON.stringify(result.payload);await writeChatCache(owner,payload);if(!chatDirty)emit('chatSyncRecovered',{owner});}}
  catch(error){if(generation===chatGeneration && chatOwner===owner && account?.user?.id===owner)emit('chatSyncError',{owner,message:'对话尚未同步到后端：'+error.message});throw error;}
 });sessionSave.catch(()=>{});return sessionSave;
}
async function loadAccountChats(allowLegacy){
 const generation=++chatGeneration,requestedOwner=account?.user?.id || null;
 await sessionSave.catch(()=>{});if(generation!==chatGeneration || requestedOwner!==(account?.user?.id || null))return;chatReady=false;chatDirty=false;chatRevision=0;chatViews=[];chatImportLegacy=false;chatOwner=account?.user?.id || null;
 const legacy=[...aiSessions.values()];aiSessions.clear();activeAISessionId=null;
 if(!chatOwner){emit('chatAccountChanged',{});return;}
 let saved,cached;const owner=chatOwner;
 try{cached=JSON.parse(safeStorage.decryptString(await readFile(chatCacheFile(owner))));}catch{}
 try{
  saved=await account.chats();
  if(cached && Object.hasOwn(cached,'base') && JSON.stringify(cached.payload)!==JSON.stringify(cached.base)){
   try{const merged=mergeChatPayload(cached.base,cached.payload,saved.payload);saved={revision:saved.revision,payload:merged,base:saved.payload};}
   catch{saved=cached;emit('chatSyncError',{owner,message:'对话有未解决的同步冲突，已恢复本机内容，云端未被覆盖'});}
  }
 }catch(error){
  if(!cached){emit('chatSyncError',{owner,message:'无法读取当前账号对话：'+error.message});emit('chatAccountChanged',{});return;}
  // Offline recovery must retain the last acknowledged server baseline.
  saved=cached;
 }
 if(generation!==chatGeneration || chatOwner!==owner || account?.user?.id!==owner)return;
 chatRevision=saved.revision || 0;chatBase=structuredClone(Object.hasOwn(saved,'base')?saved.base:saved.payload);let payload=saved.payload;
 chatDirty=JSON.stringify(payload)!==JSON.stringify(chatBase);
 if(!payload && allowLegacy && (!legacyChatOwner || legacyChatOwner===chatOwner)){
  payload={sessions:legacy,activeAISessionId:legacy.at(-1)?.id,views:[]};chatImportLegacy=true;legacyChatOwner=chatOwner;
  await writeFile(path.join(app.getPath('userData'),'legacy-chat-owner.json'),JSON.stringify({owner:chatOwner}),{mode:0o600});
 }
 for(const item of (payload?.sessions || []).slice(0,100)){if(typeof item.id==='string' && ['cc','codex','deepseek'].includes(item.engine) && typeof item.project==='string')aiSessions.set(item.id,item);}
 chatViews=Array.isArray(payload?.views)?payload.views:[];activeAISessionId=restoredChat([...aiSessions.values()],{environmentId:activeContainerId,activeId:payload?.activeAISessionId})?.id || null;
 if(activeContainerId){
  for(const item of aiSessions.values())if(item.engine==='deepseek' && item.environmentId===activeContainerId){
   try{
    const history=JSON.parse(await dockerEnvs.exec(owner,activeContainerId,['node','-e',"process.stdout.write(require('fs').readFileSync(require('path').join(require('os').homedir(),'.config/dingtu-deepseek',process.argv[1]+'.json'),'utf8'))",item.deepseekSessionId || item.id],{maxBuffer:64*1024*1024}));
    if(generation!==chatGeneration || owner!==chatOwner)return;
    const view=chatViews.find(view=>view.id===item.id);const recovered=recoverDeepSeekMessages(view?.messages,history);
    if(recovered.length>(view?.messages?.length || 0)){if(view)view.messages=recovered;else chatViews.push({id:item.id,title:item.title,messages:recovered});chatDirty=true;}
   }catch{}
  }
 }
 chatReady=true;if(activeAISessionId)activateAISession(aiSessions.get(activeAISessionId));
 emit('chatAccountChanged',{});
}
function storeCurrentSession(){const item=aiSessions.get(activeAISessionId);if(item)Object.assign(item,{engine:selectedEngine,model:codexModel,project,sessionId,codexSessionId});persistAISessions();}
function activateAISession(item,{viewed=false}={}){if(viewed)item.lastViewedAt=new Date().toISOString();activeAISessionId=item.id;selectedEngine=item.engine;codexModel=item.model;project=item.project;sessionId=item.sessionId;codexSessionId=item.codexSessionId;persistAISessions();return {...item};}
async function prepareChatAccountChange(){
 if(runs.size){const pending={finished:Promise.all([...runs.values()].map(task=>task.finished))};abortRun();let timer;try{await Promise.race([pending.finished,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('对话仍在停止，请稍后重试')),10000))]);}finally{clearTimeout(timer);}}
 await sessionSave.catch(()=>{});
 if(chatOwner && chatReady && account?.user?.id===chatOwner)await writeChatCache(chatOwner,structuredClone(chatPayload()));
 chatGeneration++;chatReady=false;
}
async function saveEnginePreference(){
  await writeFile(path.join(app.getPath('userData'),'engine-preference.json'),JSON.stringify({selectedEngine:defaultEngine,codexModel:defaultCodexModel}),{mode:0o600});
}
async function loadConfig() {
 try{cookiePreferences=JSON.parse(await readFile(path.join(app.getPath('userData'),'cookie-preferences.json'),'utf8'));}catch{}
 try{const value=JSON.parse(await readFile(path.join(app.getPath('userData'),'browser-preferences.json'),'utf8'));if(['direct','mixed'].includes(value.mode))browserMode=value.mode;}catch{}
 try{legacyChatOwner=JSON.parse(await readFile(path.join(app.getPath('userData'),'legacy-chat-owner.json'),'utf8')).owner;}catch{}
  try {const value=JSON.parse(await readFile(path.join(app.getPath('userData'),'engine-preference.json'),'utf8'));if(['cc','codex','deepseek'].includes(value.selectedEngine))selectedEngine=value.selectedEngine;if(typeof value.codexModel==='string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(value.codexModel))codexModel=value.codexModel;}catch{}
  defaultEngine=selectedEngine;defaultCodexModel=codexModel;
  try{const data=JSON.parse(await readFile(path.join(app.getPath('userData'),'ai-sessions.json'),'utf8'));for(const item of (data.sessions || []).slice(0,100)){if(typeof item.id==='string' && ['cc','codex','deepseek'].includes(item.engine) && typeof item.project==='string')aiSessions.set(item.id,item);}if(aiSessions.has(data.activeAISessionId))activateAISession(aiSessions.get(data.activeAISessionId));}catch{}
  try { egressPins = JSON.parse(await readFile(path.join(app.getPath('userData'), 'egress-pins.json'), 'utf8')); if (!egressPins || Array.isArray(egressPins) || Object.values(egressPins).some(ip => !isIP(ip))) throw new Error('Invalid pins'); } catch (error) { if (error.code !== 'ENOENT') pinsLoadError = true; }
  try {
    const raw = JSON.parse(await readFile(path.join(app.getPath('userData'), 'proxy.json'), 'utf8'));
    savedConfig = { protocol: raw.protocol, host: raw.host, port: raw.port, username: raw.username || '' };
    if (raw.secret && safeStorage.isEncryptionAvailable()) savedConfig.password = safeStorage.decryptString(Buffer.from(raw.secret, 'base64'));
  } catch {}
}
async function saveConfig(config, remember) {
  if(accountChanging)throw new Error('账号切换中，请稍后');
  if(activeContainerId){await dockerEnvs.update(dockerOwner(),activeContainerId,{proxy:config});savedConfig={...config};return;}
  if(account?.token && !account.user)throw new Error('账号服务不可用，无法保存到已登录用户');
  if(account?.user){if(accountChanging)throw new Error('账号切换中，请稍后');await account.saveProxy(config,account.user.id);savedConfig={...config};return;}
  savedConfig = { ...config };
  if (!remember) { await rm(path.join(app.getPath('userData'), 'proxy.json'), { force: true }); return; }
  const raw = { protocol: config.protocol, host: config.host, port: config.port, username: config.username };
  if (config.password) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密不可用，不能保存密码；请取消保存配置');
    raw.secret = safeStorage.encryptString(config.password).toString('base64');
  }
  await mkdir(app.getPath('userData'), { recursive: true, mode: 0o700 });
  await writeFile(path.join(app.getPath('userData'), 'proxy.json'), JSON.stringify(raw, null, 2), { mode: 0o600 });
}
function refreshProxyRegion(next=gateway){
 if(!next || next!==gateway || next.status.state!=='ready' || fixtureMode || next.regionLookupStarted || Date.now()<(next.regionRetryAt || 0))return;
 if(next.status.countryCode && next.status.regionSource==='ipinfo.io')return;
 next.regionLookupStarted=true;
 void next.detectRegion().catch(()=>{next.regionRetryAt=Date.now()+60000;}).finally(()=>{next.regionLookupStarted=false;});
}
async function connect(config, remember, {environmentSwitch=false}={}) {
  if(accountChanging || (containerOperation && !environmentSwitch) || browserRoutingChanging)throw new Error('网络、账号或环境切换中，请稍后连接');
  await requireEnvironment();requireActiveEnvironment();
  if (connecting) throw new Error('正在连接，请稍候');
  if (pinsLoadError) throw new Error('固定出口记录损坏，已禁止连接；请恢复原记录，不能自动接受新IP');
  await Promise.all([...browserTabs.values()].map(tab => tab.privacyReady));
  if ([...browserTabs.values()].some(tab => tab.privacyError)) throw new Error('浏览器隐私防护失效，请重启应用再连接');
  const validated = validateProxy(config);
  if (!isIP(validated.host)) throw new Error('DNS保护要求上游主机填写IP地址；目标域名由上游代理解析，不能使用本机DNS启动代理');
  connecting = true;
  try {
    await stopGateway({preserveDirectChat:true});
    emit('network', { state: 'checking', reason: '正在通过指定代理核验出口' });
    const externalContainer=activeContainerId && (await dockerEnvs.get(dockerOwner(),activeContainerId)).item.external;
    const next = activeContainerId && !externalContainer?await dockerEnvs.connect(dockerOwner(),activeContainerId,validated,egressPins[proxyIdentity(validated)] || null,ip=>saveEgressPin(validated,ip)):await new ProxyGateway(validated, { gostBinary:process.env.KUNECO_PROXY_ENGINE==='gost'?path.join(here,'..','vendor','gost',process.platform+'_'+(process.arch==='x64'?'amd64':process.arch),'gost'):null, healthInterval:60000,jitter:0.2, expectedIp: egressPins[proxyIdentity(validated)] || null, onVerified: ip => saveEgressPin(validated, ip) }).start();
    if(shutdown.requested){await next.stop({strict:true});throw new Error('应用正在退出');}
    gateway = next;
    next.on('requestFailure', failure => { if (gateway === next) emit('requestFailure', failure); });
    next.on('status', status => {
      if (gateway !== next) return;
      emit('network', { ...status, address: next.address });
      refreshProxyRegion(next);
      if (status.state === 'blocked') { if(browserMode!=='direct')stopBrowserTabs(); abortRun(task=>task.networkMode!=='direct'); }
      showBrowserViews();
    });
    const configuration=await browserProxyConfiguration();
    for(const current of configuredBrowserSessions.keys()){await current.closeAllConnections();await current.setProxy(configuration);}
    await saveConfig(validated, remember);
    const status = await next.verify(probeUrl);
    await requireEnvironment();
    if (gateway !== next) throw new Error('连接期间系统环境发生变化');
    next.serviceProbes=!fixtureMode;
    next.startMonitoring(probeUrl);
    return status;
  } finally { connecting = false; }
}
async function createWindow() {
  window = new BrowserWindow({ show: false, width: authRequired && !account?.user?860:1400, height:authRequired && !account?.user?720:950, minWidth: authRequired && !account?.user?640:1050, minHeight:authRequired && !account?.user?560:760, title: 'Kuneco', icon: path.join(here, 'assets/brand/kuneco.png'), titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 14 }, backgroundColor: '#f6f7f9', webPreferences: { preload: path.join(here, 'app/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.once('ready-to-show', () => window?.show());
  window.webContents.on('did-start-loading',closeConsole);window.webContents.on('render-process-gone',closeConsole);window.webContents.on('destroyed',closeConsole);
  accountWindowSignedIn=Boolean(account?.user);
  window.webContents.on('before-input-event',(event,input)=>{const key=input.key.toLowerCase();if(input.type==='keyDown' && (key==='f5' || ((input.control || input.meta) && ['r','e'].includes(key))))event.preventDefault();});
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => {if(!event.isMainFrame&&!event.url.startsWith('kuneco-artifact://preview/'))event.preventDefault();});
  createBrowserTab();
  window.on('close', event=>{if(!shutdown.complete){event.preventDefault();app.quit();}});
  window.on('closed', () => { browserVisible = false; window = null; for (const tab of browserTabs.values()) { if (tab.wc && !tab.wc.isDestroyed()) tab.wc.close(); } browserTabs.clear(); });
  await window.loadFile(path.join(here, 'index.html'));
}
app.on('login', (event, contents, _request, authInfo, callback) => {
  if ([...browserTabs.values()].some(tab => tab.view.webContents === contents) && authInfo.isProxy && authInfo.host === '127.0.0.1' && authInfo.port === (browserMode!=='proxy'?directBrowserTransport?.port:gateway?.port)) {
    event.preventDefault(); callback('workspace', browserMode!=='proxy'?directBrowserTransport.token:gateway.token);
  } else { event.preventDefault(); callback(); }
});
ipcMain.handle('workspace:importIproyal', guarded(async ({ source, text, filePath, defaultProtocol = 'http' } = {}) => {
  pendingImport = null;
  let content, format = 'auto';
  if (source === 'clipboard') content = clipboard.readText();
  else if (source === 'text') content = text;
  else if (source === 'file') {
    if(typeof filePath!=='string' || !path.isAbsolute(filePath) || !/\.(txt|csv)$/i.test(filePath)) throw new Error('请选择 TXT 或 CSV 文件');
    const file = filePath;
    const info = await stat(file);
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error('请选择不超过 1 MB 的 TXT 或 CSV 文件');
    content = await readFile(file, 'utf8'); format = path.extname(file).toLowerCase() === '.csv' ? 'csv' : 'auto';
  } else throw new Error('请选择剪贴板、粘贴内容或导出文件');
  const parsed = parseIproyalExport(content, { defaultProtocol: source === 'text' ? defaultProtocol : 'http', format });
  pendingImport = { id: randomUUID(), entries: parsed.entries, expires: Date.now() + 5 * 60 * 1000 };
  return { batchId: pendingImport.id, format: parsed.format, warnings: parsed.warnings, entries: parsed.entries.map((entry, index) => ({ index, protocol: entry.protocol, host: entry.host, port: entry.port, authenticated: Boolean(entry.username || entry.password) })) };
}));
ipcMain.handle('workspace:applyIproyal', guarded(async ({ batchId, index } = {}) => {
  if (connecting) throw new Error('正在连接，请完成后再导入');
  if (!pendingImport || pendingImport.id !== batchId || pendingImport.expires < Date.now()) throw new Error('导入预览已过期，请重新导入');
  if (!Number.isInteger(index) || !pendingImport.entries[index]) throw new Error('请选择一条有效代理');
  const entry = pendingImport.entries[index]; pendingImport = null;
  // Import selects a draft only; connecting commits it to the current environment.
  return { protocol: entry.protocol, host: entry.host, port: entry.port, username: entry.username, password: entry.password };
}));
ipcMain.handle('workspace:cancelImport', guarded(async () => { pendingImport = null; return true; }));
function resetEnvironmentBrowser(){
 for(const tab of browserTabs.values()){tab.closing=true;window.contentView.removeChildView(tab.view);if(!tab.wc.isDestroyed())tab.wc.close();}browserTabs.clear();createBrowserTab();publishTabs();
}
async function containerAuth(engine){
 if(!supportsChat(engine))return {state:'unknown',checkedAt:new Date().toISOString()};
 if(engine==='deepseek'){try{return {...JSON.parse(await dockerEnvs.exec(dockerOwner(),activeContainerId,['node','/home/node/.local/lib/dingtu/deepseek.mjs','auth'])),checkedAt:new Date().toISOString()};}catch{return {state:'signed-out',checkedAt:new Date().toISOString()};}}
 try{const stdout=await dockerEnvs.exec(dockerOwner(),activeContainerId,engine==='cc'?['claude','auth','status','--json']:['codex','login','status']);const auth=parseAuthStatus(engine,{stdout});
  if(engine==='codex' && auth.state==='signed-in'){
   try{const raw=await dockerEnvs.exec(dockerOwner(),activeContainerId,['node','-e',`const fs=require('fs'),path=require('path');const file=path.join(process.env.CODEX_HOME||path.join(process.env.HOME,'.codex'),'auth.json');const auth=JSON.parse(fs.readFileSync(file,'utf8'));let claims={};try{claims=JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1],'base64url').toString('utf8'));}catch{}const name=typeof claims.name==='string'?claims.name:typeof claims.email==='string'?claims.email:null;console.log(JSON.stringify({accountName:name}));`]);auth.accountName=JSON.parse(raw).accountName;}catch{auth.accountName=null;}
  }
  return{...auth,checkedAt:new Date().toISOString()};}catch{return{state:'signed-out',checkedAt:new Date().toISOString()};}
}
function localGitDirectory(owner){return path.join(app.getPath('userData'),'git-environments',createHash('sha256').update(owner).digest('hex'));}
function localGitEnvironment(base,owner,proxy=''){return {...base,GIT_CONFIG_GLOBAL:path.join(localGitDirectory(owner),'config'),KUNECO_GIT_PROXY_URL:proxy};}
ipcMain.handle('workspace:dockerEnvironments',guarded(async(action='state',value={})=>{
 if(action==='state')return dockerEnvs.state(dockerOwner());
 if(action==='gitManage'){
  const owner=dockerOwner(),id=activeContainerId;
  if(!owner)throw new Error('请先登录');
  if(accountChanging || containerOperation || chatNetworkChanging)throw new Error('正在切换账号或环境，请稍后刷新');
  if(value.action!=='read' && (value.owner!==owner || value.environmentId!==id))throw new Error('环境已变化，请刷新后重试');
  containerOperation=true;
  try{
   const data=await dockerEnvs.load(owner);if(!id && data.localEnabled===false)throw new Error('请先创建环境');
   const item=id?(await dockerEnvs.get(owner,id)).item:null;
   const proxy=gateway,testing=value.action==='test';
   if(testing && !item?.external && (proxy?.status.state!=='ready' || !environmentStatus.allowed))throw new Error('当前环境代理未连接或出口未核验，请先连接');
   const context=id?{route:item.external?'external':'managed',project:project || undefined}:{local:true,project:project || undefined,root:localGitDirectory(owner),route:'local',proxy:testing?proxy?.url:undefined};
   context.defaultIdentity={name:account.user?.name || account.user?.username || '',email:account.user?.email || ''};
   const result=await executeGitOperation({action:value.action || 'read',value:value.data || {},context,
    ...(id?{execute:(args,options)=>dockerEnvs.exec(owner,id,args,options)}:testing?{launch:createRestrictedCCSpawner({port:proxy.port,canStart:()=>owner===dockerOwner() && id===activeContainerId && gateway===proxy && proxy.status.state==='ready'})}:{})});
   if(owner!==dockerOwner() || id!==activeContainerId || (testing && !item?.external && (gateway!==proxy || proxy.status.state!=='ready')))throw new Error('检测期间环境或网络已变化，请重试');
   return {...result,owner,environmentId:id,route:context.route};
  }finally{containerOperation=false;}
 }

 if(action==='rename' || action==='icon'){
  if(accountChanging || containerOperation)throw new Error('正在切换账号或环境');
  const owner=dockerOwner();if(!owner || value.owner!==owner || value.id!==activeContainerId)throw new Error('账号或环境已变化，请重新打开弹窗');
  containerOperation=true;try{if(action==='icon')await dockerEnvs.changeEnvironmentIcon(owner,value.id,value.icon);else await dockerEnvs.renameEnvironment(owner,value.id,value.name);if(owner!==dockerOwner())throw new Error('账号已变化');return await dockerEnvs.state(owner);}finally{containerOperation=false;}
 }
 if(action==='existing')return dockerEnvs.existing(dockerOwner());
 if(action==='previewExisting')return dockerEnvs.previewExisting(dockerOwner(),value.key);
 if(action==='detail'){
  const owner=dockerOwner();let item,registry,container=null,baseImage=null,baseSystem=null,reliability=null;
  if(value.id===null){const data=await dockerEnvs.load(owner);if(data.localEnabled===false)throw new Error('环境不存在');registry=activeContainerId===null?registeredRuntimes:await account.runtimes(hostname()).catch(()=>null);item={name:data.localName || '本机环境'};}
  else{item=(await dockerEnvs.get(owner,value.id)).item;registry=item.registry;
   const name=item.external?.id || resourcePrefix(owner,value.id)+'-worker';
   const endpoint=item.external?.endpoint || dockerEnvs.endpoint;const [worker,gateway]=await Promise.all([readContainerDisplay(dockerEnvs,name,endpoint),item.external?Promise.resolve(null):readContainerDisplay(dockerEnvs,resourcePrefix(owner,value.id)+'-gateway',endpoint)]);reliability={worker,gateway,network:item.external?null:await readNetworkDisplay(dockerEnvs,resourcePrefix(owner,value.id),endpoint)};
   try{container=JSON.parse(await dockerEnvs.command(['inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}}}',name],{endpoint:item.external?.endpoint || dockerEnvs.endpoint,timeout:5000}));}catch{container={name:item.external?.name || name,image:item.imageName || null};}
  }
  if(value.id!==null){
   baseImage=item.baseImage || null;
   try{baseSystem=JSON.parse(await dockerEnvs.exec(owner,value.id,['node','-e',String.raw`const fs=require('fs');const os=fs.readFileSync('/etc/os-release','utf8');const name=/^PRETTY_NAME=["']?([^\n"']+)/m.exec(os)?.[1];console.log(JSON.stringify({node:process.versions.node,os:name || null}));`],{timeout:5000}));}catch{}
  }
  if(value.id===activeContainerId && registry)registry=await runtimeView(registry,{refresh:false});
  if(owner!==dockerOwner())throw new Error('查看期间账号已变化，请重新打开环境');
  return {id:value.id,name:item.name,external:Boolean(item.external),containerName:container?.name?.replace(/^\//,'') || null,containerId:container?.id || null,containerImage:container?.image || null,baseImage,baseSystem,reliability,createdAt:item.createdAt || null,proxyConfigured:value.id===null?null:Boolean(item.proxy?.host),checkedAt:registry?.checkedAt || null,runtimes:(registry?.runtimes || []).map(runtime=>({id:runtime.id,name:runtime.name,version:runtime.version,models:runtime.models}))};
 }
 if(action==='logout'){
  const owner=dockerOwner(),id=activeContainerId;
  if(!owner || !id || value.owner!==owner || value.environmentId!==id)throw new Error('运行时环境已变化，请重新打开详情');
  if(!['cc','codex'].includes(value.engine))throw new Error('未知运行时');
  if(accountChanging || containerOperation || runs.size)throw new Error('环境正在处理操作，请稍后退出登录');
  containerOperation=true;
  try{
   await dockerEnvs.exec(owner,id,value.engine==='codex'?['codex','logout']:['claude','auth','logout']);
   if(owner!==dockerOwner() || id!==activeContainerId)throw new Error('运行时环境已变化');
   const auth=await containerAuth(value.engine);if(auth.state==='signed-in')throw new Error('仍检测到登录凭证，请稍后重试');
   await runtimeView(registeredRuntimes,{engine:value.engine});return {auth};
  }finally{containerOperation=false;}
 }
 if(action==='loginInput'){if(!containerLogin || typeof value.text!=='string' || value.text.length>4096)throw new Error('没有正在进行的登录');containerLogin.stdin.write(value.text+'\n');return true;}
 if(action==='loginCancel'){containerLogin?.kill();containerLogin=null;return true;}
 if(action==='prepare'){const owner=dockerOwner();if(!owner)throw new Error('请先登录');const configuration=value.imageConfig?await dockerEnvs.configureImage(owner,value.imageConfig):(await dockerEnvs.load(owner)).imageConfig;await dockerEnvs.prepare(progress=>{if(owner===dockerOwner())emit('containerPrepareProgress',progress);},configuration);if(owner!==dockerOwner())throw new Error('配置期间账号已变化，请重新检测');return dockerEnvs.state(owner);}
 if(accountChanging || containerOperation || chatNetworkChanging)throw new Error('正在处理环境或连接方式切换，请稍候');containerOperation=true;
 try{
 if(!dockerOwner())throw new Error('请先登录');
 if(runs.size || connecting || accountChanging || runtimeDetection)throw new Error('请等待当前操作结束');
 if(action==='login'){
  if(!activeContainerId || gateway?.status.state!=='ready')throw new Error('请先切换到容器环境并连接代理');if(!['cc','codex'].includes(value.engine))throw new Error('未知运行时');containerLogin?.kill();
  const launch=await dockerEnvs.spawner(dockerOwner(),activeContainerId);const child=launch({command:value.engine==='cc'?'claude':'codex',args:value.engine==='cc'?['auth','login']:['login']});containerLogin=child;
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{if(containerLogin===child)emit('containerLoginOutput',String(chunk));});child.on('error',()=>emit('containerLoginEnd','登录工具启动失败'));child.on('close',code=>{if(containerLogin===child){containerLogin=null;emit('containerLoginEnd',code===0?'登录已完成，请重新检测运行时':'登录已结束，请查看授权结果');}});return true;
 }
 if(action==='createLocal'){await dockerEnvs.createLocal(dockerOwner(),value.name,value.icon);await loadUserRuntimes();emit('chatAccountChanged',{});return dockerEnvs.state(dockerOwner());}
 if(action==='create' || action==='attach'){const owner=dockerOwner(),createdId=action==='attach'?await dockerEnvs.attach(owner,value.name,value.key,value.icon):await dockerEnvs.createPrepared(owner,value.name,value.icon);return {...await dockerEnvs.state(owner),createdId};}
 if(action==='removeRuntime'){
  const owner=dockerOwner(),id=activeContainerId;
  if(value.environmentId!==id)throw new Error('当前环境已变化，请重新打开运行时');
  if(containerLogin)throw new Error('请先结束当前运行时登录');
  if(id){registeredRuntimes=await dockerEnvs.removeRuntime(owner,id,value.engine);runtimeOwner=owner;return runtimeView(registeredRuntimes,{refresh:false});}
  await removeCLIRuntime(value.engine,{executable:value.engine==='cc'?await findClaude():await findExecutable(RUNTIME_CATALOG[value.engine]?.command || '')});
  if(await (value.engine==='cc'?findClaude():findExecutable(RUNTIME_CATALOG[value.engine]?.command || '')))throw new Error('仍检测到运行时，请检查是否存在其他安装副本');
  const registry={...registeredRuntimes,runtimes:(registeredRuntimes?.runtimes || []).filter(item=>item.id!==value.engine),checkedAt:new Date().toISOString()};
  await account.saveRuntimes(registry,owner);registeredRuntimes=registry;runtimeOwner=owner;return runtimeView(registry);
 }
 if(action==='installRuntime'){if(!activeContainerId)throw new Error('请先切换到容器环境，再安装运行时');if((await dockerEnvs.get(dockerOwner(),activeContainerId)).item.external)throw new Error('请在原容器中安装运行时，完成后重新检测');const registry=await dockerEnvs.installRuntime(dockerOwner(),activeContainerId,value.engine,{apiKey:value.apiKey,name:value.name,description:value.description});registeredRuntimes=registry;runtimeOwner=dockerOwner();return runtimeView(registry,{engine:value.engine});}
 if(action==='delete'){
  if(activeContainerId===value.id)closeConsole();
  const owner=dockerOwner(),id=value.id;const data=await dockerEnvs.load(owner);const item=id===null?(data.localEnabled!==false?{name:data.localName || '本机环境'}:null):(await dockerEnvs.get(owner,id)).item;
  if(!item)throw new Error('环境不存在');
  if(value.name!==item.name)throw new Error('请输入完整且一致的环境名称');
  const deletingActive=activeContainerId===id;
  if(deletingActive){containerLogin?.kill();containerLogin=null;await stopGateway();emit('network',{state:'blocked',reason:'正在删除当前环境'});}
  await sessionSave.catch(()=>{});
  if(!chatReady || chatOwner!==owner)throw new Error('对话记录尚未加载，无法完整删除环境，请稍后重试');
  if(id!==null)await dockerEnvs.deleteResources(owner,id,value.name);
  else await account.deleteLocalEnvironment(hostname());
  if(deletingActive){for(const tab of browserTabs.values()){tab.closing=true;window.contentView.removeChildView(tab.view);if(!tab.wc.isDestroyed())tab.wc.close();}browserTabs.clear();}
  const partition=environmentBrowserPartition(owner,id);
  const storage=session.fromPartition(partition);await storage.closeAllConnections();await storage.clearStorageData();await storage.clearCache();await storage.clearAuthCache();
  const deleted=new Set([...aiSessions.values()].filter(item=>(item.environmentId || null)===id).map(item=>item.id));
  for(const sessionID of deleted){if(/^[a-f0-9-]{36}$/.test(sessionID))await rm(path.join(app.getPath('userData'),'chat-workspaces',sessionID),{recursive:true,force:true});aiSessions.delete(sessionID);}chatViews=chatViews.filter(view=>!deleted.has(view.id));
  if(deletingActive)activeAISessionId=null;
  await persistAISessions();
  if(id===null)await dockerEnvs.forgetLocal(owner,value.name);else await dockerEnvs.forget(owner,id,value.name);
  if(deletingActive){await loadUserRuntimes();savedConfig=activeContainerId?(await dockerEnvs.get(owner,activeContainerId)).item.proxy || {protocol:'http',host:'',port:8080,username:''}:(localEnvironmentEnabled?await account.proxy().catch(()=>null):null) || {protocol:'http',host:'',port:8080,username:''};project='';sessionId=undefined;codexSessionId=undefined;codexModel=null;resetEnvironmentBrowser();emit('account',{...account.state(),proxy:accountProxyView()});}
  emit('chatAccountChanged',{});return dockerEnvs.state(owner);
 }
 if(action==='start'){if(activeContainerId!==value.id)throw new Error('请先切换到该环境');await dockerEnvs.stopOtherEnvironments(dockerOwner(),value.id);if(activeContainerId===value.id){await stopGateway();emit('network',{state:'blocked',reason:'容器已启动，请连接并核验代理'});}await dockerEnvs.start(dockerOwner(),value.id);return dockerEnvs.state(dockerOwner());}
 if(action==='stop'){if(activeContainerId===value.id){closeConsole();await stopGateway();emit('network',{state:'blocked',reason:'当前容器已停止'});}return dockerEnvs.stop(dockerOwner(),value.id);}
 if(action==='select'){
  closeConsole();containerLogin?.kill();containerLogin=null;storeCurrentSession();await sessionSave.catch(()=>{});await stopGateway();await dockerEnvs.activate(dockerOwner(),value.id || null);await loadUserRuntimes();
  savedConfig=activeContainerId?(await dockerEnvs.get(dockerOwner(),activeContainerId)).item.proxy || {protocol:'http',host:'',port:8080,username:''}:await account.proxy().catch(()=>null) || {protocol:'http',host:'',port:8080,username:''};
  activeAISessionId=null;project='';sessionId=undefined;codexSessionId=undefined;codexModel=null;
  resetEnvironmentBrowser();emit('network',{state:'checking',reason:'正在连接当前环境保存的代理'});emit('account',{...account.state(),proxy:accountProxyView()});
  const proxyConnection=await connectEnvironmentProxy(savedConfig,{
   connect:config=>connect(config,true,{environmentSwitch:true}),
   block:async reason=>{await stopGateway();emit('network',{state:'blocked',reason});}
  });
  emit('chatAccountChanged',{});return {...await dockerEnvs.state(dockerOwner()),proxyConnection};
 }
 throw new Error('未知环境操作');
 }finally{containerOperation=false;if(account?.user){const ctx=cookieContext();await ctx.sync.sync().catch(ctx.sync.onError);}}
}));
ipcMain.handle('workspace:state', guarded(async () => ({
  containerId:activeContainerId,account:account?.state(),runtimeRegistry:runtimeOwner===(account?.user?.id || null)?registeredRuntimes:null,chatViews:chatViews.filter(v=>(aiSessions.get(v.id)?.environmentId || null)===activeContainerId),chatImportLegacy,chatOwner,
  environment: environmentStatus,
  proxy: { ...savedConfig, password: undefined, hasPassword: Boolean(savedConfig.password) },
  network: gateway?.status || { state: 'blocked', reason: '请先连接代理' },
  claudePath: await findClaude(), codexPath: codexPath=await findExecutable('codex'), selectedEngine, codexModel, defaultEngine, defaultCodexModel:activeContainerId?null:defaultCodexModel, activeAISessionId, aiSessions:[...aiSessions.values()].filter(item=>(item.environmentId || null)===activeContainerId), project, strictProtection: false, browser: browserState(),
})));
ipcMain.handle('workspace:saveChats',guarded(async(views,owner,environmentId=null)=>{
 if(accountChanging)throw new Error('正在切换账号，请稍候');
 if(accountChanging || containerOperation || chatNetworkChanging)throw new Error('正在处理环境或连接方式切换，请稍候');
 if(environmentId!==activeContainerId)throw new Error('对话环境已变化，请重新打开对话');
 if(owner!==chatOwner || owner!==account?.user?.id)throw new Error('对话账号已变化');
 if(!Array.isArray(views))throw new Error('对话数据过大');
 chatViews=[...chatViews.filter(view=>(aiSessions.get(view.id)?.environmentId || null)!==activeContainerId),...views.filter(view=>aiSessions.has(view.id) && (aiSessions.get(view.id)?.environmentId || null)===activeContainerId).map(view=>({id:view.id,title:String(view.title || '新会话').slice(0,200),updatedAt:view.updatedAt,pinned:Boolean(view.pinned),chatStatus:view.chatStatus,messages:Array.isArray(view.messages)?view.messages:[]}))];
 for(const view of chatViews){const item=aiSessions.get(view.id);item.title=view.title;item.pinned=Boolean(view.pinned);if(Number.isFinite(Date.parse(view.updatedAt)) && Date.parse(view.updatedAt)<=Date.now()+60000)item.updatedAt=view.updatedAt;}
 await persistAISessions();return {saved:true};
}));
ipcMain.handle('workspace:archiveSession',guarded(async(id,archived)=>{if(accountChanging || containerOperation || chatNetworkChanging)throw new Error('正在处理环境或连接方式切换，请稍候');if(runs.has(id))throw new Error('请先停止此对话的回复');const item=aiSessions.get(id);if(!item || (item.environmentId || null)!==activeContainerId)throw new Error('会话不存在');item.archived=Boolean(archived);await persistAISessions();return {...item};}));
ipcMain.handle('workspace:accountProfileSave',guarded(async value=>account.updateProfile(value)));
ipcMain.handle('workspace:avatarPick',guarded(async()=>{const {dialog}=await import('electron');const result=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'头像',extensions:['png','jpg','jpeg']}]});if(result.canceled)return null;const file=result.filePaths[0];if((await stat(file)).size>1024*1024)throw new Error('头像不能超过 1 MB');const data=await readFile(file);if(data.length>1024*1024)throw new Error('头像不能超过 1 MB');return 'data:image/'+(path.extname(file).toLowerCase()==='.png'?'png':'jpeg')+';base64,'+data.toString('base64');}));
let codexCapabilitiesCache;
async function currentCodexModels(){
 const owner=dockerOwner(),environmentId=activeContainerId,key=JSON.stringify([owner,environmentId]);
 if(codexCapabilitiesCache?.key===key && Date.now()-codexCapabilitiesCache.at<30000)return codexCapabilitiesCache.models;
 const spawnProcess=environmentId?await dockerEnvs.spawner(owner,environmentId):undefined;
 const models=await listCodexModels(environmentId?'codex':await findExecutable('codex'),gateway,spawnProcess);
 if(owner!==dockerOwner() || environmentId!==activeContainerId)throw new Error('模型查询期间环境已变化');
 codexCapabilitiesCache={key,at:Date.now(),models};return models;
}

async function repairSessionModel(item){
 if(item.engine==='deepseek' && !item.model){
  const owner=dockerOwner(),environmentId=activeContainerId;
  let runtime=registeredRuntimes?.runtimes.find(entry=>entry.id==='deepseek');
  if(!runtime?.model && environmentId)runtime=JSON.parse(await dockerEnvs.exec(owner,environmentId,['node','/home/node/.local/lib/dingtu/deepseek.mjs','info']));
  if(owner!==dockerOwner() || environmentId!==activeContainerId || aiSessions.get(item.id)!==item)throw new Error('会话环境已变化');
  if(!runtime?.model)throw new Error('无法读取 DeepSeek 默认模型，请重新检测运行时');
  item.model=runtime.model;if(item.id===activeAISessionId)codexModel=item.model;await persistAISessions();return;
 }
 if(item.engine!=='codex')return;
 const owner=dockerOwner(),environmentId=activeContainerId;
 const models=await currentCodexModels();if(owner!==dockerOwner() || environmentId!==activeContainerId || aiSessions.get(item.id)!==item)throw new Error('会话环境已变化');if(!models.length)throw new Error('无法读取当前账号可用模型，请连接代理后重试');
 if(models.some(model=>model.model===item.model))return;
 item.model=(models.find(model=>model.isDefault)||models[0]).model;
 item.codexSessionId=undefined;
 if(item.id===activeAISessionId){codexModel=item.model;codexSessionId=undefined;}
 await persistAISessions();
}
const runtimeViewCache=new Map();
async function runtimeView(registry,{refresh=true,engine=null}={}){
 const owner=dockerOwner(),id=activeContainerId,key=JSON.stringify([owner,id]);
 const previous=runtimeViewCache.get(key) || registry;
 const runtimes=await Promise.all(registry.runtimes.map(async item=>{
  const cached=previous.runtimes?.find(row=>row.id===item.id);
  if(!refresh || engine && item.id!==engine){
   const models=item.id==='codex'?(cached?.models?.some(m=>Array.isArray(m.supportedReasoningEfforts))?cached.models:await currentCodexModels().catch(()=>[])):item.models || cached?.models;
   return {...cached,...item,auth:item.auth || cached?.auth || {state:'unknown'},models:models || [],modelsError:item.id==='codex' && models===null?'模型列表读取失败，请重试':null,busy:[...runs.values()].some(task=>task.engine===item.id)};
  }
  const executable=id?null:item.id==='cc'?await findClaude():await findExecutable(RUNTIME_CATALOG[item.id]?.command || '');
  const auth=supportsChat(item.id)?id?await containerAuth(item.id):await detectAIAuth({engine:item.id,executable,gateway}):{state:'unknown'};
  return {...item,auth,...(item.id==='codex'?{models:await currentCodexModels().catch(()=>[])}:{}),busy:[...runs.values()].some(task=>task.engine===item.id)};
 }));
 if(owner!==dockerOwner() || id!==activeContainerId)throw new Error('运行时环境已变化');
 const result={...registry,runtimes};runtimeViewCache.set(key,result);registeredRuntimes=result;
 if(refresh){if(id)await dockerEnvs.update(owner,id,{registry:result});else if(owner)await account.saveRuntimes(result,owner);}
 return result;
}
ipcMain.handle('workspace:runtimePreview',guarded(async(kind)=>{
 const owner=dockerOwner();if(!owner)throw new Error('请先登录');if(!['local','docker'].includes(kind))throw new Error('环境类型无效');
 let result;if(kind==='docker')result=await dockerEnvs.previewRuntimes();else{const runtimes=[];await Promise.all(CLI_RUNTIMES.map(async id=>{const executable=id==='cc'?await findClaude():await findExecutable(RUNTIME_CATALOG[id].command);if(!executable)return;let version='版本检测失败';try{version=(await exec(executable,['--version'],{timeout:10000,maxBuffer:4096})).stdout.trim();}catch{}runtimes.push({id,name:RUNTIME_CATALOG[id].name,version});}));result={runtimes,checkedAt:new Date().toISOString()};}
 if(owner!==dockerOwner())throw new Error('检测期间账号已变化，请重新检测');return {...result,source:kind};
}));
ipcMain.handle('workspace:runtimeInfo',guarded(async(options={})=>{
 if(accountChanging || containerOperation || chatNetworkChanging)throw new Error('正在处理环境或连接方式切换，请稍候');
 if(options.refreshEngine && !['cc','codex','deepseek'].includes(options.refreshEngine))throw new Error('未知运行时');
 const owner=account?.user?.id || null;
 if(!activeContainerId && !localEnvironmentEnabled){if(options.detect)requireActiveEnvironment();return {runtimes:[]};}
 if(activeContainerId){if(runtimeDetection)throw new Error('正在检测运行时');runtimeDetection=true;try{const id=activeContainerId;const registry=await dockerEnvs.runtimeInfo(owner,id,options.detect);if(id!==activeContainerId || owner!==dockerOwner())throw new Error('检测期间环境已变化');runtimeOwner=owner;registeredRuntimes=registry;return runtimeView(registry,{refresh:Boolean(options.detect || options.refreshEngine),engine:options.refreshEngine || null});}finally{runtimeDetection=null;}}
 if(!options.detect)return runtimeOwner===owner && registeredRuntimes?runtimeView(registeredRuntimes,{refresh:Boolean(options.refreshEngine),engine:options.refreshEngine || null}):{hostName:hostname(),runtimes:[]};
 if(runtimeDetection)throw new Error('正在检测运行时');
 runtimeDetection=true;
 try{
 const runtimes=[];for(const id of CLI_RUNTIMES){const executable=id==='cc'?await findClaude():await findExecutable(RUNTIME_CATALOG[id].command);if(!executable)continue;let version='版本检测失败';try{version=(await exec(executable,['--version'],{timeout:10000,maxBuffer:4096})).stdout.trim();}catch{}runtimes.push({id,name:RUNTIME_CATALOG[id].name,version});}
 const registry={hostName:hostname(),checkedAt:new Date().toISOString(),runtimes};
 if(owner!==(account?.user?.id || null) || accountChanging)throw new Error('检测期间账号已变化，请重新检测');
 if(owner)await account.saveRuntimes(registry,owner);
 if(owner!==(account?.user?.id || null))throw new Error('检测期间账号已变化');
 runtimeOwner=owner;registeredRuntimes=registry;return runtimeView(registry);
 }finally{runtimeDetection=null;}
}));
ipcMain.handle('workspace:connectionRecords',guarded(async()=>{if(accountChanging || !account?.user)throw new Error('请先登录');const owner=account.user.id,environmentId=activeContainerId;const entries=await connectionRecords.list(owner,environmentId);if(owner!==account?.user?.id || environmentId!==activeContainerId)throw new Error('环境已变化');return entries;}));
ipcMain.handle('workspace:accountState',guarded(async()=>({...account.state(),authRequired,proxy:accountProxyView()})));
ipcMain.handle('workspace:accountLogin',guarded(async(credentials)=>{if(accountChanging || containerOperation)throw new Error('正在切换账号或环境');accountChanging=true;let prepared=false;try{await prepareChatAccountChange();prepared=true;await stopGateway();emit('network',{state:'blocked',reason:'账号登录中，代理已断开'});await account.login(credentials);if(window){window.show();window.focus();}return {...await applyAccount(),authRequired};}catch(error){if(prepared)await applyAccount().catch(()=>{});throw error;}finally{accountChanging=false;}}));
ipcMain.handle('workspace:accountCancel',guarded(async()=>{account.cancel();return true;}));
ipcMain.handle('workspace:accountLogout',guarded(async()=>{if(accountChanging || containerOperation)throw new Error('正在切换账号或环境');accountChanging=true;try{await prepareChatAccountChange();await stopGateway();const result=await account.logout();const state=await applyAccount();return {...state,...result};}finally{accountChanging=false;}}));
ipcMain.handle('workspace:accountProxySave',guarded(async(config,userId,environmentId=null)=>{
 if(accountChanging || containerOperation || chatNetworkChanging)throw new Error('正在处理环境或连接方式切换，请稍候');
 if(environmentId!==activeContainerId)throw new Error('代理环境已变化，请重新填写');
 if(accountChanging || !account.user)throw new Error('请先登录并等待账号就绪');
 const validated=validateProxy(config);if(!isIP(validated.host))throw new Error('上游代理必须填写 IP 地址');
 if(config.useSavedPassword){if(['protocol','host','port','username'].some(key=>String(config[key])!==String(savedConfig[key])))throw new Error('代理变化后请重新输入密码');validated.password=savedConfig.password || '';}
 if(userId!==dockerOwner())throw new Error('账号已变化');
 if(activeContainerId){await dockerEnvs.update(dockerOwner(),activeContainerId,{proxy:validated});savedConfig={...validated};return{saved:true};}
 const result=await account.saveProxy(validated,userId);savedConfig={...validated};return result;
}));
ipcMain.handle('workspace:environmentCheck', guarded(async sample => {
  if (fixtureMode && sample) fixtureEnvironment = sample;
  return checkEnvironment();
}));
ipcMain.handle('workspace:connect', guarded(async (config, remember) => {
  if (config.useSavedPassword) {
    if (['protocol', 'host', 'port', 'username'].some(key => String(config[key]) !== String(savedConfig[key]))) throw new Error('代理已变更，请重新输入密码');
    config.password = savedConfig.password || '';
  }
  return connect(config, remember);
}));
ipcMain.handle('workspace:disconnect', guarded(async () => { await stopGateway({preserveDirectChat:true}); emit('network', { state: 'blocked', reason: '已断开，使用代理的浏览器和对话请求已停止' }); return true; }));
ipcMain.handle('workspace:verify', guarded(async () => { await requireEnvironment(); if (!gateway) throw new Error('请先连接代理'); return gateway.checkNow(); }));
if (fixtureMode) ipcMain.handle('workspace:browserProbe', guarded(async (url, params, method = 'Runtime.evaluate') => {
  const tab = [...browserTabs.values()].find(tab => tab.wc.getURL() === url);
  if (!tab) throw new Error('Test page missing');
  if (!['Runtime.evaluate','Page.getFrameTree','Page.createIsolatedWorld'].includes(method)) throw new Error('Unsupported test command');
  return tab.wc.debugger.sendCommand(method, params);
}));
if (fixtureMode) ipcMain.handle('workspace:dnsProbe', guarded(async host => {
  try { await session.fromPartition(browserPartition()).resolveHost(String(host)); return { blocked: false }; }
  catch (error) { return { blocked: true, error: error.message }; }
}));
ipcMain.handle('workspace:networkSignal', guarded(async signal => {
  if (!gateway) return;
  if (signal === 'offline') gateway.block('系统报告网络断开，暂停访问并等待同一出口恢复', { recoverable: true });
  if (signal === 'online') return gateway.checkNow();
}));
ipcMain.handle('workspace:browseFiles', guarded(async ({directory,kind}={}) => {
  if(!['directory','file'].includes(kind)) throw new Error('无效选择类型');
  if(directory!==undefined && (typeof directory!=='string' || directory.length>4096)) throw new Error('无效目录');
  const requested=directory?.startsWith('~/')?path.join(app.getPath('home'),directory.slice(2)):directory;
  const current=path.resolve(requested || (kind==='file'?app.getPath('downloads'):(!activeContainerId && project) || app.getPath('home')));
  if(!(await stat(current)).isDirectory()) throw new Error('请选择目录');
  const entries=(await readdir(current,{withFileTypes:true})).filter(item=>!item.name.startsWith('.') && (item.isDirectory() || (kind==='file' && item.isFile() && /\.(txt|csv)$/i.test(item.name)))).sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory()) || a.name.localeCompare(b.name)).slice(0,2000).map(item=>({name:item.name,path:path.join(current,item.name),directory:item.isDirectory()}));
  return {directory:current,parent:path.dirname(current),entries};
}));
ipcMain.handle('workspace:project', guarded(async selected => {
 if(runs.has(activeAISessionId) || accountChanging || containerOperation)throw new Error('请先结束当前请求或环境切换');
 const owner=account?.user?.id,environment=activeContainerId,generation=chatGeneration;
 if(!owner)throw new Error('请先登录');
 if(selected?.action==='browse'){
  if(!environment)throw new Error('当前为本机环境，请使用本机项目方式');
  const result=await browseEnvironmentProject(dockerEnvs,owner,environment,selected.path);if(owner!==account?.user?.id || environment!==activeContainerId || generation!==chatGeneration)throw new Error('账号或环境已变化');return result;
 }
 const mode=selected?.mode || 'local',source=typeof selected==='string'?selected:selected?.path;
 let chosen;
 if(mode==='container' || mode==='import' || mode==='mount'){
  if(!environment)throw new Error('请先切换到容器环境');
  containerOperation=true;
  try{
   if(mode==='mount'){await stopGateway();emit('network',{state:'blocked',reason:'正在接入本机项目，完成后请重新连接代理'});chosen=await mountLocalProject(dockerEnvs,owner,environment,source);}
   else chosen=mode==='import'?await importEnvironmentProject(dockerEnvs,owner,environment,source):await selectEnvironmentProject(dockerEnvs,owner,environment,source);
  }finally{containerOperation=false;}
 }else{
  if(environment)throw new Error('直接修改本机项目需要切换到本机环境');
  if(typeof source!=='string' || !path.isAbsolute(source) || !(await stat(source)).isDirectory())throw new Error('请选择有效项目目录');
  chosen=source;
 }
 if(owner!==account?.user?.id || environment!==activeContainerId || generation!==chatGeneration)throw new Error('账号或环境已变化，请重新选择');
 // A working-directory change stays in this conversation; runtime resume receives the new cwd.
 project=chosen;storeCurrentSession();await sessionSave;
 return project;
}));
ipcMain.handle('workspace:browserCookies', guarded(async (settings) => {
 const owner=dockerOwner(),environmentId=activeContainerId;
 if(!owner)throw new Error('请先登录账号');
 if(accountChanging || containerOperation)throw new Error('账号或环境切换中，请稍后重试');
 const ctx=cookieContext();
 if(settings){
  if(!['local','account'].includes(settings.mode) || Object.hasOwn(settings,'environment'))throw new Error('Cookie 保存设置无效');
  await ctx.sync.setMode('local');ctx.sync.started=false;ctx.pref={mode:settings.mode};
  cookiePreferences[cookiePreferenceKey(owner,environmentId)]=ctx.pref;await saveCookiePreferences();ctx.error='';
  await ctx.sync.setMode(settings.mode).catch(()=>{ctx.error='Cookie 同步失败，请检查账号服务后刷新重试';});
 }else await ctx.sync.sync().catch(ctx.sync.onError);
 const storage=session.fromPartition(environmentBrowserPartition(owner,environmentId));
 await storage.cookies.flushStore();
 const cookies=await storage.cookies.get({});
 if(owner!==dockerOwner() || environmentId!==activeContainerId || accountChanging || containerOperation)throw new Error('账号或环境已切换，请重新打开设置');
 return {owner,environmentId,settings:ctx.pref,syncError:ctx.error,cookies:cookies.sort((a,b)=>a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name))};
}));
ipcMain.handle('workspace:browserSettings', guarded(async mode => {
 if(!['proxy','direct','mixed'].includes(mode))throw new Error('未知浏览器连接方式');
 if(browserRoutingChanging || connecting || accountChanging || containerOperation)throw new Error('网络或环境切换中，请稍后重试');
 const previous=browserMode;browserRoutingChanging=true;
 const currentSession=session.fromPartition(browserPartition());
 try{
  stopBrowserTabs();directBrowserTransport?.closeConnections();
  await configureBrowserSession(currentSession);
  await Promise.all(configuredBrowserSessions.values());
  for(const current of configuredBrowserSessions.keys())await current.closeAllConnections();
  browserMode=mode;
  const configuration=await browserProxyConfiguration();
  for(const current of configuredBrowserSessions.keys())await current.setProxy(configuration);
  await mkdir(app.getPath('userData'),{recursive:true,mode:0o700});
  const file=path.join(app.getPath('userData'),'browser-preferences.json');
  await writeFile(file+'.tmp',JSON.stringify({mode}),{mode:0o600});await rename(file+'.tmp',file);
 }catch(error){browserMode=previous;const configuration=await browserProxyConfiguration();for(const current of configuredBrowserSessions.keys())await current.setProxy(configuration);throw error;}
 finally{browserRoutingChanging=false;publishTabs();}
 return browserState();
}));
ipcMain.handle('workspace:browser', guarded(async (action, value) => {
  await requireEnvironment();
  if(action==='open'){if(!browserNetworkReady())return browserState();let current=browserTabs.get(activeTabId);if(!current)current=createBrowserTab();if(!current.started || (current.error && !current.privacyError))await navigateBrowserTab(current,current.url || browserHomeUrl);return browserState();}
  if (action === 'new') { createBrowserTab(browserNetworkReady() ? browserHomeUrl : undefined); return browserState(); }
  if (action === 'select') { activateBrowserTab(String(value)); return browserState(); }
  if (action === 'close') {
    const tab = browserTabs.get(String(value));
    if (tab) removeBrowserTab(tab, true);
    return browserState();
  }
  if (!browserNetworkReady()) throw new Error('出口未通过验证，浏览器访问已禁止');
  let tab = browserTabs.get(activeTabId);
  if (!tab?.wc || tab.wc.isDestroyed()) tab = createBrowserTab();
  if (action === 'navigate') navigateBrowserTab(tab, String(value));
  if (action === 'back' && browser.webContents.navigationHistory.canGoBack()) browser.webContents.navigationHistory.goBack();
  if (action === 'forward' && browser.webContents.navigationHistory.canGoForward()) browser.webContents.navigationHistory.goForward();
  if (action === 'reload' && tab.started) browser.webContents.reload();
  return true;
}));
// Use explicit pointer sessions for setup dragging, independent of Chromium app regions.
let windowDragSession=null;
ipcMain.handle('workspace:windowDrag',guarded(({phase,x,y}={})=>{
 if(phase==='cancel'){windowDragSession=null;return null;}
 if(phase==='toggleMaximize'){windowDragSession=null;if(!window.isFullScreen()){if(window.isMaximized())window.unmaximize();else window.maximize();}return true;}

 if(![x,y].every(Number.isFinite))return null;
 if(phase==='start'){
  windowDragSession=window.isMaximized() || window.isFullScreen()?null:{x,y,bounds:window.getBounds()};
 }else if(windowDragSession && (phase==='move' || phase==='end')){
  const origin=windowDragSession;
  window.setPosition(Math.round(origin.bounds.x+x-origin.x),Math.round(origin.bounds.y+y-origin.y),false);
  if(phase==='end')windowDragSession=null;
 }
 return window.getBounds();
}));
ipcMain.handle('workspace:console',guarded(async(action,value={})=>{
 if(action==='close'){if(value.token===consoleSession?.token)closeConsole();return true;}
 if(!dockerOwner() || !activeContainerId){closeConsole();if(action==='status')return {available:false,message:'请选择 Docker 容器环境后使用控制台。'};throw new Error('控制台仅连接当前账号的 Docker 容器');}
 if(accountChanging || containerOperation)throw new Error('环境正在切换，请稍后重试');
 if(action==='status'){const {item}=await dockerEnvs.get(dockerOwner(),activeContainerId);return {available:true,id:activeContainerId,name:item.name,external:Boolean(item.external),codexAuth:item.registry?.runtimes?.some(entry=>entry.id==='codex')?await containerAuth('codex'):null};}
 if(action==='open'){
  if(value.loginEngine!==undefined && !['cc','codex'].includes(value.loginEngine))throw new Error('未知运行时');
  if(value.loginEngine && gateway?.status.state!=='ready')throw new Error('请先连接当前环境的代理');
  if(consoleOpening)throw new Error('终端正在连接');consoleOpening=true;closeConsole();
  const connection=new ContainerTerminal(dockerEnvs,dockerOwner(),activeContainerId);consoleSession=connection;
  const current=()=>consoleSession===connection && connection.owner===dockerOwner() && connection.id===activeContainerId;
  connection.on('data',text=>{if(current())emit('console',{token:connection.token,type:'data',text});});
  connection.on('open-url',url=>{if(current())emit('console',{token:connection.token,type:'open-url',url});});
  connection.on('notice',text=>{if(current())emit('console',{token:connection.token,type:'notice',text});});
  connection.on('exit',()=>{emit('console',{token:connection.token,type:'exit'});if(consoleSession===connection)consoleSession=null;});
  try{await connection.open(value.cols,value.rows,value.loginEngine);if(!current() || connection.closed)throw new Error('终端连接已取消，请重新连接');return {token:connection.token};}
  catch(error){if(consoleSession===connection)consoleSession=null;connection.close();throw error;}finally{consoleOpening=false;}
 }
 const connection=consoleSession;
 if(!connection || value.token!==connection.token || connection.owner!==dockerOwner() || connection.id!==activeContainerId)throw new Error('终端已断开，请重新连接');
 if(action==='input'){connection.write(value.data);return true;}
 if(action==='ack'){connection.acknowledge(value.bytes);return true;}
 if(action==='resize'){await connection.resize(value.cols,value.rows);return true;}
 throw new Error('未知控制台操作');
}));
ipcMain.handle('workspace:bounds', guarded(async ({ x, y, width, height, visible }) => {
  browserVisible = Boolean(visible);
  if ([x, y, width, height].every(Number.isFinite)) browserBounds = { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  showBrowserViews();
}));
let learningAutomations;
async function runLearningAutomation(item,question,controller){
 const ownerId=item.owner,environmentId=item.environmentId,requiresProxy=item.networkMode!=='direct';
 if(ownerId!==account?.user?.id || environmentId!==activeContainerId || accountChanging || containerOperation)throw new Error('账号或环境已变化');
 if(requiresProxy && !gateway && !runs.size)await connect(savedConfig,false);
 const proxy=requiresProxy?gateway:{status:{state:'ready',mode:'direct'}};
 const valid=()=>account?.user?.id===ownerId && activeContainerId===environmentId && !accountChanging && !containerOperation && environmentStatus.allowed && (!requiresProxy || gateway===proxy && proxy?.status.state==='ready') && !controller.signal.aborted;
 if(!valid())throw new Error('当前环境的代理未连接或出口未核验；本次未发送，问题进度保留。');
 const abortIfInvalid=setInterval(()=>{if(!valid())controller.abort();},500);
 const timeout=setTimeout(()=>controller.abort(),180000);
 try{
  const launch=environmentId?await (requiresProxy?dockerEnvs.spawner(ownerId,environmentId):dockerEnvs.directChatSpawner(ownerId,environmentId)):(requiresProxy?createRestrictedCCSpawner({port:proxy.port,canStart:valid}):createDirectChatSpawner(valid));
  const spawnProcess=options=>{if(!valid())throw new Error('账号、环境或连接状态已变化');return launch(environmentId?options:{...options,env:localGitEnvironment(options.env || process.env,ownerId,requiresProxy?proxy.url:'')});};
  const cwd=environmentId?await dockerEnvs.workingDirectory(ownerId,environmentId):path.join(app.getPath('userData'),'learning-workspaces',item.id);
  if(!environmentId)await mkdir(cwd,{recursive:true,mode:0o700});if(!valid())throw new Error('账号、环境或代理已变化');
  let text='',nextSession=item.sessionId;
  const prompt=(item.language==='zh'?'请结合本次对话的前文，回答当前问题；需要时给出可验证的例子。':'Answer the current question in the context of this conversation. Include verifiable examples when useful.')+'\n\n'+question.prompt;
  if(item.engine==='codex'){
   const executable=environmentId?'codex':await findExecutable('codex');if(!executable)throw new Error('未安装 Codex');
   await runCodex({executable,project:cwd,prompt,sessionId:item.sessionId,gateway:proxy,signal:controller.signal,canStart:valid,spawnProcess,useLocalModel:!environmentId,onEvent:(type,value)=>{if(type==='text')text+=value;if(type==='session')nextSession=value;}});
  }else{
   const executable=environmentId?'claude':await findClaude();if(!executable)throw new Error('未安装 Claude Code');
   for await(const message of query({prompt,options:{cwd,pathToClaudeCodeExecutable:executable,spawnClaudeCodeProcess:spawnProcess,env:chatRuntimeEnvironment(requiresProxy?proxyEnvironment(process.env,proxy.url):directChatEnvironment(process.env)),abortController:controller,resume:item.sessionId,permissionMode:'bypassPermissions',allowDangerouslySkipPermissions:true,settingSources:['user','project','local']}})){
    if(message.session_id)nextSession=message.session_id;
    if(message.type==='assistant')for(const c of message.message.content || [])if(c.type==='text')text+=c.text;
    if(message.type==='result'&&message.is_error)throw new Error('运行时返回错误，请检查登录、额度与代理');
   }
  }
  if(!valid())throw new Error('执行期间环境或代理已变化');if(!text.trim())throw new Error('未收到对话回复');return{text:text.slice(0,60000),sessionId:nextSession,ip:proxy.status.ip};
 }finally{clearTimeout(timeout);clearInterval(abortIfInvalid);}
}
ipcMain.handle('workspace:notification',guarded((action,value={})=>{
 if(action==='status')return {supported:Notification.isSupported()};
 if(action!=='show')throw new Error('未知通知操作');
 if(value.owner!==(account?.user?.id || null) || !Notification.isSupported() || !window || window.isDestroyed() || window.isFocused())return {shown:false};
 const message=typeof value.message==='string'?value.message.slice(0,500):'';if(!message)return {shown:false};
 const owner=value.owner,notification=new Notification({title:'Kuneco',body:message,silent:true});
 notification.on('click',()=>{if(owner===(account?.user?.id || null) && window && !window.isDestroyed()){window.show();window.focus();}});notification.show();return {shown:true};
}));
ipcMain.handle('workspace:learningAutomation',guarded(async(action='list',value={})=>{
 if(!learningAutomations)throw new Error('自动化尚未就绪');
 if(action==='list')return learningAutomations.list();if(action==='create'){await learningAutomations.create(value);return learningAutomations.list();}
 await learningAutomations.change(value.id,action,value);return learningAutomations.list();
}));

ipcMain.handle('workspace:cancel', guarded(async (id=activeAISessionId) => { if(!aiSessions.has(id))throw new Error('会话不存在');abortRun(task=>task.chatId===id); return true; }));
ipcMain.handle('workspace:sessionEffort',guarded(async value=>{
 const item=insightSession(value);if(runs.has(item.id))throw new Error('请先等待当前回复完成');
 if(item.engine!=='codex')throw new Error('当前运行时未提供可验证的推理强度选项');
 await repairSessionModel(item);const models=await currentCodexModels();insightSession(value);
 const model=models.find(m=>m.model===item.model);
 if(value.effort!==null && !model?.supportedReasoningEfforts?.some(v=>v.reasoningEffort===value.effort))throw new Error('当前模型不支持此推理强度');
 item.reasoningEffort=value.effort;await persistAISessions();return {reasoningEffort:item.reasoningEffort};
}));
ipcMain.handle('workspace:sessionModel',guarded(async(id,model)=>{
 if(accountChanging || containerOperation || chatNetworkChanging)throw new Error('正在切换对话或环境，请稍后');
 const item=aiSessions.get(id);
 if(!item || id!==activeAISessionId || (item.environmentId || null)!==activeContainerId || runtimeOwner!==(account?.user?.id || null))throw new Error('对话账号或环境已变化');
 const runtime=registeredRuntimes?.runtimes.find(entry=>entry.id===item.engine);
 if(!runtime || !runtime.models?.some(entry=>entry.model===model))throw new Error('当前运行时不支持此模型，请刷新模型列表');
 item.model=model;item.reasoningEffort=null;codexModel=model;await persistAISessions();
 return {id,model};
}));
ipcMain.handle('workspace:sessionNetwork',guarded(async(id,mode)=>{
 if(chatNetworkChanging || containerOperation || accountChanging)throw new Error('正在切换对话或环境，请稍后');
 const item=aiSessions.get(id),owner=chatOwner,environment=activeContainerId;
 if(!item || id!==activeAISessionId || (item.environmentId || null)!==environment)throw new Error('请在当前对话中切换连接方式');
 const choice=validateSessionOptions({engine:item.engine,networkMode:mode});
 if(chatNetworkMode(item)===choice.networkMode)return {id,networkMode:choice.networkMode};
 chatNetworkChanging=true;
 try{
  if(runs.has(id)){const pending=runs.get(id);abortRun(task=>task.chatId===id);let timer;try{await Promise.race([pending.finished,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('请求仍在停止，请稍后重新切换')),10000))]);}finally{clearTimeout(timer);}}
  if(chatOwner!==owner || activeContainerId!==environment || aiSessions.get(id)!==item || activeAISessionId!==id)throw new Error('对话环境已变化，请重新选择');
  item.networkMode=choice.networkMode;let saveError;try{await persistAISessions();}catch(error){saveError=error;}
  emit('chatNetworkMode',{id,networkMode:item.networkMode});if(saveError)throw new Error('当前连接方式已切换，但保存失败，请稍后重试');return {id,networkMode:item.networkMode};
 }finally{chatNetworkChanging=false;}
}));
ipcMain.handle('workspace:newSession',guarded(async(options)=>{
 const generation=chatGeneration;
 if(accountChanging || containerOperation || chatNetworkChanging)throw new Error('正在处理环境或连接方式切换，请稍候');
 requireActiveEnvironment();const choice=validateSessionOptions(options);
 if(accountChanging || runtimeOwner!==(account?.user?.id || null) || !registeredRuntimes?.runtimes.some(item=>item.id===choice.engine))throw new Error('请先前往运行时手动检测本机运行时');
 if(activeContainerId && !(await dockerEnvs.state(dockerOwner())).environments.find(item=>item.id===activeContainerId)?.running)throw new Error('请先启动当前容器环境');await requireEnvironment();if(accountChanging || generation!==chatGeneration)throw new Error('对话账号或环境已变化');storeCurrentSession();
 const item={id:randomUUID(),environmentId:activeContainerId,engine:choice.engine,model:choice.model,networkMode:choice.networkMode,project:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),sessionId:undefined,codexSessionId:undefined};aiSessions.set(item.id,item);if(['deepseek','codex'].includes(item.engine))await repairSessionModel(item);activateAISession(item,{viewed:true});
 const executable=item.engine==='cc'?await findClaude():await findExecutable('codex');
 return {...item,...(item.engine==='codex'?{models:await currentCodexModels().catch(()=>[])}:{}),auth:activeContainerId?await containerAuth(item.engine):await detectAIAuth({engine:item.engine,executable,gateway})};
}));
function insightSession(value){
 const item=aiSessions.get(value?.chatId);
 if(!item||value.owner!==account?.user?.id||value.environmentId!==activeContainerId||(item.environmentId||null)!==activeContainerId||accountChanging||containerOperation)throw new Error('对话账号或环境已变化');
 return item;
}
const chatPopouts=createChatPopouts({BrowserWindow,ipcMain,parent:()=>window,scope:()=>({owner:chatOwner,environmentId:activeContainerId}),basePath:here});
ipcMain.handle('workspace:chatPopout',guarded(async(action,value)=>{chatPopouts.closeInvalid();if(action==='sync'){if(value?.scope?.owner!==chatOwner || value.scope.environmentId!==activeContainerId)return;insightSession(value.scope);chatPopouts.publish(value);return true;}if(action==='open'){insightSession(value);return chatPopouts.open(value);}if(action==='closeInvalid'){chatPopouts.closeInvalid();return true;}throw new Error('未知窗口操作');}));
ipcMain.handle('workspace:chatInsights',guarded(async value=>{const item=insightSession(value);return {...insightView(item,chatViews,{owner:account?.user?.id,environmentId:activeContainerId,chatId:item.id}),running:runs.has(item.id)};}));
ipcMain.handle('workspace:chatArtifact',guarded(async value=>{
 const item=insightSession(value),owner=dockerOwner(),environment=activeContainerId;
 const artifact=insightView(item,chatViews).artifacts.find(a=>a.id===value.id);if(!artifact)throw new Error('没有此真实产物记录');
 if(typeof artifact.after==='string'&&value.version!==false)return serveArtifact({kind:/\.html?$/i.test(artifact.path)?'html':/\.md$/i.test(artifact.path)?'markdown':'text',text:artifact.after,snapshot:true},owner,environment);
 let result;if(environment){const source=await readFile(new URL('../features/runtimes/artifact-read.mjs',import.meta.url),'utf8');result=JSON.parse(await dockerEnvs.exec(owner,environment,['node','--input-type=module','-e',source+"\nconsole.log(JSON.stringify(await readArtifact(process.argv[1])));",artifact.path],{timeout:10000,maxBuffer:4000000}));}else result=await readArtifact(artifact.path);
 insightSession(value);return serveArtifact(result,owner,environment);
}));
ipcMain.handle('workspace:chatCompact',guarded(async value=>{
 const item=insightSession(value);if(item.contextPrefix)throw new Error('当前对话尚有待恢复的上下文，请先完成回复再压缩');if(item.engine==='codex'&&!item.codexSessionId)throw new Error('请先完成一轮 Codex 对话');if(!['deepseek','codex'].includes(item.engine))throw new Error('当前运行时尚未接入压缩能力');
 if(!['compact','restore'].includes(value.action))throw new Error('未知上下文操作');
 const owner=dockerOwner(),environment=activeContainerId,generation=chatGeneration;
 const controller=runs.begin(item.id,{engine:item.engine,requestId:randomUUID(),networkMode:chatRequestRoute(item,gateway?.status)});
 const proxy=controller.networkMode==='proxy',networkOwner=gateway;let timeout;
 const valid=()=>!controller.signal.aborted&&generation===chatGeneration&&owner===dockerOwner()&&environment===activeContainerId&&(!proxy||gateway===networkOwner&&gateway?.status.state==='ready');
 try{
  await requireEnvironment();requireActiveEnvironment();if(!valid())throw new Error('环境或代理不可用');
  if(value.action==='restore'&&item.engine!=='deepseek')throw new Error('运行时未提供恢复接口');
  if(value.action==='compact'){const auth=environment?await containerAuth(item.engine):await detectAIAuth({engine:item.engine,executable:await findExecutable('codex'),gateway});if(auth.state!=='signed-in')throw new Error('当前环境运行时未登录');}
  if(item.engine==='deepseek'){if(!environment)throw new Error('DeepSeek 需要当前容器环境');await dockerEnvs.syncDeepSeekSource(owner,environment);}
  const base=environment?await (proxy?dockerEnvs.spawner(owner,environment):dockerEnvs.directChatSpawner(owner,environment)):(proxy?createRestrictedCCSpawner({port:gateway.port,canStart:valid}):createDirectChatSpawner(valid));
  const launch=options=>{if(!valid())throw new Error('环境或代理已变化');return base({...options,signal:controller.signal,...(!environment?{env:chatRuntimeEnvironment(proxy?proxyEnvironment(process.env,gateway.url):directChatEnvironment(process.env))}:{})});};
  timeout=setTimeout(()=>controller.abort(),180000);
  const record=item.engine==='deepseek'?await deepSeekMaintenance({spawnProcess:launch,command:value.action,sessionId:item.deepseekSessionId||item.id,model:item.model,networkMode:proxy?'proxy':'direct',record:item.compression}):await compactCodex({spawnProcess:launch,executable:environment?'codex':await findExecutable('codex'),cwd:item.project||(environment?await dockerEnvs.workingDirectory(owner,environment):process.cwd()),threadId:item.codexSessionId,model:item.model,signal:controller.signal});
  if(!valid())throw new Error('操作结束时环境已变化，请回到原环境确认状态');
  item.compression=record;if(value.action==='compact'&&Number.isSafeInteger(record.usage?.total_tokens)){(item.tokenUsage||=[]).push({at:record.at,totalTokens:record.usage.total_tokens,purpose:'compaction',details:usageDetails('deepseek',record.usage)});}await persistAISessions();return {...insightView(item,chatViews),running:false};
 }catch(error){if(controller.signal.aborted)throw new Error('已停止上下文操作；未自动重试');throw error;}finally{clearTimeout(timeout);runs.finish(controller);}
}));
ipcMain.handle('workspace:chatContext',guarded(async(value={})=>{
 const owner=dockerOwner(),environmentId=activeContainerId,item=aiSessions.get(value.chatId);
 if(!item||(item.environmentId||null)!==environmentId||accountChanging||containerOperation)throw new Error('对话环境已变化，请重新打开列表');
 if(!['skills','files'].includes(value.kind)||typeof value.query!=='string'||value.query.length>200)throw new Error('查询无效');
 const registry=await runtimeView(registeredRuntimes,{refresh:false});const runtime=registry.runtimes?.find(r=>r.id===item.engine);if(!runtime)throw new Error('当前环境未安装此运行时，请先检测运行时');
 const project=item.project;const cwd=project||(environmentId?await dockerEnvs.workingDirectory(owner,environmentId):path.join(app.getPath('userData'),'chat-workspaces',item.id));
 const request={cwd,engine:item.engine,kind:value.kind,query:item.engine==='cc'&&value.kind==='skills'?'':value.query,...(!environmentId&&item.engine==='codex'?{executable:await findExecutable('codex')}:{})};let result;
 if(environmentId){const source=await readFile(new URL('../features/runtimes/context-catalog.mjs',import.meta.url),'utf8');result=JSON.parse(await dockerEnvs.exec(owner,environmentId,['node','--input-type=module','-e',source+"\nlet input='';for await(const chunk of process.stdin)input+=chunk;console.log(JSON.stringify(await listChatContext(JSON.parse(input))));"],{input:JSON.stringify(request),timeout:15000,maxBuffer:2000000}));}
 else {await mkdir(cwd,{recursive:true});result=await listChatContext(request);}
 if(item.engine==='cc'&&value.kind==='skills'){
  const controller=new AbortController();let execution,timer;
  try{
   const launch=environmentId?await dockerEnvs.spawner(owner,environmentId):undefined;
   execution=query({prompt:(async function*(){await new Promise(resolve=>controller.signal.addEventListener('abort',resolve,{once:true}));})(),options:{cwd,pathToClaudeCodeExecutable:environmentId?'claude':await findClaude(),spawnClaudeCodeProcess:launch,abortController:controller,settingSources:['user','project','local']}});
   const commands=await Promise.race([execution.supportedCommands(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Claude 技能能力检测超时')),10000);})]);
   result.items=reconcileClaudeSkills(result.items,commands);
  }catch(error){result.items=result.items.map(item=>({...item,enabled:false,reason:'运行时能力未确认'}));result.warnings.push('Claude 技能能力检测失败：'+error.message);}
  finally{clearTimeout(timer);controller.abort();execution?.close();}
  result.items=result.items.filter(item=>(item.name+' '+item.description).toLowerCase().includes(value.query.toLowerCase()));
 }
 if(owner!==dockerOwner()||environmentId!==activeContainerId||project!==(aiSessions.get(value.chatId)?.project))throw new Error('查询期间环境或项目已变化');
 return {...result,engine:item.engine,environmentId,chatId:item.id};
}));
ipcMain.handle('workspace:selectSession',guarded(async(id,options={})=>{const generation=chatGeneration;if(accountChanging || containerOperation || chatNetworkChanging)throw new Error('正在处理环境或连接方式切换，请稍候');const item=aiSessions.get(id);if(!item || (item.environmentId || null)!==activeContainerId)throw new Error('会话不存在');storeCurrentSession();if(!options.deferAuth)await repairSessionModel(item);if(accountChanging || generation!==chatGeneration || aiSessions.get(id)!==item)throw new Error('对话账号或环境已变化');activateAISession(item,{viewed:options.viewed ?? !options.deferAuth});if(options.deferAuth)return {...item,auth:{state:'checking'}};const executable=item.engine==='cc'?await findClaude():await findExecutable('codex');return {...item,...(item.engine==='codex'?{models:await currentCodexModels().catch(()=>[])}:{}),auth:activeContainerId?await containerAuth(item.engine):await detectAIAuth({engine:item.engine,executable,gateway})};}));
ipcMain.handle('workspace:readChatImage',guarded(async value=>{
 const owner=account?.user?.id || null,environment=activeContainerId;
 if(value?.owner!==owner || value.environmentId!==environment || accountChanging || containerOperation)throw new Error('图片所属环境已变化');
 const file=value.path;if(typeof file!=='string' || !path.isAbsolute(file) || file.includes('\0') || !/\.(png|jpe?g|gif|webp)$/i.test(file))throw new Error('图片路径无效');
 let bytes;if(environment){const raw=await dockerEnvs.exec(owner,environment,['node','-e',"const fs=require('fs'),p=process.argv[1];if(fs.statSync(p).size>32*1024*1024)throw Error('图片过大');process.stdout.write(fs.readFileSync(p).toString('base64'))",file],{maxBuffer:46*1024*1024});bytes=Buffer.from(raw,'base64');}else{if((await stat(file)).size>32*1024*1024)throw new Error('图片过大');bytes=await readFile(file);}
 if(owner!==(account?.user?.id || null) || environment!==activeContainerId)throw new Error('图片所属环境已变化');
 if(nativeImage.createFromBuffer(bytes).isEmpty())throw new Error('图片内容无效');const ext=path.extname(file).toLowerCase().slice(1);return {name:path.basename(file),dataURL:'data:image/'+(ext==='jpg'?'jpeg':ext)+';base64,'+bytes.toString('base64')};
}));
ipcMain.handle('workspace:imagePreviewOpen',guarded(async image=>{
 if(image?.url){const url=new URL(image.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('无效图片链接');await shell.openExternal(url.href);return;}
 const match=/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image?.dataURL || '');if(!match || match[2].length>90*1024*1024)throw new Error('无效图片');
 const bytes=Buffer.from(match[2],'base64');if(nativeImage.createFromBuffer(bytes).isEmpty())throw new Error('无法打开图片');
 const dir=path.join(app.getPath('temp'),'dingtu-image-preview');await mkdir(dir,{recursive:true,mode:0o700});const imagePath=path.join(dir,Date.now()+'.'+match[1]);await writeFile(imagePath,bytes,{mode:0o600});const error=await shell.openPath(imagePath);if(error)throw new Error(error);
}));
ipcMain.handle('workspace:engine',guarded(async engine=>{if(runs.size) throw new Error('请先停止当前请求');if(!['cc','codex','deepseek'].includes(engine))throw new Error('未知本机工具');defaultEngine=engine;await saveEnginePreference();return engine;}));
ipcMain.handle('workspace:aiAuth',guarded(async engine=>{if(!['cc','codex','deepseek'].includes(engine))throw new Error('未知工具');if(activeContainerId)return containerAuth(engine);const executable=engine==='cc'?await findClaude():await findExecutable('codex');return detectAIAuth({engine,executable,gateway});}));
ipcMain.handle('workspace:codexModel',guarded(async model=>{if(runs.size)throw new Error('请先停止当前请求');if(model!==null && (typeof model!=='string' || !/^[a-zA-Z0-9._:-]{1,100}$/.test(model)))throw new Error('无效模型名称');defaultCodexModel=model;await saveEnginePreference();return model;}));
ipcMain.handle('workspace:codexInfo',guarded(async()=>{if(activeContainerId){try{return{available:true,version:await dockerEnvs.exec(dockerOwner(),activeContainerId,['codex','--version']),model:null,models:await currentCodexModels().catch(()=>[])};}catch{return{available:false};}}codexPath=await findExecutable('codex');if(!codexPath)return{available:false};try{const {stdout}=await exec(codexPath,['--version'],{timeout:10000,maxBuffer:4096});return{available:true,version:stdout.trim(),model:await readCodexModel(),models:await currentCodexModels()};}catch{return{available:true,version:'版本检测失败'};}}));
ipcMain.handle('workspace:approval', guarded(async (id, allow) => {
  return toolApprovals.decide(id,allow,{owner:account?.user?.id || null,environmentId:activeContainerId});
}));
ipcMain.handle('workspace:cc', guarded(async (prompt,rewind,chatId=activeAISessionId,requestId=randomUUID()) => {
  const generation=chatGeneration,requestOwner=account?.user?.id || null,environmentId=activeContainerId;
  const preparedChat=aiSessions.get(chatId);
  if(!preparedChat || (preparedChat.environmentId || null)!==environmentId)throw new Error('对话不存在');
  const engine=preparedChat.engine;
  const controller=runs.begin(chatId,{engine,requestId,networkMode:chatRequestRoute(preparedChat,gateway?.status)});
  const fileChangeTurn={id:randomUUID(),owner:requestOwner,environmentId,chatId};
  preparedChat.fileChangeTurn=fileChangeTurn;
  const emitChat=(type,data)=>{if(type==='ccActivity')recordArtifacts(preparedChat,data,fileChangeTurn.id);emit(type,data,{chatId,requestId,owner:requestOwner,environmentId});};
  const valid=()=>!controller.signal.aborted && generation===chatGeneration && requestOwner===(account?.user?.id || null) && environmentId===activeContainerId && aiSessions.get(chatId)===preparedChat;
  try {
  if(['deepseek','codex'].includes(engine)){if(prompt && typeof prompt==='object')prompt={...prompt,text:documentPrompt(prompt.text,normalizeDocuments(prompt.documents||[]))};prompt=engine==='codex'?normalizeCodexInput(prompt):normalizeDeepSeekInput(prompt);for(const image of prompt.images){if(!image.dataURL)continue;const decoded=nativeImage.createFromDataURL(image.dataURL),size=decoded.getSize();const limit=prompt.images.length>=15?4096:8192;if(decoded.isEmpty() || size.width>limit || size.height>limit)throw new Error('图片无效或尺寸超过 '+limit+' 像素');}}
  if(accountChanging || containerOperation || chatNetworkChanging)throw new Error('正在处理环境或连接方式切换，请稍候');
  await requireEnvironment();requireActiveEnvironment();
  if(!chatId || runtimeOwner!==(account?.user?.id || null) || !registeredRuntimes?.runtimes.some(item=>item.id===engine))throw new Error('请先手动检测运行时并新建对话');
  await repairSessionModel(preparedChat);
  if(accountChanging || !valid())throw new Error('对话账号或环境已变化，请重新发送');
  const model=preparedChat.model,requestProject=preparedChat.project;
  if(engine==='codex' && preparedChat.reasoningEffort){const capability=(await currentCodexModels()).find(m=>m.model===model);if(!capability?.supportedReasoningEfforts?.some(v=>v.reasoningEffort===preparedChat.reasoningEffort))throw new Error('模型推理强度已不可用，请重新选择');}
  const preparedMode=chatNetworkMode(preparedChat);
  const requiresProxy=chatRequestRoute(preparedChat,gateway?.status)==='proxy';
  if (requiresProxy && gateway?.status.state !== 'ready') throw new Error('出口未通过验证，CC 请求已禁止');
  if (!activeContainerId && engine==='cc' && !claudePath) throw new Error('没有检测到本机 CC');
  if (!activeContainerId && engine==='codex') {codexPath=await findExecutable('codex');if(!codexPath)throw new Error('没有检测到本机 Codex CLI');}
  const auth=activeContainerId?await containerAuth(engine):await detectAIAuth({engine:engine,executable:engine==='cc'?claudePath:codexPath,gateway});
  if(auth.state!=='signed-in')throw new Error(auth.state==='signed-out'?'当前环境运行时未登录，请先在官方CLI完成登录后重新检测。':'无法确认本机工具登录态，请重新检测。');
  if(activeContainerId && engine==='deepseek'){
   await dockerEnvs.syncDeepSeekSource(dockerOwner(),activeContainerId);
  }
  const containerSpawn=activeContainerId?await (requiresProxy?dockerEnvs.spawner(dockerOwner(),activeContainerId):dockerEnvs.directChatSpawner(dockerOwner(),activeContainerId)):null;
  const workingDirectory=activeContainerId?(requestProject || await dockerEnvs.workingDirectory(dockerOwner(),activeContainerId)):requestProject || path.join(app.getPath('userData'),'chat-workspaces',chatId);
  if(!activeContainerId && !requestProject)await mkdir(workingDirectory,{recursive:true,mode:0o700});
  if (!['deepseek','codex'].includes(engine) && (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 50000)) throw new Error('请输入有效内容（不超过 50000 字符）');
  if(accountChanging || generation!==chatGeneration || requestOwner!==(account?.user?.id || null) || chatNetworkChanging || !valid() || chatNetworkMode(preparedChat)!==preparedMode)throw new Error('对话连接方式已变化，请重新发送');
  if(requiresProxy && gateway?.status.state!=='ready')throw new Error('代理状态已变化，请重新发送');
  if(rewind){
   if(rewind.chatId!==chatId)throw new Error('编辑的对话已变化');
   const prefix=rewindPrefix(rewind.messages,rewind.index);
   preparedChat.contextPrefix=prefix;preparedChat.deepseekSessionId=randomUUID();
   if(activeAISessionId===chatId){sessionId=undefined;codexSessionId=undefined;}preparedChat.sessionId=undefined;preparedChat.codexSessionId=undefined;
   const view=chatViews.find(v=>v.id===chatId);
   if(view)view.messages=[...rewind.messages.slice(0,rewind.index),{role:'user',text:typeof prompt==='string'?prompt:prompt.text,images:prompt.images || []}];
  }
  controller.networkMode=requiresProxy?'proxy':'direct';
  const nativeSessionId=preparedChat.sessionId,nativeCodexId=preparedChat.codexSessionId;
  const owner = requiresProxy?gateway:{status:{state:'ready',mode:'direct'}};
  const canContinue=()=>valid() && environmentStatus.allowed && !controller.signal.aborted && (!requiresProxy || gateway===owner && owner.status.state==='ready');
  const directSpawn=requiresProxy?null:createDirectChatSpawner(canContinue);
  const baseLaunch=containerSpawn || directSpawn || createRestrictedCCSpawner({port:owner.port,canStart:canContinue});
  const launch=options=>{if(!canContinue())throw new Error('对话网络不可用');return baseLaunch(activeContainerId?options:{...options,env:localGitEnvironment(options.env || process.env,requestOwner,requiresProxy?owner.url:'')});};
  const currentChat=preparedChat;if(currentChat){currentChat.updatedAt=new Date().toISOString();persistAISessions();}
  const usageOwner=chatOwner;
  let latestUsage=null,latestUsageDetails=null;
  emitChat('ccStart', {updatedAt:currentChat?.updatedAt,model:currentChat?.model});
  void (async () => {
    try {
      if(engine==='deepseek'){
        if(!containerSpawn)throw new Error('DeepSeek 仅在当前容器环境可用');
        const usage=await runDeepSeek({onUsage:usage=>{latestUsage=Number.isSafeInteger(usage?.total_tokens)?usage.total_tokens:null;latestUsageDetails=usageDetails('deepseek',usage);},onCompaction:record=>{delete currentChat.contextPrefix;currentChat.compression=record;if(Number.isSafeInteger(record.usage?.total_tokens)){const entry={at:record.at,totalTokens:record.usage.total_tokens,purpose:'compaction',details:usageDetails('deepseek',record.usage)};(currentChat.tokenUsage||=[]).push(entry);emitChat('ccUsage',{sessionId:currentChat.id,entry});}void persistAISessions();},project:workingDirectory,onActivity:activity=>emitChat('ccActivity',activity),networkMode:requiresProxy?'proxy':'direct',spawnProcess:launch,sessionId:currentChat.deepseekSessionId || chatId,history:currentChat.contextPrefix?deepSeekPrefix(currentChat.contextPrefix):undefined,model:model,prompt,signal:controller.signal,onText:text=>emitChat('ccText',text),onReasoning:text=>emitChat('ccReasoning',text),onFinish:reason=>{if(reason==='length')emitChat('ccNotice','回复达到长度限制，可继续追问。');}});latestUsage=Number.isSafeInteger(usage?.total_tokens)?usage.total_tokens:null;latestUsageDetails=usageDetails('deepseek',usage);
        delete currentChat.contextPrefix;emitChat('ccResult',{error:false});return;
      }
      if(engine==='codex') {
        await runCodex({useLocalModel:!activeContainerId,spawnProcess:launch || undefined,executable:activeContainerId?'codex':codexPath,project:workingDirectory,model:model,reasoningEffort:preparedChat.reasoningEffort,images:[...(!nativeCodexId?currentChat.contextPrefix?.flatMap(m=>m.images || []) || []:[]),...prompt.images],prompt:!nativeCodexId?replayPrompt(currentChat.contextPrefix,prompt.text):prompt.text,sessionId:nativeCodexId,gateway:owner,signal:controller.signal,canStart:canContinue,onEvent:(type,value)=>{if(type==='session'){currentChat.codexSessionId=value;if(activeAISessionId===currentChat.id)codexSessionId=value;}else if(type==='usage'){latestUsage=totalUsageTokens('codex',value);latestUsageDetails=usageDetails('codex',value);}else emitChat({text:'ccText',tool:'ccTool',process:'ccProcess',activity:'ccActivity',error:'ccError'}[type],type==='tool'?{name:value}:value);}});
        delete currentChat.contextPrefix;emitChat('ccResult',{sessionId:currentChat.codexSessionId,error:false});return;
      }
      const snapshotOwner=dockerOwner(),snapshotEnvironment=activeContainerId;
      const snapshotSource=snapshotEnvironment?await readFile(path.join(here,'features/runtimes/file-snapshot.mjs'),'utf8'):null;
      const fileHooks=createFileChangeHooks({cwd:workingDirectory,onActivity:activity=>emitChat('ccActivity',activity),snapshot:async file=>{
       if(snapshotOwner!==dockerOwner()||snapshotEnvironment!==activeContainerId)return {available:false,reason:'环境已变化'};
       return snapshotEnvironment?JSON.parse(await dockerEnvs.exec(snapshotOwner,snapshotEnvironment,['node','--input-type=module','-e',snapshotSource+"\nconsole.log(JSON.stringify(await readTextSnapshot(process.argv[1])));",file],{timeout:5000,maxBuffer:300000})):readTextSnapshot(file);
      }});
      const execution = query({ prompt: (async function* () { yield { type: 'user', message: { role: 'user', content: !nativeSessionId?replayPrompt(currentChat.contextPrefix,prompt):prompt }, parent_tool_use_id: null, session_id: '' }; })(), options: {
        cwd: workingDirectory, pathToClaudeCodeExecutable: activeContainerId?'claude':claudePath, model:model || undefined,
        env: chatRuntimeEnvironment(requiresProxy?proxyEnvironment(process.env, owner.url):directChatEnvironment(process.env)), settingSources: ['user','project','local'],
        spawnClaudeCodeProcess: launch || createRestrictedCCSpawner({port:owner.port,canStart:()=>environmentStatus.allowed && gateway === owner && owner.status.state === 'ready' && !controller.signal.aborted}),
        permissionMode: 'default',canUseTool:(toolName,input,options)=>toolApprovals.request({toolName,input,...options,signal:controller.signal,scope:{owner:requestOwner,environmentId},emit:emitChat}), abortController: controller, includePartialMessages: true,hooks:fileHooks,
        resume: nativeSessionId,
      } });
      let streamed = false;const activityEvents=createClaudeActivityAdapter();
      for await (const message of execution) {
        for(const activity of activityEvents(message))emitChat('ccActivity',activity);
        if (message.session_id){currentChat.sessionId=message.session_id;if(activeAISessionId===currentChat.id)sessionId=message.session_id;}
        if(message.parent_tool_use_id)continue;
        if (message.type === 'stream_event' && message.event?.type === 'content_block_delta' && message.event.delta?.type === 'text_delta') { streamed = true; emitChat('ccText', message.event.delta.text); }
        else if (message.type === 'assistant') {
          if (!streamed) for (const content of message.message.content || []) if (content.type === 'text') emitChat('ccText', content.text);
          streamed = false;

        } else if (message.type === 'result') {
          latestUsage=totalUsageTokens('cc',message);latestUsageDetails=usageDetails('cc',message);if(!message.is_error)delete currentChat.contextPrefix;
          if (message.is_error) emitChat('ccError', 'CC 返回错误，请核对官方登录、代理连通性及额度。');
          emitChat('ccResult', { sessionId:currentChat.sessionId, turns: message.num_turns, error: message.is_error });
        }
      }
    } catch (error) {
      emitChat('ccError', {...(!controller.signal.aborted&&error.recovery?{recovery:error.recovery}:{}),status:controller.signal.aborted?'stopped':'failed',message:controller.signal.aborted ? '请求已取消；未自动重放操作。' : (['codex','deepseek'].includes(engine) ? error.message : 'CC 调用失败，请检查本机登录、CLI兼容性及代理；不会转为直连。')});
    } finally {
      if(currentChat.contextPrefix && engine!=='deepseek'){currentChat.sessionId=undefined;currentChat.codexSessionId=undefined;if(activeAISessionId===currentChat.id){sessionId=undefined;codexSessionId=undefined;}}
      if(latestUsage!==null && currentChat && chatOwner===usageOwner && aiSessions.get(currentChat.id)===currentChat){
        const entry={at:new Date().toISOString(),totalTokens:latestUsage,details:latestUsageDetails};
        (currentChat.tokenUsage ||= []).push(entry);
        emitChat('ccUsage',{sessionId:currentChat.id,entry});
      }
      persistAISessions();
      runs.finish(controller);
      emitChat('ccEnd', {status:controller.signal.aborted?'stopped':'completed'});
    }
  })();
  return {chatId,requestId};
  } catch(error){runs.finish(controller);void persistAISessions();throw error;}
}));
// Only read the installed CLI version; never automatically log in or send model requests.
ipcMain.handle('workspace:claudeInfo', guarded(async () => {
  if(activeContainerId){try{return{available:true,version:await dockerEnvs.exec(dockerOwner(),activeContainerId,['claude','--version'])};}catch{return{available:false};}}
  if (!claudePath) return { available: false };
  try { const { stdout } = await exec(claudePath, ['--version'], { timeout: 10000, maxBuffer: 4096 }); return { available: true, version: stdout.trim() }; }
  catch { return { available: true, version: '版本检测失败' }; }
}));
app.whenReady().then(async () => {
 protocol.handle('kuneco-artifact',request=>{const u=new URL(request.url),entry=artifactPages.get(u.pathname.slice(1));if(u.hostname!=='preview'||!entry||entry.owner!==dockerOwner()||entry.environment!==activeContainerId)return new Response('产物所属环境已变化',{status:403});return new Response(entry.html,{headers:{'content-type':'text/html; charset=utf-8','Content-Security-Policy':artifactCSP,'Cache-Control':'no-store'}});});
  try{verifyKeychainMigration({directory:app.getPath('userData'),storage:safeStorage,migration:keychainMigration});}
  catch(error){console.error(error.message);app.exit(1);return;}
  app.setName('Kuneco');
  Menu.setApplicationMenu(Menu.buildFromTemplate([...(process.platform==='darwin'?[{label:'Kuneco',role:'appMenu'}]:[]),{role:'fileMenu'},{role:'editMenu'},{label:'显示',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'}]},{role:'windowMenu'}]));
  app.configureHostResolver({ enableBuiltInResolver: false, secureDnsMode: 'off' });
  await loadConfig();
  desktopReturn=await createDesktopReturn(()=>{if(window && !window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus();app.focus({steal:true});}});
  account=new AccountClient({environment:()=>activeContainerId,returnURL:desktopReturn.url,serverURL:process.env.WORKSPACE_ACCOUNT_SERVER_URL || 'http://localhost:8787',sessionFile:path.join(app.getPath('userData'),'account-session.bin'),storage:safeStorage,directIP:fixtureMode?async()=>'203.0.113.99':undefined,openExternal:url=>fixtureMode?Promise.resolve():shell.openExternal(url)});
  account.on('change',state=>{emit('account',state);if(gateway)gateway.regionRetryAt=0;refreshProxyRegion();});
  connectionRecords=new ConnectionRecords({directory:path.join(app.getPath('userData'),'connection-records'),encrypt:value=>{if(!safeStorage.isEncryptionAvailable())throw new Error('系统加密不可用');return safeStorage.encryptString(value);},decrypt:value=>safeStorage.decryptString(value)});
  dockerEnvs=new DockerEnvironments({defaultLocalEnabled:fixtureMode && !authRequired,directory:path.join(app.getPath('userData'),'docker-environments'),sourceRoot:path.join(here,'..'),encrypt:value=>{if(!safeStorage.isEncryptionAvailable())throw new Error('系统加密不可用');return safeStorage.encryptString(value);},decrypt:value=>safeStorage.decryptString(value)});
  await account.restore();await loadUserRuntimes();
  if(account.user){await loadAccountChats(true);const proxy=activeContainerId?(await dockerEnvs.get(dockerOwner(),activeContainerId)).item.proxy:await account.proxy().catch(()=>null);if(proxy)savedConfig=validateProxy(proxy);else savedConfig={protocol:'http',host:'',port:8080,username:'',password:''};}
  setInterval(()=>{if(!accountChanging && chatDirty && chatReady && account?.user?.id===chatOwner)void persistAISessions().catch(()=>{});},15000).unref();
  containerOperation=!fixtureMode && Boolean(account.user);
  await createWindow();
  await checkEnvironment();
  environmentTimer = setInterval(() => { void checkEnvironment().catch(() => {}); }, 30000);
  learningAutomations=new LearningAutomations({file:path.join(app.getPath('userData'),'learning-automations.json'),context:()=>({owner:account?.user?.id || null,environmentId:activeContainerId}),execute:runLearningAutomation,notify:()=>emit('learningAutomationsChanged',{})});
  await learningAutomations.load();
  if(containerOperation){
   try{
    emit('network',{state:'checking',reason:'正在恢复上次选中的环境及代理'});
    const restored=await restoreSelectedEnvironment({
     owner:dockerOwner(),id:activeContainerId,localEnabled:localEnvironmentEnabled,
     ensureEngine:(owner,id)=>dockerEnvs.ensureSelectedEngine(owner,id),
     activate:(owner,id)=>dockerEnvs.activate(owner,id),
     connectProxy:()=>connectEnvironmentProxy(savedConfig,{
      connect:config=>connect(config,true,{environmentSwitch:true}),
      block:async reason=>{await stopGateway();emit('network',{state:'blocked',reason});}
     })
    });
    if(restored.state==='skipped')emit('network',{state:'blocked',reason:'请先选择环境并配置代理'});
   }catch(error){await stopGateway();emit('network',{state:'blocked',reason:'自动恢复环境失败：'+error.message});}
   finally{containerOperation=false;emit('chatAccountChanged',{});}
  }
  powerMonitor.on('resume', () => { if (gateway) void gateway.checkNow().catch(()=>{}); });
  if (process.env.WORKSPACE_SMOKE_DIR) {
    setTimeout(async () => {
      await mkdir(process.env.WORKSPACE_SMOKE_DIR, { recursive: true });
      const capture = await window.webContents.capturePage();
      await writeFile(path.join(process.env.WORKSPACE_SMOKE_DIR, 'workspace.png'), capture.toPNG());
      app.quit();
    }, 1500);
  }
});
const shutdown=createShutdownBarrier([
 ()=>{learningAutomations?.stop();closeConsole();desktopReturn?.close();containerLogin?.kill();account?.cancel();account?.closeConnections();clearInterval(environmentTimer);clearInterval(healthTimer);gateway?.block('应用退出');stopBrowserTabs();},
 ()=>dockerEnvs?.shutdownTasks(),
 ()=>runs.abortWhere(),
 async()=>{await dockerEnvs?.shutdownTasks();if(gateway){gateway.block('应用退出');await gateway.stop({strict:true});}},
 async()=>{const transport=directBrowserTransport || await directBrowserTransportPromise;await transport?.close();}
]);
let quitAttempt;
app.on('before-quit',event=>{
 if(shutdown.complete)return;
 event.preventDefault();
 if(quitAttempt)return;
 quitAttempt=shutdown.run().then(()=>app.quit(),async()=>{
  const result=await dialog.showMessageBox({type:'error',title:'退出清理尚未完成',message:'任务或网络资源清理失败，应用尚未退出。',detail:'请检查容器服务后重试。账号数据会保留；不会跳过清理强制退出。',buttons:['重试退出','暂不退出'],defaultId:0,cancelId:1});
  return result.response===0;
 }).then(retry=>{quitAttempt=null;if(retry)app.quit();},error=>{quitAttempt=null;console.error('退出清理提示失败',error);});
});
app.on('window-all-closed', () => app.quit());
