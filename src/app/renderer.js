import {mountShortcuts} from '../features/preferences/shortcuts.mjs';
import {mountShortcutSettings} from '../features/preferences/shortcut-settings.mjs';
import {mountPreferenceSettings} from '../features/preferences/preference-settings.mjs';
import {mountQuitDialog} from '../features/preferences/quit-dialog.mjs';
import {applyPreferences,refreshTimeElements} from '../features/preferences/preference-effects.mjs';
import {preferenceDefaults,shouldSend} from '../shared/preferences.mjs';
import {mountConversationRailResize} from '../features/chat/conversation-rail-resize.mjs';
import {mountChatPopoutController} from '../features/chat/chat-popout-controller.mjs';
import {draftScopeKey} from '../features/chat/draft-store.mjs';
import {mountBrowserLibraryUI} from '../features/browser/browser-library-ui.mjs';
import {mountBrowserToolbar} from '../features/browser/browser-toolbar.mjs';
import {renderDocumentCards} from '../features/chat/document-attachments.mjs';
import {mountCompositionGuard} from '../features/chat/composition-guard.mjs';
import {mountChatRecovery} from '../features/chat/chat-recovery.mjs';
import {mountSessionOrder} from '../features/chat/session-order.mjs';
import {mountToolApprovalCards} from '../features/chat/tool-approval-cards.mjs';
import {mountChatSearch} from '../features/chat/chat-search.mjs';
import {mountDraftPersistence} from '../features/chat/draft-persistence.mjs';
import {mountBrowserSettings,mountBrowserModeSwitches} from '../features/browser/browser-settings.mjs';
import {mountInsightsPanel} from '../features/chat/insights-panel.mjs';
import {containerDisplayRows,networkDisplayRows} from '../features/environments/container-display-rows.mjs';
import {mountContextPicker} from '../features/chat/context-picker.mjs';
import {mountChatScroll} from '../features/chat/scroll-follow.mjs';
import {mergeRuntimeActivity} from '../features/runtimes/activity-state.mjs';
import {mountGitSettings} from '../features/git/git-settings.mjs';
import {mountMessageActions,openMessageEditor} from '../features/chat/message-actions.mjs';
import {mountNotificationSettings} from '../features/notifications/notification-settings.mjs';
import {generatedAvatar,runtimeAccountAvatar,setAccountAvatar} from '../vendor/generated-avatar.js';
import {restoredChatStatus} from '../features/chat/chat-status.mjs';
import {renderAppTable} from '../shared/ui/app-table.mjs';
import {mountAssistantImagePreviews} from '../features/chat/assistant-image-preview.mjs';
import {chatViewSnapshot} from '../features/chat/chat-view-state.mjs';
import {reasoningView,finishReasoning,clearReasoningTimers} from '../features/chat/reasoning-view.mjs';
import {mountDeepSeekComposer} from '../features/runtimes/deepseek-composer.mjs';
import {mountLearningAutomation} from '../features/automation/learning-ui.mjs';
import {updateChatMessage} from '../vendor/chat-markdown.js';
import {mergeChatPayload} from '../features/chat/chat-sync.mjs';
import {ENVIRONMENT_ICONS,environmentIcon} from '../features/environments/environment-icons.mjs';
import {RUNTIME_INSTALL_COMMANDS,RUNTIME_CATALOG,runtimeIcon,supportsChat} from '../features/runtimes/runtime-install-config.mjs';
import {mountConsole} from '../vendor/console.js';
import {mountGalaxy} from '../shared/ui/galaxy-background.mjs';
import {formatDisplayDate} from '../shared/date-format.mjs';
import {restoredChat} from '../features/chat/chat-selection.mjs';
import {formatProxyLocation} from '../features/proxy/geo-location.mjs';
import {profileActivity,activityTooltip} from '../features/account/profile-activity.mjs';
import {setUITheme,createUI,createIcon} from '../vendor/ui.js';
import {openContentTab,closeContentTab,CONTENT_TAB_LIMIT} from '../shared/ui/content-tabs.mjs';
import { resolveBrowserAddress } from '../features/browser/browser-address.mjs';

let chatRenderContainer=null;
const $ = id => id==='chat' && chatRenderContainer?chatRenderContainer:document.getElementById(id);
const api = window.workspace;
let preferences={...preferenceDefaults};
mountQuitDialog({document,api});
document.addEventListener('quit-blocked',()=>toast('请先关闭当前弹窗，再退出应用。'));
const savePreferences=async patch=>{const value=await api.preferences(patch);updatePreferences(value);return value;};
const preferenceSettings=mountPreferenceSettings({host:document.querySelector('[data-panel=preferences]'),getPreferences:()=>preferences,save:savePreferences});
const shortcutSettings=mountShortcutSettings({host:$('shortcutSettings'),platform:api.platform,getPreferences:()=>preferences,save:savePreferences});shortcutSettings.render(false);
function updatePreferences(value){preferences=applyPreferences(value);preferenceSettings.render();shortcutSettings.render();refreshDisplayedTimes();}
api.onEvent(({type,data})=>{if(type==='preferences')updatePreferences(data);});
void api.preferences().then(updatePreferences).catch(error=>preferenceSettings.error(error.message));
mountConversationRailResize({rail:document.querySelector('.conversation-rail')});
const browserSettingsUI=mountBrowserSettings({document,api,getScope:()=>({owner:accountState.user?.id,environmentId:dockerEnvironmentState.activeId,label:$('environmentName').textContent || '当前环境'}),formatDate:value=>displayDate(value),onOpenSite:domain=>openBrowserCookies(domain)});
const chatScroll=mountChatScroll(document.getElementById('chat'),document.getElementById('chatJumpLatest'));
const gitSettings=mountGitSettings({host:$('gitSettings'),api,getScope:()=>[accountState.user?.id,dockerEnvironmentState.activeId,chatSessions.find(item=>item.id===activeChatId)?.project || '']});
const notificationSettings=mountNotificationSettings({host:$('notificationSettings'),api});
notificationSettings.setOwner(null);
const consoleView=mountConsole(api,{openBrowser:url=>void action(async()=>{await api.browser('navigate',url);switchPage('browser');})});
mountGalaxy($('setupGalaxyCanvas'));
const setupDragStrip=document.querySelector('.setup-window-drag');
let setupDragPointer=null;
const moveSetupWindow=(phase,event)=>void api.windowDrag({phase,x:event?.screenX,y:event?.screenY}).catch(()=>{});
setupDragStrip.addEventListener('pointerdown',event=>{
 if(event.button!==0)return;
 event.preventDefault();setupDragPointer=event.pointerId;
 setupDragStrip.setPointerCapture(event.pointerId);moveSetupWindow('start',event);
});
setupDragStrip.addEventListener('pointermove',event=>{
 if(setupDragPointer===event.pointerId)moveSetupWindow('move',event);
});
setupDragStrip.addEventListener('pointerup',event=>{
 if(setupDragPointer!==event.pointerId)return;
 moveSetupWindow('end',event);setupDragPointer=null;
 if(setupDragStrip.hasPointerCapture(event.pointerId))setupDragStrip.releasePointerCapture(event.pointerId);
});
const cancelSetupDrag=()=>{if(setupDragPointer!==null){setupDragPointer=null;moveSetupWindow('cancel');}};
setupDragStrip.addEventListener('pointercancel',cancelSetupDrag);
setupDragStrip.addEventListener('lostpointercapture',cancelSetupDrag);
window.addEventListener('blur',cancelSetupDrag);
setupDragStrip.addEventListener('dblclick',event=>{event.preventDefault();cancelSetupDrag();void api.windowDrag({phase:'toggleMaximize'}).catch(()=>{});});

const uiLocale=()=>$('languageSelect').value || 'zh-CN';
const displayDate=(value,kind='datetime')=>formatDisplayDate(value,uiLocale(),kind);
function displayEnvironmentDate(value,recent=false){return displayDate(value);}
let displayedEnvironmentStatus=null;
let environmentAllowed = false, environmentDetailsOpen = false, environmentChecking = false;
$('environmentGate').open=false;
$('environmentGate').addEventListener('wa-hide',event=>{
  if(!document.body.matches('.auth-mode,.auth-pending') && (!environmentAllowed || environmentChecking)) event.preventDefault();
  else {environmentDetailsOpen=false;queueMicrotask(bounds);}
});
$('environmentGate').addEventListener('wa-after-hide',bounds);
function closeEnvironmentDetails() {
  if(!environmentAllowed || environmentChecking) return;
  environmentDetailsOpen=false; $('environmentGate').open=false; bounds();
}
$('environmentClose').onclick=closeEnvironmentDetails;
function setEnvironment(status) {
  displayedEnvironmentStatus=status;
  environmentAllowed = Boolean(status.allowed);
  
  
  $('environmentSummary').textContent = status.allowed ? '检测通过，可以连接代理。' : '检测未通过，浏览器与本机 AI 访问已禁止。';
  $('environmentZone').textContent = status.timeZone || '未知';
  $('environmentLanguages').textContent = status.languages?.join(', ') || '未知';
  $('environmentCountries').textContent = status.countries?.map(code=>new Intl.DisplayNames(['zh-CN'],{type:'region'}).of(code)+' ('+code+')').join(', ') || '未知';
  $('environmentCheckedAt').textContent = status.checkedAt ? displayDate(status.checkedAt) : '尚未完成';
  $('environmentClose').disabled = !status.allowed || environmentChecking;
  $('environmentPolicyDate').textContent = status.policyDate ? displayDate(status.policyDate,'date') : '未知';
  $('environmentReasons').textContent = status.reasons?.join('；') || '';
  document.querySelectorAll('[data-environment]').forEach(field => {
    field.textContent = $(field.dataset.environment).textContent;
  });
  updateProxyActions();
  if(document.body.matches('.auth-mode,.auth-pending') || (status.allowed && !environmentDetailsOpen && !environmentChecking)) $('environmentGate').open=false;
  else if(!$('environmentGate').open) $('environmentGate').open=true;
  bounds();
}
async function recheckEnvironment({showDetails=false} = {}) {
  if(environmentChecking) return;
  environmentChecking=true;
  
  if(showDetails) { environmentDetailsOpen=true; if(!$('environmentGate').open) $('environmentGate').open=true; }
  $('environmentRetry').disabled=true;$('environmentRetryLabel').textContent='正在检测…';
  $('environmentClose').disabled=true;
  $('environmentSummary').textContent='正在重新读取系统语言与时区…';
  bounds();
  let result;
  try { result=await api.environmentCheck(); }
  catch(error) { result={allowed:false,reasons:['读取失败：'+error.message]}; }
  finally {
    environmentChecking=false;
    $('environmentRetry').disabled=false; $('environmentRetryLabel').textContent='重新检测';
    
  }
  setEnvironment(result);
}
$('environmentRetry').onclick = () => void recheckEnvironment({showDetails:true});

$('browserTabs').addEventListener('wa-tab-show',event=>{if(event.detail.name && event.detail.name!==browserTabsState.activeId)void action(()=>api.browser('select',event.detail.name));});
let suggestionsOpen = false, suggestionIndex = 0, suggestionItems = [], addressEditing = false;
let addressHistory = [];
// Browser history is loaded from the account/environment-scoped main-process library.
const protocolLabel = value => ({ http: 'HTTP / HTTPS', https: 'HTTPS（TLS 入口）', socks5: 'SOCKS5' })[value] || value;
let accountState={user:null,status:'signed-out'},proxySaveTimer,proxySaveVersion=0,loginScreenEnabled=false,credentialBusy=false,credentialMode='choice';
let dockerEnvironmentState={activeId:null,localEnabled:true,environments:[],engine:{}};
let setupInProgress=false;
let runtimeRegistry={runtimes:[]};
let selectedEngine='cc', runtimeVersions={}, engineChats={}, selectedCodexModel=null, authStates={}, authRequestId=0, chatSessions=[], activeChatId, defaultEngine="cc", defaultModel=null;
let pinnedContentPages=new Set();try{pinnedContentPages=new Set(JSON.parse(localStorage.getItem('pinned-content-pages') || '[]').filter(id=>['cc','browser','overview','automation'].includes(id)));}catch{}
let chatRestoring=true,chatRestoreVersion=0;
let contentTabState={tabs:[],activeId:null},navigationHistory=[],navigationIndex=-1,historyRestoring=false,chatOwnerID=null,chatEnvironmentID=null,chatReloading=false,chatReloadPending=false;
let sidebarCollapsed=false;try{sidebarCollapsed=localStorage.getItem('sidebar-collapsed')==='true';}catch{}document.body.classList.toggle('sidebar-collapsed',sidebarCollapsed);
let currentProxyConfig=null,editingProxy=false,importPrepared=false;
let proxyFileSelection=null,proxyFileVersion=0;
const chatRuns=new Map();
let page = 'cc', network = { state: 'blocked' }, hasPassword = false, busy = false, browserTabsState = { tabs: [], activeId: null }, reply, approvals = [];
const browserModeSwitches=mountBrowserModeSwitches({document,getMode:()=>browserTabsState.mode || 'proxy',save:mode=>api.browserSettings(mode),onSaved:renderBrowserTabs});
let browserNetworkChanging=false;
for(const item of document.querySelectorAll('[data-browser-network]'))item.addEventListener('click',()=>void action(async()=>{
 $('browserNetworkMenu').open=false;if(browserNetworkChanging)return;
 browserNetworkChanging=true;const trigger=$('browserNetworkMenu').querySelector('app-button');trigger.loading=true;trigger.disabled=true;
 try{if(item.dataset.browserNetwork!==browserTabsState.mode)renderBrowserTabs(await api.browserSettings(item.dataset.browserNetwork));}
 finally{browserNetworkChanging=false;trigger.loading=false;trigger.disabled=false;renderBrowserTabs(browserTabsState);}
}));

let browserPreferences={showFullUrl:true};
const browserLibraryHost=document.createElement('div');browserLibraryHost.id='browserLibrarySettings';browserLibraryHost.className='browser-library-settings';$('browserSettingsPanel').append(browserLibraryHost);
const browserLibrary=mountBrowserLibraryUI({document,api,chooseDownloadDirectory:directory=>openFilePicker('directory','container-download',directory),host:browserLibraryHost,onOpenURL:async url=>{await api.browser('navigate',url);switchPage('browser');},onChanged:data=>{browserPreferences=data.settings;addressHistory=data.history||[];}});
const browserToolbar=mountBrowserToolbar({document,api,library:browserLibrary,getState:()=>browserTabsState,isBrowser:()=>page==='browser',onBounds:bounds,onError:error=>toast(error.message||String(error)),onAnnotation:async value=>{const message='网页批注：'+value.title+'\n'+value.url+'\n'+(value.selection?'选中内容：'+value.selection+'\n':'')+value.note;if(value.image&&!['deepseek','codex'].includes(selectedEngine))throw Error('当前对话不支持图片附件，请选择支持图片的运行时或取消附带截图');const draft=deepseekComposer.payload($('prompt').value);$('prompt').value=[$('prompt').value,message].filter(Boolean).join('\n\n');if(value.image)deepseekComposer.restore({...draft,images:[...draft.images,{dataURL:value.image,name:'网页批注.png',detail:'auto'}]});switchPage('cc');$('prompt').focus();}});
function browserAddress(url){return url;}

let lastToastText='',lastToastAt=0;
function toast(message,category='operations') {const text=String(message).replace(/^Error invoking remote method '[^']+': Error: /, '');if(text===lastToastText && Date.now()-lastToastAt<5000)return;lastToastText=text;lastToastAt=Date.now();notificationSettings.deliver(text,category,message=>$('toast').create(message,{duration:5000,size:'s'}));}
async function action(fn) { try { return await fn(); } catch (error) { toast(error.message,'errors'); } }
let connectionRecordEntries=[];
function activity(message){if(accountState.user)return;renderConnectionRecords([{time:new Date().toISOString(),message},...connectionRecordEntries].slice(0,12));}
let connectionRecordsVersion=0;
function renderConnectionRecords(entries,empty='等待你的第一次连接。'){
 connectionRecordEntries=entries;
 renderAppTable($('activity'),{label:'连接记录',columns:[{key:'time',label:'时间',width:'190px',render:item=>{const time=document.createElement('time');time.dateTime=item.time;time.textContent=displayDate(item.time,'datetime');return time;}},{key:'message',label:'连接详情'}],rows:entries,minWidth:560,empty});
}
async function loadConnectionRecords(){
 const owner=accountState.user?.id,environmentId=dockerEnvironmentState.activeId,version=++connectionRecordsVersion;renderConnectionRecords([]);if(!owner)return;
 try{const entries=await api.connectionRecords();if(version===connectionRecordsVersion && owner===accountState.user?.id && environmentId===dockerEnvironmentState.activeId)renderConnectionRecords(entries);}catch{if(version===connectionRecordsVersion){renderConnectionRecords([],'连接记录读取失败，请重新打开此页面。');}}
}
function renderProxyStorageScope(){
 const label=!accountState.user?'仅本设备':dockerEnvironmentState.activeId?'账号 · 当前环境':'账号 · 所有设备同步';
 $('proxyStorageScope').replaceChildren(createIcon(accountState.user?'cloud':'monitor'),document.createTextNode(label));
}
let browserBoundsRevision=0,browserPreviewRequest=null,browserPreviewTab=null;
async function bounds() {
  const revision=++browserBoundsRevision;
  const rect = $('browserViewport').getBoundingClientRect();
  const menu = $('addressSuggestions').getBoundingClientRect();
  const top = suggestionsOpen ? Math.max(rect.y, menu.bottom) : rect.y;
  const dialogOpen=Boolean(document.querySelector('app-dialog[open]'));
  const menuOpen= [...document.querySelectorAll('wa-dropdown[open]')].some(dropdown=>{
    const panel=dropdown.shadowRoot?.querySelector('[part~="menu"]');
    if(!panel)return true;
    const box=panel.getBoundingClientRect();
    return box.width>0 && box.height>0 && box.left<rect.right && box.right>rect.left && box.top<rect.bottom && box.bottom>top;
  });
  const preview=$('browserMenuPreview');
  if(menuOpen&&!dialogOpen&&page==='browser'&&environmentAllowed){
    if(browserPreviewTab!==browserTabsState.activeId||preview.hidden){
      browserPreviewRequest ||= api.browser('menuPreview').catch(()=>null).finally(()=>{browserPreviewRequest=null;});
      const frame=await browserPreviewRequest;if(revision!==browserBoundsRevision)return;
      if(frame?.tabId===browserTabsState.activeId){preview.src=frame.image;await preview.decode().catch(()=>{});if(revision!==browserBoundsRevision)return;preview.hidden=false;browserPreviewTab=frame.tabId;}
    }
  }else{preview.hidden=true;preview.removeAttribute('src');browserPreviewTab=null;}
  const overlayBlocksBrowser=dialogOpen||menuOpen;
  void api.bounds({ x: rect.x, y: top, width: rect.width, height: Math.max(1, rect.bottom - top), visible: environmentAllowed && !overlayBlocksBrowser && page === 'browser' && (browserTabsState.mode!=='proxy' || network.state === 'ready') }).catch(() => {});
}
let browserCookieRows=[],browserCookieRequest=0;
function clearBrowserCookies(){browserSettingsUI.invalidate();cookiePreferenceRequest++;browserCookieRequest++;browserCookieRows=[];$('browserCookieList').replaceChildren();$('browserCookiesDialog').open=false;}
function renderBrowserCookies(){
 const query=$('browserCookieFilter').value.trim().toLowerCase();
 const rows=browserCookieRows.filter(cookie=>(!browserCookieSiteDomain || cookie.domain.replace(/^\./,'').toLowerCase()===browserCookieSiteDomain) && (cookie.domain+' '+cookie.name).toLowerCase().includes(query));
 $('browserCookieList').replaceChildren();
 for(const cookie of rows){
  const entry=document.createElement('details'),heading=document.createElement('summary');
  const name=document.createElement('strong');name.textContent=cookie.name;
  const domain=document.createElement('span');domain.textContent=cookie.domain;heading.append(name,domain);entry.append(heading);
  const facts=document.createElement('dl');
  for(const [label,value] of [['值',cookie.value],['域名',cookie.domain],['路径',cookie.path],['过期时间',cookie.session?'会话 Cookie':displayDate(new Date(cookie.expirationDate*1000).toISOString())],['Secure',cookie.secure?'是':'否'],['HttpOnly',cookie.httpOnly?'是':'否'],['SameSite',cookie.sameSite || '未指定']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;facts.append(dt,dd);}
  entry.append(facts);$('browserCookieList').append(entry);
 }
 $('browserCookieStatus').textContent=rows.length?'共 '+rows.length+' 个 Cookie':query?'没有匹配的 Cookie':browserCookieSiteDomain?'该站点暂无 Cookie':'当前账号与环境暂无 Cookie';
}
let browserCookieSiteDomain=null;
function openBrowserCookies(domain=null){
 browserCookieSiteDomain=domain?.toLowerCase() || null;$('browserCookieFilter').value='';$('browserCookiesDialog').label=domain?'Cookie · '+domain:'Cookie';$('browserCookieTitle').textContent=$('browserCookiesDialog').label;$('closeBrowserCookiesLabel').textContent=domain?'返回数据':'关闭';$('closeBrowserCookies').querySelector('wa-icon').src=domain?'assets/icons/arrow-left.svg':'assets/icons/x.svg';$('browserCookiesDialog').open=true;bounds();void loadBrowserCookies();
}
async function loadBrowserCookies(){
 const request=++browserCookieRequest,owner=accountState.user?.id,environmentId=dockerEnvironmentState.activeId;
 browserCookieRows=[];$('browserCookieList').replaceChildren();$('browserCookieStatus').textContent='正在读取…';
 $('browserCookieScope').textContent=($('environmentName').textContent || '当前环境')+' · 数据按账号和环境隔离';
 try{const data=await api.browserCookies();if(request!==browserCookieRequest || !$('browserCookiesDialog').open)return;
 if(owner!==accountState.user?.id || environmentId!==dockerEnvironmentState.activeId || data.owner!==owner || (data.environmentId || null)!==(environmentId || null))throw new Error('账号或环境已切换，请重新打开设置');
 browserCookieRows=data.cookies;renderBrowserCookies();if(data.syncError)$('browserCookieStatus').textContent=data.syncError;
 }catch(error){if(request===browserCookieRequest)$('browserCookieStatus').textContent=error.message;}
}
$('browserCookieSettings').onclick=()=>{$('browserMoreMenu').open=false;openBrowserCookies();};
let cookiePreferenceRequest=0;
function renderCookieDescription(){
 const cloud=$('browserCookieMode').value==='account';
 $('browserCookieScopeIcon').src='assets/icons/'+(cloud?'cloud':'monitor')+'.svg';
 $('browserCookieScopeLabel').textContent=cloud?'跟随环境':'仅本设备';
 $('browserCookieModeIcon').src='assets/icons/'+($('browserCookieMode').value==='account'?'cloud':'monitor')+'.svg';
 $('browserCookieDescription').textContent=$('browserCookieMode').value==='account'?'Cookie 加密保存到当前账号的当前环境，同步该环境的 Cookie；部分网站仍可能要求重新登录。':'Cookie 仅保存在本设备，不上传云端。切回本设备后，已有云端副本保留。';
}
async function loadBrowserCookiePreferences(settings){
 const request=++cookiePreferenceRequest,owner=accountState.user?.id,environmentId=dockerEnvironmentState.activeId;
 $('browserCookieMode').disabled=true;$('browserCookieSettingsStatus').textContent='';
 try{const data=settings?await api.browserCookies({...settings,owner,environmentId:environmentId || null}):await api.browserData('status');
 if(request!==cookiePreferenceRequest || owner!==accountState.user?.id || environmentId!==dockerEnvironmentState.activeId)return;
 $('browserCookieMode').value=data.settings.mode;
 renderCookieDescription();browserSettingsUI.renderSync(data);
 }catch(error){if(request===cookiePreferenceRequest)$('browserCookieSettingsStatus').textContent=error.message;}
 finally{if(request===cookiePreferenceRequest){$('browserCookieMode').disabled=false;}}
}
function saveBrowserCookiePreferences(){renderCookieDescription();void loadBrowserCookiePreferences({mode:$('browserCookieMode').value});}
$('browserCookieMode').addEventListener('change',saveBrowserCookiePreferences);

$('refreshBrowserCookies').onclick=()=>void loadBrowserCookies();
$('browserCookieFilter').addEventListener('input',renderBrowserCookies);
$('closeBrowserCookies').onclick=()=>{$('browserCookiesDialog').open=false;};
$('browserCookiesDialog').addEventListener('wa-after-hide',event=>{if(event.target!==$('browserCookiesDialog'))return;browserCookieRequest++;browserCookieRows=[];$('browserCookieList').replaceChildren();});
function openAccountSettings(panel){$('accountMenu').open=false;switchPage('overview');document.querySelector('[data-setting='+panel+']').click();}
$('accountProfileLink').onclick=()=>void action(()=>openAccountSettings('profile'));
$('accountSettings').onclick=()=>void action(()=>openAccountSettings('preferences'));
// Native browser views render above the HTML surface; hide them while overlays
// are open and restore the existing tab after the final overlay closes.
for(const type of ['wa-show','wa-after-show','wa-reposition','wa-after-hide'])document.addEventListener(type,event=>{if(event.target.matches?.('app-dialog,wa-dropdown'))bounds();});

function contentTabFor(next) {
 if(next==='insights')return contentTabState.tabs.find(tab=>tab.id===contentTabState.activeId && tab.page==='insights') || contentTabState.tabs.find(tab=>tab.page==='insights');
 if(next==='cc'){const current=contentTabState.tabs.find(tab=>tab.id===contentTabState.activeId && tab.page==='cc') || contentTabState.tabs.find(tab=>tab.page==='cc');if(current)return current;}
 return {id:next,page:next,pinned:pinnedContentPages.has(next),title:next==='environments'?'环境':next==='cc'?'对话':next==='overview'?'设置':next==='automation'?'自动化':next==='runtime'?'运行时':next==='console'?'控制台':'浏览器'};
}
function assertContentTabAvailable(tab){openContentTab(contentTabState,tab);}
let contextContentTabId=null;
function tabMenuCopy(){return uiLocale()==='en-US'?{pin:'Pin tab',unpin:'Unpin tab',close:'Close tab',others:'Close other tabs'}:{pin:'固定标签',unpin:'取消固定',close:'关闭标签',others:'关闭其他标签'};}
function toggleContentTabPin(id){
 const tab=contentTabState.tabs.find(item=>item.id===id);if(!tab)return;
 if(tab.pinned)pinnedContentPages.delete(id);else pinnedContentPages.add(id);
 try{localStorage.setItem('pinned-content-pages',JSON.stringify([...pinnedContentPages]));}catch{}
 contentTabState.tabs=contentTabState.tabs.map(item=>item.id===id?{...item,pinned:!item.pinned}:item).sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned)));renderContentTabs();
}
function openContentTabMenu(event,tab){
 event.preventDefault();contextContentTabId=tab.id;const copy=tabMenuCopy(),menu=$('contentTabMenu');
 $('contentTabMenuPin').querySelector('span').textContent=tab.pinned?copy.unpin:copy.pin;
 $('contentTabMenuPin').querySelector('wa-icon').src='assets/icons/'+(tab.pinned?'pin-off':'pin')+'.svg';
 $('contentTabMenuClose').querySelector('span').textContent=copy.close;$('contentTabMenuClose').disabled=contentTabState.tabs.length<=1;
 $('contentTabMenuCloseOthers').querySelector('span').textContent=copy.others;
 $('contentTabMenuCloseOthers').disabled=!contentTabState.tabs.some(item=>item.id!==tab.id && !item.pinned);
 const rect=document.querySelector('[data-tab-id="'+CSS.escape(tab.id)+'"]').getBoundingClientRect();
 const anchor=$('contentTabMenuAnchor');anchor.style.left=Math.min(Math.max(event.clientX || rect.left,0),window.innerWidth-240)+'px';anchor.style.top=Math.min(Math.max(event.clientY || rect.bottom,0),window.innerHeight-160)+'px';
 menu.open=true;bounds();
}
// Capture outside presses even when another control stops event bubbling.
function dismissContentTabMenu(event){
 const menu=$('contentTabMenu');
 if(menu.open && !event.composedPath().includes(menu)){menu.open=false;bounds();}
}
document.addEventListener('pointerdown',dismissContentTabMenu,true);
document.addEventListener('click',dismissContentTabMenu,true);
$('contentTabMenu').addEventListener('wa-hide',()=>bounds());
$('contentTabMenuPin').onclick=()=>{const id=contextContentTabId;$('contentTabMenu').open=false;toggleContentTabPin(id);};
$('contentTabMenuClose').onclick=()=>void action(async()=>{const id=contextContentTabId;$('contentTabMenu').open=false;await closeContentTabView(id);});
$('contentTabMenuCloseOthers').onclick=()=>void action(async()=>{
 const id=contextContentTabId,tab=contentTabState.tabs.find(item=>item.id===id);$('contentTabMenu').open=false;if(!tab)return;
 const others=contentTabState.tabs.filter(item=>item.id!==id && !item.pinned);
 if(others.some(item=>item.page==='cc' && chatRuns.has(item.sessionId)))throw new Error('请先停止当前请求，再关闭其他标签。');
 await activateContentTab(tab);for(const item of others)await closeContentTabView(item.id);
});
$('contentTabs').addEventListener('scroll',()=>{$('contentTabMenu').open=false;},{passive:true});
$('contentTabs').addEventListener('wheel',event=>{const strip=$('contentTabs');if(strip.scrollWidth>strip.clientWidth && Math.abs(event.deltaY)>Math.abs(event.deltaX)){event.preventDefault();strip.scrollLeft+=event.deltaY;}},{passive:false});
window.addEventListener('resize',()=>{$('contentTabMenu').open=false;});
function renderContentTabs(){
 const scroll=$('contentTabs').scrollLeft;const copy=tabMenuCopy();$('contentTabs').replaceChildren();
 for(const tab of contentTabState.tabs){
  const item=document.createElement('div');item.className='content-tab'+(tab.id===contentTabState.activeId?' active':'');item.dataset.tabId=tab.id;item.oncontextmenu=event=>openContentTabMenu(event,tab);item.addEventListener('keydown',event=>{if(event.key==='ContextMenu' || event.shiftKey && event.key==='F10')openContentTabMenu(event,tab);});
  const divider=document.createElement('span');divider.className='content-tab-divider';divider.setAttribute('aria-hidden','true');item.append(divider);
  const select=createUI('app-button');select.className='content-tab-select';select.setAttribute('role','tab');select.setAttribute('aria-selected',String(tab.id===contentTabState.activeId));select.setAttribute('aria-controls',`page-${tab.page}`);select.title=tab.title;
  const label=document.createElement('span');label.className='content-tab-title';label.textContent=tab.title;select.append(createIcon(tab.page==='insights'?(tab.insightView==='changes'?'file-text':'folder'):tab.page==='cc'?'messages-square':tab.page==='overview'?'settings':tab.page==='automation'?'zap':tab.page==='console'?'terminal':tab.page==='runtime'?'monitor':tab.page==='environments'?'boxes':'globe'),label);
  select.onclick=()=>void action(()=>activateContentTab(tab));
  select.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const index=contentTabState.tabs.findIndex(item=>item.id===tab.id);const next=event.key==='Home'?0:event.key==='End'?contentTabState.tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+contentTabState.tabs.length)%contentTabState.tabs.length;void action(()=>activateContentTab(contentTabState.tabs[next]));};
  const close=createUI('app-button');close.className='content-tab-close';close.setAttribute('icon-action-exempt','');close.append(createIcon('x'));close.setAttribute('aria-label',`${copy.close} ${tab.title}`);close.onclick=()=>void action(()=>closeContentTabView(tab.id));const pin=createUI('app-button');pin.className='content-tab-pin';pin.setAttribute('icon-action-exempt','');pin.append(createIcon(tab.pinned?'pin-off':'pin'));pin.setAttribute('aria-label',tab.pinned?copy.unpin:copy.pin);pin.setAttribute('aria-pressed',String(Boolean(tab.pinned)));pin.onclick=()=>toggleContentTabPin(tab.id);if(tab.pinned)item.classList.add('pinned');item.append(select,pin);if(!tab.pinned && contentTabState.tabs.length>1)item.append(close);$('contentTabs').append(item);
 }
 const add=createUI('app-button');add.id='newContentTab';add.className='icon-button content-tab-add';add.setAttribute('aria-label','新建对话标签');add.append(createIcon('plus'));add.onclick=()=>void action(newChatTab);$('contentTabs').append(add);const drag=document.createElement('div');drag.className='window-tab-drag';drag.setAttribute('aria-hidden','true');$('contentTabs').append(drag);
 $('contentTabs').scrollLeft=scroll;
 requestAnimationFrame(()=>{const active=$('contentTabs').querySelector('.content-tab.active');if(!active)return;const viewport=$('contentTabs').getBoundingClientRect(),rect=active.getBoundingClientRect();if(rect.left<viewport.left)$('contentTabs').scrollLeft-=viewport.left-rect.left;else if(rect.right>viewport.right)$('contentTabs').scrollLeft+=rect.right-viewport.right;});
 $('contentTabs').title=`${contentTabState.tabs.length} / ${CONTENT_TAB_LIMIT} 个标签`;
}
function showEmptyChatTab(){activeChatId=null;reply=null;busy=false;$('chat').replaceChildren();$('prompt').value='';renderChatAvailability();renderSessionList();renderSessionHeader();}
function newChatTab(){
 chatRestoreVersion++;
 const tab={id:`chat-tab:${crypto.randomUUID()}`,page:'cc',title:'对话',pinned:false,sessionId:null};
 assertContentTabAvailable(tab);saveChatView();contentTabState=openContentTab(contentTabState,tab);showEmptyChatTab();switchPage('cc');
}
async function activateContentTab(tab,saveCurrent=true){
 const version=++chatRestoreVersion;
 if(tab.page==='insights'){if(tab.insightScope!==insightPanel.scopeKey())throw new Error('请返回原对话后重新打开完整视图');contentTabState.activeId=tab.id;}
 if(tab.page==='cc'){
  if(saveCurrent)saveChatView();const item=chatSessions.find(item=>item.id===tab.sessionId);const value=item?await api.selectSession(item.id,{deferAuth:true,viewed:true}):null;if(version!==chatRestoreVersion)return;
  contentTabState.activeId=tab.id;
  if(item){applySession(value,item);return;}showEmptyChatTab();$('prompt').value=tab.draft || '';
 }
 switchPage(tab.page);
}
async function closeContentTabView(id){
 if(contentTabState.tabs.length<=1)return;
 const tab=contentTabState.tabs.find(item=>item.id===id);if(tab?.page==='console')consoleView.reset();if(tab?.page==='cc' && chatRuns.has(tab.sessionId))throw new Error('请先停止当前请求，再关闭会话标签。');
 if(id===contentTabState.activeId)saveChatView();
 const previous=contentTabState.activeId;const next=closeContentTab(contentTabState,id);
 // Validate switching before removing a tab while another chat is running.
 const replacement=next.tabs.find(item=>item.id===next.activeId);

 contentTabState=next;renderContentTabs();
 if(previous===id){if(replacement)await activateContentTab(replacement,false);else{page=null;document.body.classList.remove('chat-mode','browser-mode','settings-mode');document.querySelectorAll('.page').forEach(el=>el.classList.add('hidden'));document.querySelectorAll('.nav').forEach(el=>el.classList.remove('active'));bounds();}}
}
function switchPage(next,{connectConsole=true}={}) {
 if(next==='insights'&&!contentTabState.tabs.some(tab=>tab.page==='insights'))next='cc';
 contentTabState=openContentTab(contentTabState,contentTabFor(next));contentTabState.tabs.sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned)));renderContentTabs();
 page = next;
  insightPanel.setFullView(next==='insights'?contentTabState.tabs.find(tab=>tab.id===contentTabState.activeId)?.insightView:null);
  closeSuggestions();
  document.body.classList.toggle('chat-mode',next==='cc'||next==='insights');
  document.body.classList.toggle('settings-mode',next==='overview');
  document.body.classList.toggle('browser-mode', next === 'browser');
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('hidden', el.id !== `page-${next}`));
  document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.page === (next === 'insights' ? 'cc' : next)));
  if(next==='cc' && activeChatId){
   // Restore history only after the chat pane is visible and has a layout.
   chatScroll.restore(activeChatId);
   void checkAIAuth();
  }
  if(next==='environments')void action(ensureEnvironmentPage);
  if(next==='console' && connectConsole)void consoleView.show();
  if(next==='runtime')void action(()=>refreshEnvironmentConfiguration(false,null,{navigation:true}));
  if(next==='browser')void action(()=>api.browser('open'));
  if(!historyRestoring){const target={page:next,sessionId:next==='cc'?activeChatId:null};const current=navigationHistory[navigationIndex];if(!current || current.page!==target.page || current.sessionId!==target.sessionId){navigationHistory=navigationHistory.slice(0,navigationIndex+1);navigationHistory.push(target);navigationIndex=navigationHistory.length-1;}}
  $('appBack').disabled=navigationIndex<=0;$('appForward').disabled=navigationIndex>=navigationHistory.length-1;
  bounds();
}
function layoutAccountMenu(){
 const sidebar=document.querySelector('.sidebar').getBoundingClientRect(),trigger=$('accountTrigger').getBoundingClientRect(),menu=$('accountMenu');
 if(sidebarCollapsed){
  const secondary=document.querySelector(document.body.classList.contains('settings-mode')?'.settings-nav':'.conversation-rail');
  const width=secondary?.getBoundingClientRect().width || 224;
  menu.style.setProperty('--account-menu-width',Math.max(180,width-24)+'px');menu.placement='right-end';menu.distance=Math.max(8,sidebar.right-trigger.right+12);
 }else{const edge=document.querySelector('.content-layout').getBoundingClientRect().left,inset=trigger.left-sidebar.left;const width=Math.min(sidebar.width,edge-sidebar.left-inset*2);menu.style.setProperty('--account-menu-width',Math.max(1,width)+'px');menu.placement='top-start';menu.distance=8;}
}
$('accountMenu').addEventListener('wa-show',layoutAccountMenu);
new ResizeObserver(layoutAccountMenu).observe(document.querySelector('.sidebar'));
let proxyActionBusy=false;
new ResizeObserver(()=>{const width=$('environmentTrigger').getBoundingClientRect().width;$('environmentMenu').style.setProperty('--environment-menu-width',(width>56?width:220)+'px');}).observe($('environmentTrigger'));
$('newEnvironment').onclick=()=>beginEnvironmentSetup('docker',true);
let pendingEnvironmentDeletion=null,environmentDeleting=false;
$('deleteEnvironmentName').addEventListener('input',()=>{$('confirmDeleteEnvironment').disabled=environmentDeleting || $('deleteEnvironmentName').value!==pendingEnvironmentDeletion?.name;});
$('cancelDeleteEnvironment').onclick=()=>{if(!environmentDeleting)$('deleteEnvironmentDialog').open=false;};
$('deleteEnvironmentDialog').addEventListener('wa-hide',event=>{if(environmentDeleting)event.preventDefault();});
$('deleteEnvironmentDialog').addEventListener('wa-after-hide',()=>{pendingEnvironmentDeletion=null;$('deleteEnvironmentName').value='';});
$('confirmDeleteEnvironment').onclick=()=>void (async()=>{
 const item=pendingEnvironmentDeletion;if(!item || environmentDeleting || $('deleteEnvironmentName').value!==item.name)return;
 environmentDeleting=true;$('confirmDeleteEnvironment').disabled=true;$('cancelDeleteEnvironment').disabled=true;$('deleteEnvironmentName').disabled=true;$('deleteEnvironmentError').textContent='';
 try{await environmentOperation('delete',{id:item.id,name:$('deleteEnvironmentName').value});environmentDeleting=false;$('deleteEnvironmentDialog').open=false;toast('环境及其数据已删除');}
 catch(error){$('deleteEnvironmentError').textContent='删除未完成：'+error.message+'。请重试以完成清理。';}
 finally{environmentDeleting=false;$('cancelDeleteEnvironment').disabled=false;$('deleteEnvironmentName').disabled=false;$('confirmDeleteEnvironment').disabled=$('deleteEnvironmentName').value!==pendingEnvironmentDeletion?.name;}
})();
let setupWizardStep=1,setupAllowCancel=false;
let setupDockerPreparing=false,setupDockerProgress=null,setupImageConfirmed=false,setupSessionStarted=false;
let setupEnvironmentKind='local',setupCreating=false,setupDockerBusy=false,setupDockerChecked=false,setupDockerError='',setupPreviewBusy=false,setupPreviewKey='';
const setupGalaxyNames=['银河系','仙女座星系','三角座星系','大麦哲伦星系','小麦哲伦星系','涡状星系','风车星系','草帽星系','黑眼星系','雪茄星系','波德星系','玉夫座星系','半人马座A星系','南风车星系','向日葵星系','车轮星系','触须星系','鲸鱼座矮星系','天炉座矮星系','巴纳德星系'];
let setupSelectedIcon='rocket';
function selectSetupIcon(name){setupSelectedIcon=environmentIcon(name);$('setupIconPreview').src='assets/icons/'+setupSelectedIcon+'.svg';for(const button of $('setupIconGrid').children)button.setAttribute('aria-pressed',String(button.dataset.icon===setupSelectedIcon));}
for(const name of ENVIRONMENT_ICONS){const button=createUI('app-button');button.dataset.icon=name;button.setAttribute('aria-label',name);button.append(createIcon(name));button.onclick=()=>{selectSetupIcon(name);$('setupIconPicker').open=false;};$('setupIconGrid').append(button);}
$('setupRandomName').onclick=()=>{if(setupCreating)return;const current=$('setupEnvironmentName').value.trim(),names=setupGalaxyNames.filter(name=>name!==current);$('setupEnvironmentName').value=names[Math.floor(Math.random()*names.length)];validateSetupEnvironment();};
let existingContainerBusy=false;
async function loadExistingContainers(prefix='setup'){
 const owner=accountState.user?.id,select=$(prefix+'ExistingContainer');if(!owner)return;
 const previous=select.value;if(prefix==='setup')document.querySelector('.setup-existing-picker').classList.add('hidden');$(prefix+'ExistingStatus').textContent='正在读取本机 Docker 容器…';existingContainerBusy=true;$(prefix+'RefreshExisting').disabled=true;$(prefix+'RefreshExisting').loading=true;
 try{const items=await api.dockerEnvironments('existing');if(owner!==accountState.user?.id)return;select.replaceChildren();for(const item of items){const option=document.createElement('wa-option');option.value=item.key;option.textContent=(item.environmentNames?.length?'环境：'+item.environmentNames.join('、'):'当前账号未关联环境')+' · '+item.name+' · '+item.engine+' · '+(item.running?'运行中':'已停止');option.label=option.textContent;select.append(option);}await select.updateComplete;select.value=items.some(item=>item.key===previous)?previous:'';if(prefix==='setup')document.querySelector('.setup-existing-picker').classList.toggle('hidden',!items.length);$(prefix+'ExistingStatus').textContent=items.length?'可直接使用所选容器的文件、运行时和原网络；移除关联不会删除原容器。':'暂无可接入容器，请先在 Docker 中创建或启动容器，再重新选择。接入保留原有文件和网络，移除关联不会删除容器。';}
 catch(error){$(prefix+'ExistingStatus').textContent='读取失败：'+error.message;}
 finally{existingContainerBusy=false;$(prefix+'RefreshExisting').disabled=false;$(prefix+'RefreshExisting').loading=false;validateSetupEnvironment();if(prefix==='setup')void previewSetupRuntimes(true);}
}
$('setupDockerSource').addEventListener('change',()=>{renderSetupDocker();setupPreviewKey='';if($('setupDockerSource').value==='existing')void loadExistingContainers();else void checkSetupDocker();void previewSetupRuntimes(true);});
$('setupExistingContainer').addEventListener('change',()=>{validateSetupEnvironment();void previewSetupRuntimes(true);});$('setupRefreshExisting').onclick=()=>void loadExistingContainers();
function validateSetupEnvironment(){
 const name=($('setupEnvironmentName').value || '').trim(),existing=setupEnvironmentKind==='docker' && $('setupDockerSource').value==='existing';
 const valid=name.length>0 && name.length<=40 && ['local','docker'].includes(setupEnvironmentKind);
 const dockerReady=setupEnvironmentKind!=='docker' || (existing?Boolean($('setupExistingContainer').value) && !existingContainerBusy:setupImageConfirmed && setupDockerChecked && !setupDockerBusy && dockerEnvironmentState.engine.ready && dockerEnvironmentState.engine.image);
 $('setupCreateLabel').textContent='下一步';$('setupCreate').loading=setupCreating;$('setupCreate').disabled=setupCreating || !valid || (setupWizardStep===2 && !dockerReady);$('setupPrevious').disabled=setupCreating || setupDockerPreparing;
 $('setupCreatingStatus').classList.toggle('hidden',!setupCreating);$('setupCreatingStatus').textContent=setupCreating?`正在创建「${name}」`:'';
 return valid && (setupWizardStep===1 || dockerReady);
}
function setSetupWizardStep(step){
 setupWizardStep=step;$('setupNameStep').classList.toggle('hidden',step!==1);$('setupTypeStep').classList.toggle('hidden',step!==2);
 $('setupCreateView').classList.toggle('hidden',step===3);$('setupDetectView').classList.toggle('hidden',step!==3);
 $('setupPrevious').classList.toggle('hidden',step===1);$('setupCancel').classList.toggle('hidden',!setupAllowCancel);
 $('setupOverallTitle').textContent=step===1?'给你的环境起个名字。':$('setupEnvironmentName').value.trim();
 $('setupOverallDescription').textContent=step===1?'为不同的工作创建独立环境，选择图标和名称，方便随时识别。':'配置你的工作环境，完成后即可开始使用。';
 $('setupStepLabel').textContent=`第 ${step} / 3 步`;
 $('setupStepTitle').textContent=['填写环境名称','选择环境类型','检测运行时'][step-1];
 $('setupFinishLabel').textContent=`创建「${$('setupEnvironmentName').value.trim()}」环境`;
 $('setupStatus').textContent='';
 validateSetupEnvironment();bounds();
}
$('setupPrevious').onclick=()=>{if(!setupCreating && !setupDockerPreparing){setupDetectionVersion++;setSetupWizardStep(Math.max(1,setupWizardStep-1));}};
function beginEnvironmentSetup(kind='local',allowCancel=false){
 setupWizardStep=1;setupAllowCancel=allowCancel;setupSessionStarted=true;setupInProgress=true;setupImageConfirmed=false;setupDockerProgress=null;setupDockerError='';setupPreviewKey='';
 selectSetupIcon(ENVIRONMENT_ICONS[Math.floor(Math.random()*ENVIRONMENT_ICONS.length)]);$('setupEnvironmentName').value='';$('setupImageVersion').value='';$('setupImageSource').value='';$('setupImageRepository').value='';$('setupImageError').textContent='';$('setupImageRepository').classList.add('hidden');$('setupDockerSource').value='new';$('setupExistingContainer').value='';
 $('setupStatus').textContent='';$('setupCreateView').classList.remove('hidden');$('setupDetectView').classList.add('hidden');$('setupCancel').classList.toggle('hidden',!allowCancel);
 $('environmentSetup').classList.remove('hidden');document.body.classList.add('environment-onboarding');
 const localOption=document.querySelector('[data-setup-type=local]');localOption.classList.remove('hidden');localOption.disabled=dockerEnvironmentState.localEnabled!==false;$('setupLocalExists').classList.toggle('hidden',!localOption.disabled);if(localOption.disabled && kind==='local')kind='docker';
 document.querySelector(`[data-setup-type=${kind}]`).click();setSetupWizardStep(1);
}
$('setupCancel').onclick=()=>{if(setupCreating || setupDockerPreparing)return;setupInProgress=false;setupSessionStarted=false;document.body.classList.remove('environment-onboarding');$('environmentSetup').classList.add('hidden');switchPage('environments');};
function showEnvironmentCreated(name){
 $('environmentCreatedTitle').textContent=`「${name}」环境已创建`;
 $('environmentCreatedDescription').textContent='你的工作环境已准备好。完成运行时和代理配置后，即可开始 AI 对话。';
 $('environmentCreatedRuntimes').textContent=setupEnvironmentKind==='docker' && $('setupDockerSource').value==='new'?'新容器不预装大模型，请前往「运行时」安装和配置运行时。':'前往「运行时」查看已检测的运行时，并完成登录配置。';
 $('environmentCreatedDialog').open=true;
}
$('environmentCreatedProxy').onclick=()=>{$('environmentCreatedDialog').open=false;switchPage('overview');document.querySelector('[data-setting=proxy]').click();};
$('environmentCreatedDismiss').onclick=()=>{$('environmentCreatedDialog').open=false;};
$('environmentCreatedConfigure').onclick=()=>{setupInProgress=false;setupSessionStarted=false;document.body.classList.remove('environment-onboarding');$('environmentSetup').classList.add('hidden');$('environmentCreatedDialog').open=false;switchPage('runtime');};

async function previewSetupRuntimes(force=false){
 if(setupWizardStep!==3)return;
 const kind=setupEnvironmentKind,owner=accountState.user?.id,existing=kind==='docker' && $('setupDockerSource').value==='existing',selection=$('setupExistingContainer').value,key=owner+':'+kind+':'+(existing?selection:'new');
 if(!owner)return;
 if(kind==='docker' && !existing){$('setupRuntimePreviewList').replaceChildren();$('setupRuntimePreviewStatus').textContent='新容器不预装大模型，环境创建后，请前往「运行时」配置。';return;}
 if(existing && !selection){$('setupRuntimePreviewList').replaceChildren();$('setupRuntimePreviewStatus').textContent='选择已有容器后，查看其中的对话运行时。';return;}
 if(setupPreviewBusy || (!force && setupPreviewKey===key))return;
 setupPreviewBusy=true;$('setupRuntimePreviewStatus').textContent='正在检测对话运行时…';$('setupRuntimePreviewList').replaceChildren();
 try{const result=existing?await api.dockerEnvironments('previewExisting',{key:selection}):await api.runtimePreview(kind);if(owner!==accountState.user?.id || kind!==setupEnvironmentKind || (existing && selection!==$('setupExistingContainer').value))return;setupPreviewKey=key;
 for(const item of result.runtimes){const row=document.createElement('div'),name=document.createElement('span'),version=document.createElement('small');name.append(createIcon(runtimeIcon(item.id)),document.createTextNode(item.name));version.textContent=item.version;row.append(name,version);$('setupRuntimePreviewList').append(row);}
 $('setupRuntimePreviewStatus').textContent=result.stopped?'该容器已停止，接入后将启动并检测运行时。':result.runtimes.length?(existing?'以下运行时来自所选原容器。':'以下运行时安装在本机，创建后将关联到当前账号的环境。'):'未发现对话运行时。接入后，请前往「运行时」配置。';
 }catch(error){if(owner===accountState.user?.id && kind===setupEnvironmentKind)$('setupRuntimePreviewStatus').textContent='检测未完成：'+error.message;}
 finally{setupPreviewBusy=false;const current=accountState.user?.id+':'+setupEnvironmentKind+':'+(setupEnvironmentKind==='docker' && $('setupDockerSource').value==='existing'?$('setupExistingContainer').value:'new');if(key!==current)void previewSetupRuntimes();}
}
function renderSetupDocker(){
 const engine=dockerEnvironmentState.engine,ready=setupDockerChecked && engine.ready && engine.image;
 const existing=$('setupDockerSource').value==='existing';$('setupDockerChoice').classList.toggle('hidden',setupEnvironmentKind!=='docker');$('setupExistingFields').classList.toggle('hidden',!existing);$('setupDockerPanel').classList.toggle('hidden',setupEnvironmentKind!=='docker' || existing);
 $('setupPrepareDocker').disabled=setupDockerBusy || setupCreating || !['22-bookworm-slim','24-bookworm-slim'].includes($('setupImageVersion').value) || !['official','custom'].includes($('setupImageSource').value) || ($('setupImageSource').value==='custom' && !$('setupImageRepository').value.trim());
 $('setupPrepareDocker').loading=setupDockerPreparing;
 $('setupDockerSource').disabled=setupDockerPreparing;
 $('setupPrepareLabel').textContent=setupDockerPreparing?'应用中':'应用';
 $('setupImageVersion').disabled=setupDockerPreparing;$('setupImageSource').disabled=setupDockerPreparing;$('setupImageRepository').disabled=setupDockerPreparing;

 $('setupDockerPanel').setAttribute('aria-busy',String(setupDockerPreparing));
 $('setupDockerProgress').classList.toggle('hidden',!setupDockerProgress);
 for(const [i,item] of Array.from($('setupDockerProgress').children).entries())item.dataset.state=setupDockerProgress?(setupDockerProgress.complete || i+1<setupDockerProgress.stage?'complete':i+1===setupDockerProgress.stage?(setupDockerProgress.failed?'failed':'current'):'pending'):'pending';
 $('setupPrepareDocker').classList.remove('hidden');
 const download=setupDockerProgress?.download,showDownload=setupDockerPreparing;
 $('setupDownload').classList.toggle('hidden',!showDownload);
 if(download && Number.isFinite(download.percent)){$('setupDownloadBar').value=download.percent;$('setupDownloadValue').textContent=download.percent+'%';}else{$('setupDownloadBar').removeAttribute('value');$('setupDownloadValue').textContent=showDownload?'处理中':'';}
 const size=bytes=>new Intl.NumberFormat(uiLocale(),{maximumFractionDigits:1}).format(bytes/1048576)+' MB';
 $('setupDownloadLabel').textContent=download?.total?`已下载 ${size(download.current)} / 已知下载层 ${size(download.total)}`:setupDockerProgress?.message || '正在准备下载…';
 const engineReady=setupDockerPreparing?setupDockerProgress?.stage>=3:!setupDockerBusy && setupDockerChecked && engine.ready;
 const imageReady=setupDockerPreparing?Boolean(setupDockerProgress?.complete):setupImageConfirmed && !setupDockerBusy && setupDockerChecked && engine.image;
 $('setupDockerEngine').textContent=engineReady?'已就绪':setupDockerBusy?(setupDockerPreparing?'准备中…':'检测中…'):setupDockerChecked?'未就绪':'待检测';
 $('setupDockerEngine').classList.toggle('is-ready',engineReady);
 $('setupDockerImage').classList.toggle('is-ready',imageReady);
 $('setupDockerImage').classList.toggle('is-pending',!setupImageConfirmed && !setupDockerPreparing);
 $('setupDockerImage').textContent=imageReady?'已就绪':!setupImageConfirmed && !setupDockerPreparing?'待选择':setupDockerBusy?(setupDockerPreparing?(download?.total?'下载中…':'准备中…'):'检测中…'):setupDockerChecked?'未就绪':'待检测';
 $('setupDockerStatus').textContent=setupDockerError || (setupDockerPreparing?`配置进度 ${setupDockerProgress?.stage || 1}/4：${setupDockerProgress?.message || '正在检查组件'}…`:setupDockerBusy?'正在检测容器环境…':ready?(setupImageConfirmed?'镜像配置已确认，将为此环境创建独立的新容器。':'引擎已就绪，请选择镜像版本和来源，再点击「应用」。'):setupDockerChecked?'容器环境尚未就绪，点击配置后会自动准备所需组件。':'检测容器引擎和运行所需文件是否就绪。');
 const setInfo=(id,values)=>{const target=$(id);target.replaceChildren();for(const value of values.filter(Boolean).slice(0,2)){const item=document.createElement('span');item.textContent=value;item.title=value;target.append(item);}if(!target.children.length)target.textContent='—';};
 const imageSize=Number.isFinite(engine.imageSize)?new Intl.NumberFormat(uiLocale(),{maximumFractionDigits:1}).format(engine.imageSize/(engine.imageSize>=1073741824?1073741824:1048576))+(engine.imageSize>=1073741824?' GB':' MB'):null;
 setInfo('setupDockerEngineInfo',setupDockerChecked && engine.ready?[engine.name || 'Docker Engine',engine.version?`v${engine.version}`:null]:[]);
 setInfo('setupDockerImageInfo',setupImageConfirmed && setupDockerChecked && engine.image?[engine.imageName,imageSize]:[]);
 $('setupDockerStatus').classList.toggle('setup-docker-error',Boolean(setupDockerError));
 validateSetupEnvironment();
}
async function checkSetupDocker(prepare=false,imageConfig){
 if(setupDockerBusy || setupCreating)return;
 setupDockerBusy=true;setupDockerError='';setupDockerPreparing=prepare;if(prepare)setupDockerProgress={stage:1,message:'正在检查组件'};if(prepare)$('setupTypeTrigger').disabled=true;renderSetupDocker();
 try{await environmentOperation(prepare?'prepare':'state',prepare?{imageConfig}:{});setupDockerChecked=true;if(prepare)setupImageConfirmed=true;}
 catch(error){if(prepare && setupDockerProgress)setupDockerProgress.failed=true;setupDockerChecked=false;setupDockerError=(prepare?'配置失败：':'检测失败：')+error.message+'。请重试。';}
 finally{setupDockerBusy=false;setupDockerPreparing=false;$('setupTypeTrigger').disabled=setupCreating;renderSetupDocker();if(setupEnvironmentKind==='docker')void previewSetupRuntimes(true);}
}
$('setupImageVersion').addEventListener('change',()=>{setupImageConfirmed=false;$('setupImageError').textContent='';renderSetupDocker();});
$('setupImageSource').addEventListener('change',()=>{setupImageConfirmed=false;$('setupImageError').textContent='';renderSetupDocker();});
$('setupImageRepository').addEventListener('input',()=>{setupImageConfirmed=false;$('setupImageError').textContent='';renderSetupDocker();});
$('setupImageSource').addEventListener('change',()=>{$('setupImageRepository').classList.toggle('hidden',$('setupImageSource').value!=='custom');});
$('setupPrepareDocker').onclick=()=>{
 if(!['22-bookworm-slim','24-bookworm-slim'].includes($('setupImageVersion').value) || !['official','custom'].includes($('setupImageSource').value)){$('setupImageError').textContent='请选择镜像版本和来源';return;}
 const repository=$('setupImageSource').value==='official'?'docker.io/library/node':$('setupImageRepository').value.trim(),version=$('setupImageVersion').value;
 if(!repository || !/^[a-z0-9][a-z0-9.:-]*\/(?:[a-z0-9._-]+\/)*[a-z0-9._-]+$/.test(repository)){$('setupImageError').textContent='请输入公开镜像仓库路径，例如 registry.example.com/library/node';return;}
 $('setupImageError').textContent='';void checkSetupDocker(true,{repository,version});
};
$('setupEnvironmentName').addEventListener('input',validateSetupEnvironment);
$('setupEnvironmentName').addEventListener('change',validateSetupEnvironment);
validateSetupEnvironment();
new ResizeObserver(()=>{$('setupEnvironmentType').style.setProperty('--setup-type-width',$('setupTypeTrigger').getBoundingClientRect().width+'px');}).observe($('setupTypeTrigger'));
document.querySelectorAll('[data-setup-type]').forEach(option=>option.addEventListener('click',()=>{if(option.disabled)return;setupEnvironmentKind=option.dataset.setupType;const docker=setupEnvironmentKind==='docker';$('setupTypeName').textContent=docker?'Docker 容器':'本机环境';$('setupTypeSubtitle').textContent=option.querySelector('small').textContent;document.querySelectorAll('[data-setup-type]').forEach(item=>item.querySelector('wa-icon').classList.toggle('hidden',item!==option));renderSetupDocker();$('setupRuntimePreviewList').replaceChildren();$('setupRuntimeOrigin').textContent=docker?'容器':'本机';if(docker){$('setupRuntimePreviewStatus').textContent='等待容器环境检测…';if($('setupDockerSource').value==='existing')void loadExistingContainers();else void checkSetupDocker();void previewSetupRuntimes(true);}else void previewSetupRuntimes(true);}));
let setupDetectionVersion=0;
$('setupCreate').onclick=()=>void action(async()=>{
 if(setupCreating || !validateSetupEnvironment())return;
 if(setupWizardStep===1){setSetupWizardStep(2);return;}
 setSetupWizardStep(3);await detectSetupRuntimes();
});
async function detectSetupRuntimes(){
 const version=++setupDetectionVersion,owner=accountState.user?.id,kind=setupEnvironmentKind;
 $('setupDetect').disabled=true;$('setupFinish').disabled=true;
 $('setupRuntimeCount').textContent='检测运行时';$('setupRuntimeState').textContent='正在检测…';$('setupRuntimeResults').replaceChildren();$('setupStatus').textContent='';
 try{
  const existing=kind==='docker' && $('setupDockerSource').value==='existing';
  const registry=existing?await api.dockerEnvironments('previewExisting',{key:$('setupExistingContainer').value}):kind==='local'?await api.runtimePreview('local'):{runtimes:[]};
  if(version!==setupDetectionVersion || owner!==accountState.user?.id || setupWizardStep!==3)return;
  $('setupRuntimeCount').textContent=`${registry.runtimes.length} 个运行时`;
  $('setupRuntimeState').textContent=registry.stopped?'容器已停止':registry.runtimes.length?'检测完成':'暂无运行时';
  for(const item of registry.runtimes){
   const row=document.createElement('div'),copy=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('small');
   row.className='setup-runtime-row';row.setAttribute('role','listitem');name.textContent=item.name;detail.textContent=item.version;
   copy.append(name,detail);row.append(createIcon(runtimeIcon(item.id)),copy);$('setupRuntimeResults').append(row);
  }
  if(!registry.runtimes.length){const empty=document.createElement('p');empty.className='muted';empty.textContent=registry.stopped?'容器启动后可重新检测运行时。':'创建环境后，可在「运行时」中添加。';$('setupRuntimeResults').append(empty);}
  $('setupFinish').disabled=false;
 }catch(error){if(version===setupDetectionVersion){$('setupRuntimeState').textContent='检测失败';$('setupStatus').textContent=error.message;}}
 finally{if(version===setupDetectionVersion)$('setupDetect').disabled=false;}
}
$('setupDetect').onclick=()=>void action(detectSetupRuntimes);
$('setupFinish').onclick=()=>void action(async()=>{
 if(setupCreating || $('setupFinish').disabled || setupWizardStep!==3)return;
 const name=$('setupEnvironmentName').value.trim();setupCreating=true;
 $('setupFinish').disabled=true;$('setupFinish').loading=true;$('setupPrevious').disabled=true;$('setupDetect').disabled=true;$('setupStatus').textContent=`正在创建「${name}」环境…`;
 try{
  if(setupEnvironmentKind==='local'){await environmentOperation('createLocal',{name,icon:setupSelectedIcon});await performEnvironmentOperation('select',{id:null});}
  else{const existing=$('setupDockerSource').value==='existing';const state=await environmentOperation(existing?'attach':'create',{name,icon:setupSelectedIcon,key:$('setupExistingContainer').value});await performEnvironmentOperation('select',{id:state.createdId});}
  // Creation succeeded even if the subsequent runtime refresh fails.
  try{await refreshRuntimeRegistry(true);}catch(error){toast('环境已创建，运行时检测可稍后重试：'+error.message,'runtime');}
  setupInProgress=false;setupSessionStarted=false;document.body.classList.remove('environment-onboarding');$('environmentSetup').classList.add('hidden');switchPage(setupEnvironmentKind==='docker'?'runtime':'cc');showEnvironmentCreated(name);void reloadAccountChats();
 }catch(error){$('setupStatus').textContent=error.message;throw error;}
 finally{setupCreating=false;$('setupFinish').loading=false;$('setupFinish').disabled=false;$('setupPrevious').disabled=false;$('setupDetect').disabled=false;validateSetupEnvironment();}
});
$('sendContainerLoginInput').onclick=()=>void action(async()=>{await api.dockerEnvironments('loginInput',{text:$('containerLoginInput').value});$('containerLoginInput').value='';});
$('closeContainerLogin').onclick=()=>{$('containerLoginDialog').open=false;};
$('containerLoginDialog').addEventListener('wa-after-hide',()=>{void api.dockerEnvironments('loginCancel').catch(()=>{});$('containerLoginOutput').value='';$('containerLoginInput').value='';});
function updateProxyActions(){
 const saved=currentProxyConfig || {};
 const savedConfigured=Boolean(saved.host) && Number(saved.port)>0;
 $('proxyConfigActionLabel').textContent=savedConfigured?'编辑代理':'新增代理';$('proxyConfigActionIcon').src='assets/icons/'+(savedConfigured?'pencil':'plus')+'.svg';
 const port=Number($('port').value);
 const configured=Boolean(($('host').value || '').trim()) && Number.isInteger(port) && port>0 && port<=65535;
 const connected=network.state==='ready' || Boolean(network.recovering);
 const button=$('proxyQuickToggle');
 button.dataset.action=connected?'disconnect':'connect';
 const label=connected?'断开代理':'连接代理';button.setAttribute('aria-label',label);button.title=label;
 button.querySelector('wa-icon').src=`assets/icons/${connected?'unplug':'plug'}.svg`;
 button.disabled=!savedConfigured || proxyActionBusy || network.state==='checking';
 $('verify').disabled=!savedConfigured || !environmentAllowed || proxyActionBusy || network.state==='checking';
 const needsParse=$('proxyDialog').open && proxyMethod!=='manual' && !importPrepared;
 const importReady=Boolean(importPreview?.entries?.length) || (proxyMethod==='paste' && Boolean($('importText').value.trim())) || (proxyMethod==='file' && Boolean(proxyFileSelection));
 $('connect').disabled=(needsParse?!importReady:!configured) || !environmentAllowed || proxyActionBusy || network.state==='checking';
 $('connect').classList.remove('hidden');
 $('connectLabel').textContent=proxyActionBusy || network.state==='checking'?'处理中…':needsParse?(importPreview?.entries?.length?'使用所选代理':proxyMethod==='file'?'导入并解析':'解析内容'):editingProxy?'保存并连接':'连接并核验出口';

 $('upstreamLabel').textContent=savedConfigured?protocolLabel(saved.protocol)+' · '+saved.host+':'+saved.port:'未配置';
 $('routeEnvironment').textContent=dockerEnvironmentState.activeId?'Docker 环境':'本机环境';
 for(const [id,value] of Object.entries({proxyInfoProtocol:savedConfigured?protocolLabel(saved.protocol):'未配置',proxyInfoHost:saved.host || '—',proxyInfoPort:savedConfigured?String(saved.port):'—',proxyInfoUsername:saved.username || '—',proxyInfoPassword:saved.hasPassword?'已配置':'未配置'}))$(id).textContent=value;

}
function renderProxyRegion(status){
  const code=/^[A-Z]{2}$/.test(status.countryCode || '')?status.countryCode:null;
  $('proxyFlag').textContent=code?String.fromCodePoint(...[...code].map(char=>127397+char.charCodeAt(0))):'—';
  const locale=$('languageSelect').value || 'zh-CN',english=locale==='en-US';
  const location=formatProxyLocation(status,locale);
  $('proxyFlag').setAttribute('aria-label',location.country);
  $('proxyRegion').textContent=location.text;
}
let lastNetworkLog = '';
function setNetwork(status) {
  network = status;
  updateProxyActions();
  const state=status.recovering?'checking':status.state;
  $('proxySummary').dataset.state=state;
  $('proxyStatusIcon').src=`assets/icons/${state==='ready'?'shield-check':state==='checking'?'loader-circle':'unplug'}.svg`;
  $('proxyStatusLabel').textContent=state==='ready'?'正在代理':state==='checking'?(status.recovering?'自动恢复中':'正在核验'):'代理已断开';

  renderProxyRegion(status);
  const code=/^[A-Z]{2}$/.test(status.countryCode || '')?status.countryCode:null;
  document.querySelector('.proxy-detail-line').classList.toggle('hidden',status.state!=='ready');
  $('proxyIPLine').classList.toggle('hidden',status.state!=='ready');$('proxySummaryIP').classList.toggle('hidden',status.state!=='ready');
  $('proxySummaryIP').textContent=status.ip || '出口尚未核验';
  $('proxySummary').title=[status.reason,code?`IP 地区估计 · ${status.regionSource || '代理检测'}`:null,status.state!=='ready'&&status.ip?'上次核验出口，当前已阻止访问':null].filter(Boolean).join('\n');
  const names = { ready: '已连接', checking: '核验中', blocked: '未连接' };
  $('networkPill').textContent = `● ${names[status.state] || '未连接'}`;
  $('networkPill').className = `pill ${status.state}`;
  $('connectionState').textContent = status.recovering?'恢复中':names[status.state] || '未连接';$('connectionState').dataset.state=state;
  $('exitIp').textContent = status.ip || '尚未核验';$('exitIpLabel').textContent=status.ip && status.state!=='ready'?'上次核验 IP':'出口 IP';
  renderNetworkTimes(status);
  $('footerStatus').textContent = status.state === 'ready' ? `● 应用代理就绪 · ${status.ip}` : browserTabsState.mode==='direct'?'● 代理未连接 · 浏览器直连':'● 应用联网已锁定';
  $('localAddress').textContent = status.state==='ready'?(status.address || '已连接'):'等待连接';
  $('prompt').disabled=draftPersistence.loading || !activeChatId;
  $('chatProxyTooltip').disabled=chatNetworkReady();if(chatNetworkReady())$('chatProxyTooltip').open=false;
  $('send').disabled = (!busy && (draftPersistence.loading || !activeChatId));
  $('navigate').disabled = browserTabsState.mode==='proxy' && status.state !== 'ready';
  $('verify').disabled = !currentProxyConfig?.host || proxyActionBusy || status.state==='checking' || !environmentAllowed;
  $('ccState').textContent = !chatNeedsProxy() && !busy?(chatSessions.find(item=>item.id===activeChatId)?.networkMode==='auto'?'自动 · '+(network.state==='ready'?'代理优先':'当前直连'):'当前对话使用直连'):busy ? `${RUNTIME_CATALOG[selectedEngine]?.name || selectedEngine} 正在处理…` : status.state === 'ready' ? (selectedEngine==='codex'?'Codex · 请求通过应用代理':'模型请求通过应用代理') : '等待连接代理';
  const logKey = JSON.stringify([status.state, status.reason, status.ip, status.checkedAt]);
  if (logKey !== lastNetworkLog) { activity(status.reason || '网络状态更新'); lastNetworkLog = logKey; }
  if(status.state==='ready' && page==='browser')void action(()=>api.browser('open'));
  bounds();
}
function bubble(role, text, engine = selectedEngine, pending = false, images = [], reasoning = null, createdAt = null, documents = []) {
  $('chatEmpty')?.remove();
  if(role==='assistant' && pending && !createdAt)createdAt=new Date().toISOString();
  const block = document.createElement('div'); block.className = `bubble ${role}`;
  const label = document.createElement('div'); label.className = 'bubble-label'; label.textContent = role === 'user' ? '你' : role === 'error' ? '请求状态' : (RUNTIME_CATALOG[engine]?.name || engine);
  const content = document.createElement('div');content.className='message-content';if(createdAt)block.messageCreatedAt=createdAt;if(role==='assistant'){updateChatMessage(content,text);if(pending && !text){content.classList.add('reply-loading');content.setAttribute('role','status');content.setAttribute('aria-label','正在等待回复');content.textContent='';}}else{content.dataset.rawText=text;content.textContent=text;}
  if(role==='user' && images.length){
    block.classList.add('has-images');block.messageImages=images.map(image=>({...image}));
    const gallery=document.createElement('div');gallery.className='message-images';
    for(const image of block.messageImages){const button=document.createElement('app-button');button.setAttribute('layout','custom');button.type='button';button.className='message-image';button.previewImage=image;button.setAttribute('aria-label','预览图片 '+(image.name || '图片'));const thumbnail=document.createElement('img');thumbnail.src=image.dataURL || image.url;thumbnail.alt=image.name || '图片';button.append(thumbnail);button.onclick=()=>deepseekComposer.showPreview(image);gallery.append(button);}
    block.append(gallery);if(!text.trim())content.hidden=true;
  }
  if(role==='user' && documents.length){block.messageDocuments=structuredClone(documents);const cards=document.createElement('div');cards.className='message-documents';renderDocumentCards(cards,documents);block.append(cards);}
  if(role==='error')block.append(label); block.append(content);if(reasoning && (reasoning.text || reasoning.activities?.length || Number.isFinite(reasoning.durationMs)))reasoningView(content,{...reasoning,complete:true},updateChatMessage); if(role==='user')mountMessageActions(block,{text,createdAt,onCopy:value=>void action(()=>navigator.clipboard.writeText(value)),canEdit:()=>{if(busy){toast('请先停止当前回复','chat');return false;}return true;},onEdit:()=>{
   const owner=chatOwnerID,conversation=activeChatId,environment=dockerEnvironmentState.activeId;
   openMessageEditor(block,{text,onSend:async value=>{
    if(owner!==chatOwnerID || conversation!==activeChatId || environment!==dockerEnvironmentState.activeId)throw new Error('对话已变化，请重新编辑');
    if(busy)throw new Error('请先停止当前回复');
    const attachments=(block.messageImages || []).map(image=>({...image}));
    if(!value.trim() && !attachments.length)throw new Error('请输入消息内容');
    const message=['deepseek','codex'].includes(selectedEngine)?{text:value.trim(),images:attachments,documents:block.messageDocuments||[],thinking:deepseekComposer.payload('').thinking}:value.trim();
    await sendChatMessage(message,{editBlock:block});
   }});
  }});
  if(role==='assistant')mountMessageActions(block,{text:()=>content.dataset.rawText || '',createdAt,onCopy:value=>void action(()=>navigator.clipboard.writeText(value))});
  $('chat').append(block); chatScroll.follow($('chat')); return content;
}
$('chat').addEventListener('reasoning-toggle',()=>saveChatView());
$('chat').addEventListener('click',event=>{
 const link=event.target.closest?.('.markdown-body a');if(!link)return;event.preventDefault();
 let url;try{url=new URL(link.getAttribute('href'));}catch{return;}
 if(!['http:','https:'].includes(url.protocol))return;
 void action(async()=>{await api.browserLibrary('openLink',{url:url.href});const key=/^(localhost|127\.|\[::1\])/.test(url.hostname)?'localLinks':'webLinks';if(browserPreferences[key]!=='external')switchPage('browser');});
});
const approvalCards=mountToolApprovalCards({host:$('approval'),scope:()=>[chatOwnerID,chatEnvironmentID,activeChatId],decide:(id,allow)=>api.approval(id,allow),onError:message=>toast(message,'chat')});
function renderApproval(){approvalCards.render();}

let importPreview = null;
function closeImport() {
  $('importText').value = ''; $('importEntries').replaceChildren();
  importPreview = null; void api.cancelImport().catch(() => {});
}
async function applyImport(index) {
  const preview = importPreview;
  if (!preview) throw new Error('请先解析导出内容');
  const config = await api.applyIproyal({ batchId: preview.batchId, index });
  for (const key of ['protocol', 'host', 'port', 'username', 'password']) $(key).value = config[key];
  hasPassword = false; $('password').placeholder = '已导入凭据';updateProxyActions();
  const status = `已导入 ${protocolLabel(config.protocol)} 代理，请点击“连接并核验出口”。`;
  $('importStatus').textContent = status + (preview.warnings.length ? ` ${preview.warnings.join(' ')}` : '');
  $('importStatus').classList.add('success');
  $('upstreamLabel').textContent = '尚未连接新导入的代理';
  importPrepared=true;closeImport();$('importSelection').classList.add('hidden');$('proxyImportResult').classList.remove('hidden');$('proxyImportEndpoint').textContent=protocolLabel(config.protocol)+' · '+config.host+':'+config.port;$('proxyImportAuth').textContent=config.username || config.password?'已读取凭据（不展示）':'无凭据';updateProxyActions();
}
async function importFrom(source, filePath) {
  $('importError').textContent = '';
  const preview = await api.importIproyal({ source, filePath, text: source === 'text' ? $('importText').value : undefined, defaultProtocol: source === 'text' ? $('importProtocol').value : 'http' });
  if (preview.canceled) return;
  importPreview = preview;
  $('importText').value = '';
  if (preview.entries.length === 1) { await applyImport(0); return; }
  $('pastePanel').classList.add('hidden'); $('importSelection').classList.remove('hidden');
  $('importEntries').replaceChildren(); $('importWarnings').textContent = preview.warnings.join(' ');
  for (const entry of preview.entries) {
    const radio = document.createElement('wa-radio'); radio.className='import-entry';radio.value=String(entry.index);
    const label = document.createElement('span'); label.textContent = `${protocolLabel(entry.protocol)} · ${entry.host}:${entry.port}`;
    const detail = document.createElement('small'); detail.textContent = entry.authenticated ? '用户名和密码已读取（不展示）' : '无凭据，请确认已设置 IP 白名单';label.append(detail);
    radio.append(label);$('importEntries').append(radio);
  }
  $('importEntries').value='0';
  $('proxyImportResult').classList.add('hidden');updateProxyActions();
}
$('importText').addEventListener('input',()=>{importPrepared=false;importPreview=null;for(const key of ['host','port','username','password'])$(key).value='';$('proxyImportResult').classList.add('hidden');updateProxyActions();});
document.querySelectorAll('.nav').forEach(el => el.onclick = () => void action(()=>switchPage(el.dataset.page)));
for(const el of document.querySelectorAll('.sidebar nav>.nav')){el.id='primary-nav-'+el.dataset.page;const name=el.querySelector('span').textContent.trim();el.setAttribute('aria-label',name);const tip=document.createElement('wa-tooltip');tip.for=el.id;tip.placement='right';tip.textContent=name;tip.className='primary-nav-tooltip';tip.disabled=!sidebarCollapsed;document.body.append(tip);}
new ResizeObserver(bounds).observe($('browserViewport')); window.addEventListener('resize', bounds); window.addEventListener('offline', () => { void api.networkSignal('offline'); }); window.addEventListener('online', () => { void api.networkSignal('online'); }); document.querySelector('main').addEventListener('scroll', bounds);
$('proxyForm').onsubmit = event => { event.preventDefault(); if(proxyActionBusy)return;void action(async () => {
  $('proxyValidation').classList.add('hidden');
  if(proxyMethod!=='manual' && !importPrepared){
   proxyActionBusy=true;updateProxyActions();$('importError').textContent='';
   try{if(importPreview?.entries?.length){const selected=$('importEntries').value;await applyImport(Number(selected));}else if(proxyMethod==='paste')await importFrom('text');else if(proxyMethod==='file' && proxyFileSelection)await importFrom('file',proxyFileSelection);}
   catch(error){$('importError').textContent=error.message.replace(/^Error invoking remote method '[^']+': Error: /,'');}
   finally{proxyActionBusy=false;updateProxyActions();}return;
  }
  const port=Number($('port').value);
  const invalid=!$('host').value.trim()?'请输入代理主机 / IP。':!Number.isInteger(port) || port<1 || port>65535?'端口必须是 1～65535 的整数。':null;
  if(invalid){$('proxyValidation').textContent=invalid;$('proxyValidation').classList.remove('hidden');( !$('host').value.trim()?$('host'):$('port')).focus();return;}
  proxyActionBusy=true;updateProxyActions();$('connect').disabled = true;
  $('upstreamLabel').textContent = `${protocolLabel($('protocol').value)} · ${$('host').value}:${$('port').value}`;
  try { const status = await api.connect({ protocol: $('protocol').value, host: $('host').value, port: Number($('port').value), username: $('username').value, password: $('password').value, useSavedPassword: hasPassword && !$('password').value }, $('remember').checked); if (status.state === 'ready') { hasPassword = Boolean($('password').value) || hasPassword; $('password').value = ''; $('password').placeholder = hasPassword ? '已配置（留空沿用）' : '可选'; currentProxyConfig={protocol:$('protocol').value,host:$('host').value,port:Number($('port').value),username:$('username').value,hasPassword};$('proxyDialog').open=false;toast('出口已核验。当前为应用代理原型，系统级保护尚未实现。','network'); } }
  finally { proxyActionBusy=false;updateProxyActions(); }
}); };
for (const key of ['protocol', 'host', 'port', 'username']) $(key).addEventListener('input', () => { hasPassword = false; $('password').placeholder = '可选（更换代理后需重新输入）'; });
async function disconnectProxy(){
 if(proxyActionBusy)return;
 proxyActionBusy=true;updateProxyActions();
 try{await api.disconnect();toast('代理已断开','network');}finally{proxyActionBusy=false;updateProxyActions();}
}
function restoreCurrentProxyForm(){
 const config=currentProxyConfig || {};
 for(const key of ['protocol','host','port','username'])$(key).value=config[key] ?? (key==='protocol'?'http':key==='port'?8080:'');
 $('password').value='';hasPassword=Boolean(config.hasPassword);$('password').placeholder=hasPassword?'已保存（留空沿用）':'可选';
}
async function reconnectCurrentProxy(){
 if(proxyActionBusy || !currentProxyConfig?.host)return;
 proxyActionBusy=true;updateProxyActions();
 try{await api.connect({...currentProxyConfig,password:'',useSavedPassword:Boolean(currentProxyConfig.hasPassword)},$('remember').checked);}
 finally{proxyActionBusy=false;updateProxyActions();}
}

$('verify').onclick = () => action(reconnectCurrentProxy);
$('proxyDetailsToggle').onclick=()=>{
 const expanded=$('proxyDetailsToggle').getAttribute('aria-expanded')!=='true';
 $('proxyDetailsToggle').setAttribute('aria-expanded',String(expanded));
 $('proxyConnectionDetails').classList.toggle('hidden',!expanded);
 $('proxyDetailsChevron').setAttribute('src','assets/icons/'+(expanded?'chevron-down':'chevron-right')+'.svg');
};
let proxyMethod='manual';
function selectProxyMethod(method){
 proxyMethod=method;importPrepared=false;closeImport();proxyFileSelection=null;++proxyFileVersion;
 for(const key of ['host','port','username','password'])$(key).value='';hasPassword=false;
 document.querySelectorAll('[data-proxy-method]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.proxyMethod===method)));
 $('proxyManualPanel').classList.toggle('hidden',method!=='manual');$('proxyFilePanel').classList.toggle('hidden',method!=='file');$('proxyImportPanel').classList.toggle('hidden',method==='manual');$('pastePanel').classList.toggle('hidden',method!=='paste');$('importSelection').classList.add('hidden');$('proxyImportResult').classList.add('hidden');$('importError').textContent='';$('importStatus').classList.add('hidden');$('proxyValidation').classList.add('hidden');updateProxyActions();$('proxyFileChoose').value='';$('proxyFileError').textContent='';
}
for(const button of document.querySelectorAll('[data-proxy-method]'))button.onclick=()=>selectProxyMethod(button.dataset.proxyMethod);
$('openProxyDialog').onclick=()=>{editingProxy=Boolean(currentProxyConfig?.host);selectProxyMethod('manual');
 clearTimeout(proxySaveTimer);++proxySaveVersion;
 for(const key of ['host','username','password'])$(key).value='';$('protocol').value='http';$('port').value='';hasPassword=false;$('password').placeholder='可选';
 $('proxyValidation').classList.add('hidden');$('importStatus').textContent='导入代理列表，或在下方手动填写。';$('importStatus').classList.remove('success');
 if(editingProxy)restoreCurrentProxyForm();
 const title=editingProxy?'编辑代理':'新增代理';$('proxyDialogTitle').textContent=title;$('proxyDialog').label=title;$('closeProxyDialog').setAttribute('aria-label','关闭'+title);
 $('proxyDialog').open=true;updateProxyActions();
};
for(const id of ['closeProxyDialog','cancelProxyDialog'])$(id).onclick=()=>{$('proxyDialog').open=false;};
$('proxyDialog').addEventListener('wa-after-hide',event=>{if(event.target!==$('proxyDialog'))return;++proxyFileVersion;closeImport();restoreCurrentProxyForm();updateProxyActions();});
function renderBrowserTabs(state) {
  const changedTab = browserTabsState.activeId !== state.activeId;
  browserTabsState = state;
  browserModeSwitches.render(state.mode);
  $('browserNetworkLabel').textContent=({direct:'直接连接',proxy:'使用应用代理',mixed:'自动选择'})[state.mode]||'使用应用代理';
  $('browserNetworkMenu').querySelector('[slot=start]').src='assets/icons/'+({direct:'globe',proxy:'shield-check',mixed:'network'}[state.mode]||'shield-check')+'.svg';
  for(const item of document.querySelectorAll('[data-browser-network]'))item.checked=item.dataset.browserNetwork===state.mode;
  const direct=state.mode==='direct',mixed=state.mode==='mixed';
  $('browserViewport').querySelector('.browser-empty h2').textContent=mixed?'自动选择访问线路':direct?'使用本机网络浏览':'在同一出口下浏览';
  $('browserViewport').querySelector('.browser-empty p').textContent=mixed?'优先使用代理，首次连接失败时尝试直连；成功后按域名固定线路。':direct?'输入网址或关键词，无需连接代理。':'连接代理后输入网址或关键词，默认使用 Google 搜索。';
  if(network.state!=='ready')$('footerStatus').textContent=mixed?'● 自动选择 · 代理未连接时尝试直连':direct?'● 代理未连接 · 浏览器直连':'● 应用联网已锁定';
  $('navigate').disabled=state.mode==='proxy' && network.state!=='ready';
  if (changedTab) { addressEditing = false; closeSuggestions(); browserToolbar.tabChanged(); }
  $('browserTabs').replaceChildren();
  for (const tab of state.tabs) {
    const item=document.createElement('wa-tab');item.panel=tab.id;item.className=`browser-tab tab-select ${tab.id===state.activeId?'active':''}`;item.dataset.url=tab.url;item.id='browser-tab-'+tab.id;
    const title=document.createElement('span');title.className='tab-title';title.textContent=`${tab.loading?'◌ ':''}${tab.title}`;
    const close=createUI('app-button');close.className='tab-close';close.setAttribute('icon-action-exempt','');close.append(createIcon('x'));close.setAttribute('aria-label',`关闭 ${tab.title}`);
    close.onclick=event=>{event.stopPropagation();void action(()=>api.browser('close',tab.id));};
    item.append(title,close);$('browserTabs').append(item);const tooltip=document.createElement('wa-tooltip');tooltip.for=item.id;tooltip.textContent=tab.url;$('browserTabs').append(tooltip);
    const panel=document.createElement('wa-tab-panel');panel.name=tab.id;$('browserTabs').append(panel);
  }
  $('browserTabs').active=state.activeId;
  const active = state.tabs.find(tab => tab.id === state.activeId);
  if (active) {
    $('browserMessage').classList.toggle('has-error', Boolean(active.error));
    if (!addressEditing) $('address').value = browserAddress(active.url);
    $('browserMessage').textContent = active.error || (active.loading ? (mixed?'正在自动选择访问线路…':state.mode==='direct'?'正在通过本机网络加载…':'正在通过应用代理加载…') : active.started ? (mixed?(active.route==='direct'?'自动选择 · 当前域名使用本机直连。':active.route==='proxy'?'自动选择 · 当前域名使用应用代理。':'自动选择 · 尚未确定当前域名线路。'):state.mode==='direct'?'页面使用本机网络直接连接。':'页面使用应用代理。') : '输入网址或关键词，默认使用 Google 搜索。');
  }
  bounds();
}
function closeSuggestions() {
  suggestionsOpen = false; $('addressSuggestions').classList.add('hidden');
  $('address').setAttribute('aria-expanded', 'false'); $('address').removeAttribute('aria-activedescendant'); bounds();
}
function chooseSuggestion(item) {
  closeSuggestions(); addressEditing = false; $('address').blur();
  void action(() => item.tabId ? api.browser('select', item.tabId) : api.browser('navigate', item.url));
}
function renderSuggestions(reset = true) {
  const query = $('address').value.trim(), key = query.toLowerCase();
  const matches = item => !key || `${item.title} ${item.url}`.toLowerCase().includes(key);
  const items = [];
  if (query) {
    const url = resolveBrowserAddress(query);
    items.push({ title: url.startsWith('https://www.google.com/search?') ? `${query} — Google 搜索` : `访问 ${query}`, url, icon: '⌕' });
    if (!url.startsWith('https://www.google.com/search?')) {
      const search = new URL('https://www.google.com/search'); search.searchParams.set('q', query); search.searchParams.set('hl', 'en');
      items.push({ title: `${query} — Google 搜索`, url: search.href, icon: '⌕' });
    }
  }
  const tabs = browserTabsState.tabs.filter(tab => tab.started && matches(tab));
  for (const tab of tabs) items.push({ title: tab.title, url: tab.url, tabId: tab.id, icon: '▣' });
  for (const entry of addressHistory.filter(matches)) {
    if (!tabs.some(tab => tab.url === entry.url)) items.push({ ...entry, icon: '◷' });
  }
  suggestionItems = items.slice(0, 8);
  if (!suggestionItems.length) { closeSuggestions(); return; }
  if (reset) suggestionIndex = 0;
  $('addressSuggestions').replaceChildren();
  suggestionItems.forEach((item, index) => {
    const row = createUI('app-button'); row.type = 'button'; row.id = `address-option-${index}`;
    row.className = `address-option ${index === suggestionIndex ? 'selected' : ''}`;
    row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === suggestionIndex));
    const icon = document.createElement('span'); icon.className = 'suggestion-icon'; icon.append(createIcon(item.icon==='⌕'?'search':item.icon==='↗'?'globe':'history'));
    const text = document.createElement('span'); text.className = 'suggestion-text'; text.textContent = item.title;
    const url = document.createElement('span'); url.className = 'suggestion-url'; url.textContent = item.tabId ? '切换到这个标签页' : item.url;
    row.append(icon, text, url);
    row.onmousedown = event => event.preventDefault();
    row.onclick = () => chooseSuggestion(item); $('addressSuggestions').append(row);
  });
  $('addressSuggestions').style.top = `${document.querySelector('.browser-toolbar').getBoundingClientRect().bottom - $('page-browser').getBoundingClientRect().top}px`;
  suggestionsOpen = true; $('addressSuggestions').classList.remove('hidden');
  $('address').setAttribute('aria-expanded', 'true'); $('address').setAttribute('aria-activedescendant', `address-option-${suggestionIndex}`); bounds();
}
$('newTab').onclick = () => action(() => { closeSuggestions(); addressEditing = false; return api.browser('new'); });
$('navigate').onclick = () => { const url = resolveBrowserAddress($('address').value); closeSuggestions(); addressEditing = false; $('address').blur(); void action(() => api.browser('navigate', url)); };
$('address').onfocus = () => { $('address').value=browserTabsState.tabs.find(t=>t.id===browserTabsState.activeId)?.url || $('address').value; addressEditing = true; $('address').select(); renderSuggestions(); };
$('address').oninput = () => { addressEditing = true; renderSuggestions(); };
$('address').onblur = () => { addressEditing = false; closeSuggestions();$('address').value=browserAddress(browserTabsState.tabs.find(t=>t.id===browserTabsState.activeId)?.url || $('address').value); };
$('address').onkeydown = event => {
  if (event.isComposing) return;
  if (event.key === 'Escape') { event.preventDefault(); closeSuggestions(); }
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); if (!suggestionsOpen) renderSuggestions();
    if (!suggestionItems.length) return;
    suggestionIndex = (suggestionIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestionItems.length) % suggestionItems.length;
    renderSuggestions(false);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (suggestionsOpen && suggestionItems[suggestionIndex]) chooseSuggestion(suggestionItems[suggestionIndex]);
    else $('navigate').click();
  }
};
for (const name of ['back', 'forward', 'reload']) $(name).onclick = () => action(() => api.browser(name));
$('pickProject').onclick=()=>void action(async()=>{
 $('composeMenu').open=false;if(busy)throw new Error('请先停止当前请求');
 const owner=chatOwnerID,environment=dockerEnvironmentState.activeId,id=activeChatId;
 const mode=await chooseProjectMode(Boolean(environment));if(!mode)return;
 const selected=await openFilePicker('directory',mode==='container'?'container':'host');if(!selected)return;
 if(owner!==chatOwnerID || environment!==dockerEnvironmentState.activeId || id!==activeChatId)throw new Error('对话账号或环境已变化，请重新选择');
 const button=$('pickProject');button.disabled=true;$('projectTransferStatus').textContent=mode==='import'?'正在导入环境…':mode==='mount'?'正在接入本机项目，可能需要数分钟…':'正在选择文件夹…';$('projectTransferDialog').open=true;
 try{const selectedPath=await api.project({mode:environment?mode:'local',path:selected});if(owner!==chatOwnerID || environment!==dockerEnvironmentState.activeId || id!==activeChatId)throw new Error('对话账号或环境已变化');const item=chatSessions.find(item=>item.id===id);if(item)item.project=selectedPath;renderSessionHeader();saveChatView();toast(mode==='import'?'已导入环境，原文件保持不变':mode==='mount'?'已接入本机项目，修改会同步到本机':'已选择工作目录','chat');}
 finally{button.disabled=false;$('projectTransferDialog').open=false;}
});
function chooseProjectMode(container){
 const dialog=$('projectModeDialog'),group=$('projectMode');group.value=container?'container':'mount';
 for(const option of group.querySelectorAll('wa-radio'))option.disabled=!container && option.value!=='mount';
 $('projectModeNote').textContent=container?'选择项目的打开方式。':'当前为本机环境，可直接选择本机项目。选择容器文件夹或导入环境，请先切换到容器环境。';
 $('projectMountDescription').textContent=container?'将本机目录挂载到当前环境，修改会同步影响本机文件。':'直接打开本机目录，修改会保存到原项目。';
 $('projectMountDetail').hidden=!container;
 dialog.open=true;
 return new Promise(resolve=>{let choice=null;const finish=()=>{dialog.removeEventListener('wa-after-hide',finish);resolve(choice);};dialog.addEventListener('wa-after-hide',finish);$('projectModeContinue').onclick=()=>{choice=group.value;dialog.open=false;};$('projectModeCancel').onclick=()=>{dialog.open=false;};});
}
mountCompositionGuard($('prompt'));
const deepseekComposer=mountDeepSeekComposer({getImages:()=>[...$('chat').querySelectorAll('.message-image')].map(el=>el.previewImage).filter(Boolean),context:()=>({key:(chatOwnerID || '')+':'+dockerEnvironmentState.activeId+':'+activeChatId,enabled:['deepseek','codex'].includes(selectedEngine) && Boolean(activeChatId),engine:selectedEngine,busy:busy || draftPersistence.loading}),toast:message=>toast(message,'chat'),onChange:()=>draftPersistence.capture()});
const draftPersistence=mountDraftPersistence({input:$('prompt'),form:$('chatForm'),scope:()=>({owner:chatOwnerID,environmentId:chatEnvironmentID,chatId:activeChatId}),composer:deepseekComposer,onReady:()=>{renderChatAvailability();renderAuth();deepseekComposer.render();},onError:message=>toast(message,'chat')});
mountAssistantImagePreviews({root:$('chat'),context:()=>({owner:chatOwnerID || null,environmentId:chatEnvironmentID || null,chatId:activeChatId}),read:value=>api.readChatImage(value),preview:image=>deepseekComposer.showPreview(image)});
const chatNeedsProxy=()=>chatSessions.find(item=>item.id===activeChatId)?.networkMode!=='direct';
const chatNetworkReady=()=>!chatNeedsProxy() || network.state==='ready';
function renderAuth(){
 const auth=authStates[selectedEngine];const labels={'signed-in':'已登录','signed-out':'未登录','not-installed':'未安装','unknown':'登录态检测失败','checking':'正在检测登录态…'};
 $('send').disabled=(!busy && (draftPersistence.loading || !activeChatId));updateSendButton();
}
async function checkAIAuth(){const engine=selectedEngine,id=++authRequestId;authStates[engine]={state:'checking'};renderAuth();try{const result=await api.aiAuth(engine);if(id===authRequestId){authStates[engine]=result;renderAuth();}}catch{if(id===authRequestId){authStates[engine]={state:'unknown'};renderAuth();}}}
function renderRuntime(){
 renderAuth();deepseekComposer.render();renderSessionModel();
 if(!$('chat').childNodes.length){const empty=document.createElement('div');empty.id='chatEmpty';empty.className='chat-empty';const avatar=document.createElement('wa-avatar');avatar.className='agent-avatar';const botIcon=createIcon('bot');botIcon.slot='icon';avatar.append(botIcon);avatar.label='AI';const title=document.createElement('h2');const note=document.createElement('p');note.textContent='从一个问题开始。需要项目上下文时，再选择文件夹。';empty.append(avatar,title,note);const starters=document.createElement('div');starters.className='conversation-starters';for(const text of ['解释一段代码','帮我整理一个想法','比较两种实现方案']){const button=createUI('app-button');button.type='button';button.append(document.createTextNode(text),createIcon('arrow-up-right'));button.onclick=()=>{$('prompt').value=text;$('prompt').dispatchEvent(new Event('input'));$('prompt').focus();};starters.append(button);}empty.append(starters);$('chat').append(empty);}

 const name=RUNTIME_CATALOG[selectedEngine]?.name || selectedEngine;$('prompt').setAttribute('aria-label',`输入给 ${name} 的内容`);const info=runtimeVersions[selectedEngine];const modelName=selectedCodexModel || info?.model || runtimeRegistry.runtimes.find(entry=>entry.id===selectedEngine)?.model;
 $('prompt').placeholder=`输入问题，与 ${name} 对话`;
 if($('chatEmpty'))$('chatEmpty').querySelector('h2').textContent=`与 ${name} 对话`;
}
function chatViewData(){return chatViewSnapshot(chatSessions,{activeId:activeChatId,container:$('chat')});}
let pendingChatMerges=[];
const pendingArchives=new Set();

let lastChatSyncNotice='';
function chatSyncNotice(message){const text=String(message).replace(/^Error invoking remote method '[^']+': Error: /,'');if(text!==lastChatSyncNotice){lastChatSyncNotice=text;toast(text,'chat');}}
function persistChatViews(){const views=chatViewData(),owner=chatOwnerID;if(owner){void api.saveChats(views,owner,chatEnvironmentID).then(()=>{if(owner!==chatOwnerID)return;lastChatSyncNotice='';$('chatStorageStatus').textContent='对话已保存到当前账号';}).catch(error=>{if(owner!==chatOwnerID)return;$('chatStorageStatus').textContent='对话保存失败 · 请勿关闭应用';chatSyncNotice(error.message);});}else try{localStorage.setItem('anonymous-chat-views',JSON.stringify(views));}catch{}}
function saveChatView(){const tab=contentTabState.tabs.find(tab=>tab.id===contentTabState.activeId && tab.page==='cc');if(tab)tab.draft=$('prompt').value;const item=chatSessions.find(item=>item.id===activeChatId);if(item)item.nodes=[...$('chat').childNodes];persistChatViews();}
function renderSessionHeader(){if(!chatRenderContainer){void draftPersistence.sync();chatSearch.refresh();approvalCards.render();chatRecovery.refresh();}contextPicker.invalidate();if(!chatRenderContainer)insightPanel.refresh();
 const item=chatSessions.find(item=>item.id===activeChatId);
 $('sessionNetworkMode').value=item?.networkMode || 'proxy';updateChatNetworkIcon('sessionNetworkMode');
 $('sessionTitle').textContent=item?.title || '新会话';
 $('sessionPlatformIcon').replaceChildren(createIcon(runtimeIcon(selectedEngine)));
 $('projectPath').textContent=item?.project || '';$('projectPath').title=item?.project || '';$('projectPath').classList.toggle('hidden',!item?.project);
 $('infoTitle').textContent=item?.title || '新会话';$('infoRuntime').textContent=selectedEngine==='deepseek'?'DeepSeek':selectedEngine==='codex'?'Codex':'Claude Code';
 $('infoModel').textContent=item?.model || selectedCodexModel || runtimeVersions[selectedEngine]?.model || runtimeRegistry.runtimes.find(entry=>entry.id===selectedEngine)?.model || '运行时默认模型';$('infoProject').textContent=item?.project || '未选择文件夹';
 $('infoCreatedAt').textContent=item?.createdAt?displayDate(item.createdAt):'未记录';$('infoSessionId').textContent=activeChatId || '未创建';
}
const sessionOrder=mountSessionOrder({scope:()=>({owner:chatOwnerID,environmentId:chatEnvironmentID}),items:()=>chatSessions,render:()=>renderSessionList(),onError:message=>toast(message,'chat')});
function renderSessionList(){
 $('sessionList').replaceChildren();$('archivedList').replaceChildren();
 for(const item of sessionOrder.sort()){
  const wrapper=document.createElement('div');wrapper.className='session-row-container'+(item.id===activeChatId?' selected':'');const button=createUI('app-button');button.className='session-row'+(item.id===activeChatId?' active':'');button.dataset.sessionId=item.id;button.setAttribute('aria-current',String(item.id===activeChatId));
  const icon=createIcon(runtimeIcon(item.engine));const title=document.createElement('span');title.className='session-title';title.textContent=item.title;const avatar=document.createElement('span');avatar.className='chat-item-avatar';avatar.append(icon);const copy=document.createElement('span');copy.className='chat-item-copy';const detail=document.createElement('span');detail.className='chat-item-detail';const status=document.createElement('span');status.className='chat-item-status '+(item.chatStatus || 'idle');const hasDraft=contentTabState.tabs.some(tab=>tab.page==='cc' && tab.sessionId===item.id && tab.draft?.trim());const hasMessages=(item.nodes || []).some(node=>node.classList?.contains('bubble'));status.textContent=({failed:'发送失败',stopped:'已停止',done:'已完成'})[item.chatStatus] || (item.chatStatus==='running'?'':!hasMessages?(hasDraft?'草稿':'尚未开始'):'');
if(item.chatStatus==='running'){
 status.setAttribute('aria-label','正在输入');
 const spinner=document.createElement('span');spinner.className='chat-typing-spinner';spinner.setAttribute('aria-hidden','true');
 const label=document.createElement('span');label.textContent='正在输入';
 const dots=document.createElement('span');dots.className='chat-typing-dots';dots.setAttribute('aria-hidden','true');
 for(let i=0;i<3;i++){const dot=document.createElement('span');dot.textContent='.';dots.append(dot);}
 status.append(spinner,label,dots);
}detail.append(status);
 const timestamp=item.updatedAt || item.createdAt;
 if(timestamp && Number.isFinite(Date.parse(timestamp))){const time=document.createElement('time');time.className='chat-item-time';time.dateTime=new Date(timestamp).toISOString();time.textContent=displayDate(timestamp); time.title=displayDate(timestamp);detail.append(time);}
 copy.append(title,detail);button.append(avatar,copy);sessionOrder.bind(button,item);
  button.onclick=()=>void action(async()=>{if(activeChatId===item.id && page==='cc')return;const version=++chatRestoreVersion;saveChatView();const value=await api.selectSession(item.id,{deferAuth:true,viewed:true});if(version===chatRestoreVersion)applySession(value,item);});
  const archive=createUI('app-button');archive.className='icon-button session-archive';archive.disabled=pendingArchives.has(item.id);archive.setAttribute('aria-label',item.archived?'取消归档':'归档对话');archive.title=item.archived?'取消归档':'归档对话';archive.append(createIcon(item.archived?'archive-restore':'archive'));archive.onclick=()=>void action(async()=>{if(chatRuns.has(item.id))throw new Error('请先停止此对话的回复');if(pendingArchives.has(item.id))return;const previous=item.archived,owner=chatOwnerID;pendingArchives.add(item.id);item.archived=!previous;renderSessionList();try{await api.archiveSession(item.id,item.archived);}catch(error){if(owner===chatOwnerID){const state=await api.state().catch(()=>null);const actual=state?.aiSessions?.find(session=>session.id===item.id);item.archived=actual?Boolean(actual.archived):previous;renderSessionList();}throw error;}finally{pendingArchives.delete(item.id);if(owner===chatOwnerID)renderSessionList();}});const pin=createUI('app-button');pin.className='icon-button session-pin'+(item.pinned?' pinned':'');pin.setAttribute('aria-label',item.pinned?'取消固定对话':'固定对话');pin.append(createIcon(item.pinned?'pin-off':'pin'));pin.onclick=()=>{item.pinned=!item.pinned;renderSessionList();persistChatViews();};wrapper.append(button,pin,archive);$(item.archived?'archivedList':'sessionList').append(wrapper);
 }
 $('archiveCount').textContent=chatSessions.filter(item=>item.archived).length;renderContentTabs();renderSessionHeader();renderProfileActivity();
}
$('archiveToggle').onclick=()=>{const expanded=$('archiveToggle').getAttribute('aria-expanded')!=='true';$('archiveToggle').setAttribute('aria-expanded',String(expanded));$('archivedList').classList.toggle('hidden',!expanded);$('archiveChevron').src='assets/icons/'+(expanded?'chevron-down':'chevron-right')+'.svg';};
function applySession(value,item){contextPicker.close();chatScroll.save();if(chatRuns.has(activeChatId))chatRuns.get(activeChatId).reply=reply;chatRestoreVersion++;if(item.archived){$('archiveToggle').setAttribute('aria-expanded','true');$('archivedList').classList.remove('hidden');$('archiveChevron').src='assets/icons/chevron-down.svg';}const tab=contentTabFor('cc');contentTabState=openContentTab(contentTabState,{...tab,sessionId:value.id});activeChatId=value.id;selectedEngine=value.engine;selectedCodexModel=value.model;authStates[selectedEngine]=value.auth;busy=chatRuns.has(item.id);reply=chatRuns.get(item.id)?.reply || null;$('chat').replaceChildren(...(item.nodes || []));item.networkMode=value.networkMode || 'proxy';item.project=value.project || '';item.model=value.model;item.reasoningEffort=value.reasoningEffort||null;item.lastViewedAt=value.lastViewedAt;item.createdAt=value.createdAt;item.updatedAt=value.updatedAt;item.archived=Boolean(value.archived);renderChatAvailability();renderSessionHeader();renderRuntime();renderSessionList();switchPage('cc');persistChatViews();chatScroll.restore(value.id);void checkAIAuth();}
let creatingChat=false;
function updateChatNetworkIcon(id='chatNetworkMode'){
 const select=$(id);if(select.localName==='wa-radio-group')return;let icon=select.querySelector(':scope > wa-icon[slot=start]');if(!icon){icon=createIcon('shield-check');icon.slot='start';select.prepend(icon);}
 const mode=select.value || 'proxy';icon.src='assets/icons/'+({direct:'globe',proxy:'shield-check',auto:'network'})[mode]+'.svg';icon.className='chat-mode-'+mode;
}
$('chatNetworkMode').addEventListener('change',()=>updateChatNetworkIcon());
$('sessionNetworkMode').addEventListener('change',()=>void action(async()=>{
 const select=$('sessionNetworkMode'),id=activeChatId;select.disabled=true;
 try{await api.sessionNetwork(id,select.value);}finally{select.value=chatSessions.find(item=>item.id===activeChatId)?.networkMode || 'proxy';updateChatNetworkIcon('sessionNetworkMode');select.disabled=false;}
}));
function updateRuntimeSelectIcon(){
 const select=$('runtimeEngine');let icon=select.querySelector(':scope > wa-icon[slot="start"]');if(!icon){icon=createIcon(runtimeIcon(select.value));icon.slot='start';select.prepend(icon);}icon.src='assets/icons/'+runtimeIcon(select.value)+'.svg';
}
const effortSelect=document.createElement('wa-select');effortSelect.id='sessionEffort';effortSelect.size='s';effortSelect.setAttribute('aria-label','推理强度');$('sessionModel').before(effortSelect);
effortSelect.addEventListener('change',()=>void action(async()=>{const scope={owner:chatOwnerID,environmentId:chatEnvironmentID,chatId:activeChatId};effortSelect.disabled=true;try{const result=await api.sessionEffort({...scope,effort:effortSelect.value||null});const item=chatSessions.find(v=>v.id===scope.chatId);if(item)item.reasoningEffort=result.reasoningEffort;}finally{renderSessionModel();}}));
function renderSessionModel(){
 const select=$('sessionModel'),runtime=runtimeRegistry.runtimes.find(item=>item.id===selectedEngine),models=runtime?.models || [];
 const item=chatSessions.find(v=>v.id===activeChatId),capability=models.find(v=>v.model===(selectedCodexModel||runtime?.model))||models.find(v=>v.isDefault),levels=capability?.supportedReasoningEfforts||[];
 effortSelect.hidden=selectedEngine!=='codex'||!levels.length;effortSelect.disabled=busy||!levels.length;
 const effortSignature=JSON.stringify(levels);if(effortSelect.dataset.levels!==effortSignature){effortSelect.dataset.levels=effortSignature;effortSelect.replaceChildren();const automatic=document.createElement('wa-option');automatic.value='';automatic.textContent='默认推理强度';effortSelect.append(automatic);for(const level of levels){const option=document.createElement('wa-option');option.value=level.reasoningEffort;option.textContent=level.reasoningEffort;option.title=level.description||'';effortSelect.append(option);}}effortSelect.value=item?.reasoningEffort||'';
 const signature=JSON.stringify(models.map(model=>[model.model,model.name]));
 if(select.dataset.models!==signature){select.dataset.models=signature;select.replaceChildren(...models.map(model=>{const option=document.createElement('wa-option');option.value=model.model;option.textContent=model.name || model.model;return option;}));}
 const measure=document.createElement('canvas').getContext('2d');measure.font='12px '+getComputedStyle(select).fontFamily;
 select.style.width=Math.ceil(Math.max(74,...models.map(model=>measure.measureText(model.name || model.model).width))+72)+'px';
 select.value=selectedCodexModel || runtime?.model || '';
 select.disabled=!activeChatId || !models.length;
 select.placeholder=models.length?'选择模型':'暂无可用模型';
}
$('sessionModel').addEventListener('wa-show',event=>{if(event.target===$('sessionModel'))void action(refreshRuntimeRegistry);});
$('sessionModel').addEventListener('change',()=>void action(async()=>{
 const id=activeChatId,select=$('sessionModel'),model=select.value;await select.hide();select.disabled=true;
 try{const result=await api.sessionModel(id,model);const item=chatSessions.find(item=>item.id===id);if(item){item.model=result.model;item.reasoningEffort=null;}if(activeChatId===id){selectedCodexModel=result.model;renderRuntime();renderSessionHeader();}if(busy)toast('模型已切换，将用于下一次回复','chat');}
 finally{renderSessionModel();}
}));
function fillSessionModels(){
 const engine=$('runtimeEngine').value;updateRuntimeSelectIcon();
 const models=engine==='deepseek'?(runtimeVersions.deepseek?.models || runtimeRegistry.runtimes.find(item=>item.id==='deepseek')?.models || []):engine==='codex'?(runtimeVersions.codex?.models || []):[{model:'sonnet',name:'Sonnet'},{model:'opus',name:'Opus'},{model:'haiku',name:'Haiku'}];
 $('codexModelSelect').replaceChildren();
 for(const item of [{model:'local',name:'使用运行时默认模型'},...models]){const option=document.createElement('wa-option');option.value=item.model;option.textContent=item.name;$('codexModelSelect').append(option);}
 const suggested=engine===selectedEngine?selectedCodexModel:engine==='codex'?defaultModel:null;
 if(engine!=='codex' && suggested && !models.some(item=>item.model===suggested)){const option=document.createElement('wa-option');option.value=suggested;option.textContent=suggested;$('codexModelSelect').append(option);}
 $('codexModelSelect').value=models.some(item=>item.model===suggested)?suggested:'local';
}
function renderChatAvailability(){
 const detected=runtimeRegistry.runtimes.some(item=>supportsChat(item.id));
 $('railNewSession').disabled=chatRestoring || !detected;$('createNewSession').disabled=chatRestoring || !detected;
 const add=$('newContentTab');if(add)add.disabled=false;
 $('page-cc').classList.toggle('no-session',!activeChatId);$('chatSetupNotice').classList.toggle('hidden',Boolean(activeChatId));
 $('chatSetupTitle').textContent=chatRestoring?'正在加载对话':detected?'还没有对话':runtimeRegistry.runtimes.length?'当前运行时通过控制台使用':'请先检测运行时';
 $('chatSetupText').textContent=chatRestoring?'正在恢复当前环境的对话记录…':detected?'点击对话列表上方的加号，选择运行时和模型开始对话。':runtimeRegistry.runtimes.length?'在运行时详情中查看使用命令，打开控制台使用。':'前往运行时页面，手动检测本机可用的运行时后再新建对话。';
 $('goToRuntimes').classList.toggle('hidden',chatRestoring || detected);
 $('prompt').disabled=draftPersistence.loading || !activeChatId;
 $('chatProxyTooltip').disabled=chatNetworkReady();if(chatNetworkReady())$('chatProxyTooltip').open=false;
}
$('goToRuntimes').onclick=()=>switchPage('runtime');
async function newChat(){
 if(!runtimeRegistry.runtimes.some(item=>supportsChat(item.id))){toast('请先前往运行时手动检测','runtime');return;}
 assertContentTabAvailable(contentTabFor('cc'));
 $('newSessionDialog').open=false;$('createNewSession').disabled=true;await $('newSessionDialog').updateComplete;if($('newSessionDialog').shadowRoot.querySelector('dialog').open)await new Promise(resolve=>$('newSessionDialog').addEventListener('wa-after-hide',resolve,{once:true}));
 await refreshRuntimeRegistry();await Promise.all([...$('runtimeEngine').querySelectorAll('wa-option')].map(option=>option.updateComplete));await $('runtimeEngine').updateComplete;$('runtimeEngine').value=runtimeRegistry.runtimes.some(item=>item.id===selectedEngine && supportsChat(item.id))?selectedEngine:runtimeRegistry.runtimes.find(item=>supportsChat(item.id))?.id;await $('runtimeEngine').updateComplete;fillSessionModels();await $('codexModelSelect').updateComplete;$('newSessionStatus').textContent='';$('chatNetworkMode').value='proxy';updateChatNetworkIcon();$('newSessionDialog').open=true;bounds();
}
async function createChat(choice){
 chatRestoreVersion++;
 assertContentTabAvailable(contentTabFor('cc'));saveChatView();
 const value=await api.newSession(choice);const item={id:value.id,title:'新会话',engine:value.engine,networkMode:value.networkMode || 'proxy',creationOrder:Math.max(0,...chatSessions.map(item=>item.creationOrder || 0))+1,nodes:[]};chatSessions.unshift(item);applySession(value,item);
}
$('runtimeEngine').onchange=fillSessionModels;
$('createNewSession').onclick=()=>void action(async()=>{
 if(creatingChat)return;creatingChat=true;$('createNewSession').disabled=true;$('newSessionStatus').textContent='正在创建并检测登录态…';
 try{await createChat({networkMode:$('chatNetworkMode').value,engine:$('runtimeEngine').value,model:$('codexModelSelect').value==='local'?null:$('codexModelSelect').value});$('newSessionDialog').open=false;bounds();}
 finally{creatingChat=false;$('createNewSession').disabled=false;$('newSessionStatus').textContent='';}
});
for(const id of ['closeNewSession','cancelNewSession'])$(id).onclick=()=>{if(!creatingChat){$('newSessionDialog').open=false;bounds();}};
$('newSessionDialog').addEventListener('wa-hide',event=>{if(creatingChat)event.preventDefault();});
$('railNewSession').onclick=()=>void action(newChat);
function updateSendButton(){busy=chatRuns.has(activeChatId);$('chat').classList.toggle('reply-in-progress',busy); $('send').replaceChildren(createIcon(busy?'square':'arrow-up'));$('send').setAttribute('aria-label',busy?'停止回复':!chatNetworkReady()||authStates[selectedEngine]?.state!=='signed-in'?'保存待发送':'发送消息');$('send').classList.toggle('stopping',busy); }
$('send').onclick=()=>void action(()=>busy?api.cancel(activeChatId):$('chatForm').requestSubmit());
const chatRecovery=mountChatRecovery({container:$('chatForm'),scope:()=>JSON.stringify([chatOwnerID,chatEnvironmentID,activeChatId]),onRetry:(key,record)=>action(async()=>{if(key!==JSON.stringify([chatOwnerID,chatEnvironmentID,activeChatId])||chatRuns.has(activeChatId))throw Error('请在原对话空闲时重试');await sendChatMessage(record.message);})});
const contextPicker=mountContextPicker({input:$('prompt'),host:$('chatContextPicker'),load:value=>api.chatContext({...value,chatId:activeChatId}),getScope:()=>JSON.stringify([chatOwnerID,dockerEnvironmentState.activeId,activeChatId,selectedEngine,chatSessions.find(s=>s.id===activeChatId)?.project])});
const chatSearch=mountChatSearch({keyboard:false,chat:document.getElementById('chat'),getScope:()=>JSON.stringify([chatOwnerID,chatEnvironmentID,activeChatId])});
const chatSettingsMenu=document.createElement('wa-dropdown');chatSettingsMenu.id='chatSettingsMenu';chatSettingsMenu.placement='bottom-end';
const chatSettingsTrigger=document.createElement('app-button');chatSettingsTrigger.slot='trigger';chatSettingsTrigger.className='icon-button';chatSettingsTrigger.setAttribute('appearance','plain');chatSettingsTrigger.setAttribute('icon-only','');chatSettingsTrigger.setAttribute('aria-label','对话设置');chatSettingsTrigger.title='对话设置';chatSettingsTrigger.append(createIcon('list-settings'));chatSettingsMenu.append(chatSettingsTrigger);
const chatSettingsBody=document.createElement('div');chatSettingsBody.className='chat-settings-menu';
const searchEntry=document.getElementById('chatSearchTrigger');searchEntry.removeAttribute('icon-only');searchEntry.removeAttribute('appearance');searchEntry.className='menu-action chat-settings-search';searchEntry.querySelector('wa-icon').slot='start';searchEntry.append(document.createTextNode('搜索对话'));searchEntry.addEventListener('click',()=>{chatSettingsMenu.open=false;});chatSettingsBody.append(searchEntry);
const networkRow=document.createElement('div');networkRow.className='chat-settings-network';const networkLabel=document.createElement('span');networkLabel.textContent='网络';networkRow.append(networkLabel,document.getElementById('sessionNetworkMode'));chatSettingsBody.append(networkRow);chatSettingsMenu.append(chatSettingsBody);document.getElementById('sessionInfoMenu').after(chatSettingsMenu);

const insightPanel=mountInsightsPanel({page:$('page-cc'),api,scope:()=>({owner:chatOwnerID,environmentId:dockerEnvironmentState.activeId||null,chatId:activeChatId}),updateMarkdown:updateChatMessage,onOpenFullView:({view,scopeKey})=>void action(()=>{
 const tab={id:'insights-'+view,page:'insights',title:view==='changes'?'变更':'产物',insightView:view,insightScope:scopeKey};
 assertContentTabAvailable(tab);saveChatView();contentTabState=openContentTab(contentTabState,tab);switchPage('insights');
}),onExitFullView:()=>{contentTabState.tabs=contentTabState.tabs.filter(tab=>tab.id!==contentTabState.activeId||tab.page!=='insights');switchPage('cc');},onScopeChange:()=>{const wasFull=page==='insights';contentTabState.tabs=contentTabState.tabs.filter(tab=>tab.page!=='insights');if(wasFull)switchPage('cc');else renderContentTabs();}});
$('prompt').addEventListener('input',()=>{const tab=contentTabState.tabs.find(tab=>tab.id===contentTabState.activeId && tab.page==='cc');if(tab)tab.draft=$('prompt').value;renderSessionList();});
$('prompt').addEventListener('keydown',event=>{if(shouldSend(event,preferences,api.platform) && !mountCompositionGuard($('prompt')).isComposing(event)){event.preventDefault();if(!busy && !$('send').disabled)$('chatForm').requestSubmit();}});
$('toggleSidebar').onclick=()=>{if(!sidebarCollapsed){const width=document.querySelector('.proxy-status-line').getBoundingClientRect().width;document.querySelector('.sidebar').style.setProperty('--sidebar-proxy-content-width',width+'px');}sidebarCollapsed=!sidebarCollapsed;document.body.classList.toggle('sidebar-collapsed',sidebarCollapsed);$('toggleSidebar').setAttribute('aria-label',sidebarCollapsed?'展开导航':'收起导航');document.querySelectorAll('.primary-nav-tooltip').forEach(tip=>{tip.disabled=!sidebarCollapsed;if(!sidebarCollapsed)tip.open=false;});try{localStorage.setItem('sidebar-collapsed',String(sidebarCollapsed));}catch{}bounds();};
async function goHistory(offset){const next=navigationIndex+offset;if(next<0 || next>=navigationHistory.length)return;const target=navigationHistory[next];historyRestoring=true;try{if(target.page==='cc' && target.sessionId && target.sessionId!==activeChatId){saveChatView();const item=chatSessions.find(item=>item.id===target.sessionId);if(item){const version=++chatRestoreVersion;const value=await api.selectSession(item.id,{deferAuth:true,viewed:true});if(version===chatRestoreVersion)applySession(value,item);}}else switchPage(target.page);navigationIndex=next;$('appBack').disabled=next<=0;$('appForward').disabled=next>=navigationHistory.length-1;}finally{historyRestoring=false;}}
$('appBack').onclick=()=>void action(()=>goHistory(-1));$('appForward').onclick=()=>void action(()=>goHistory(1));
async function sendChatMessage(message,{clearComposer=false,editBlock=null}={}){
 message=structuredClone(message);
 const text=typeof message==='string'?message:message.text;
 if(!text && !(message.images?.length) && !(message.documents?.length))return;
 contextPicker.close();
 const submittedChatId=activeChatId;
 if(insightPanel.maintaining())throw new Error('当前对话正在压缩上下文，请稍候或停止压缩');
 if(chatRuns.has(submittedChatId))throw new Error('请先停止当前回复');
 const nodes=editBlock?[...$('chat').childNodes]:[];
 const editIndex=editBlock && nodes.includes(editBlock)?chatViewSnapshot([{id:submittedChatId,nodes:nodes.slice(0,nodes.indexOf(editBlock))}])[0].messages.length:-1;
 if(editBlock && editIndex<0)throw new Error('编辑位置已变化');
 const rewind=editBlock?{chatId:submittedChatId,index:editIndex,messages:chatViewData().find(view=>view.id===submittedChatId)?.messages}:undefined;
 chatRecovery.clear();
 const state={message:structuredClone(message),requestId:crypto.randomUUID(),submitting:true,events:[],reply:null};chatRuns.set(submittedChatId,state);insightPanel.clearTurn();busy=true;updateSendButton();
 try{
  state.draftKey=await draftPersistence.prepare(state.requestId,message);
  if(activeChatId!==submittedChatId||!draftPersistence.isCurrent(state.draftKey))throw new Error('对话已变化，消息已保留为待发送');
  if(!chatNetworkReady()||authStates[selectedEngine]?.state!=='signed-in'){
   chatRuns.delete(submittedChatId);busy=chatRuns.has(activeChatId);updateSendButton();if(clearComposer)await draftPersistence.accepted(state.draftKey,message);toast('已保存待发送，连接恢复后请手动恢复到草稿并发送','chat');return;
  }
  await draftPersistence.dispatch(state.draftKey,state.requestId);
  if(activeChatId!==submittedChatId||!draftPersistence.isCurrent(state.draftKey))throw new Error('对话已变化，未发送');
  await api.cc(message,rewind,submittedChatId,state.requestId);
 }
 catch(error){void draftPersistence.settle(state.draftKey,state.requestId,false).catch(()=>{});if(chatRuns.get(submittedChatId)===state)chatRuns.delete(submittedChatId);if(submittedChatId===activeChatId)void insightPanel.refresh(true);const failed=chatSessions.find(item=>item.id===submittedChatId);if(failed)failed.chatStatus='failed';busy=chatRuns.has(activeChatId);renderAuth();renderSessionList();saveChatView();throw error;}
 if(chatRuns.get(submittedChatId)!==state)return;
 withChatView(submittedChatId,()=>{
  if(editBlock){let node=editBlock;while(node){const next=node.nextSibling;node.remove();node=next;}}
  const item=chatSessions.find(item=>item.id===submittedChatId);if(item && item.title==='新会话')item.title=text.slice(0,28);
  bubble('user',text,selectedEngine,false,message.images || [],message.reasoning,new Date().toISOString(),message.documents||[]);
  reply=bubble('assistant','',selectedEngine,true);reasoningView(reply,{kind:selectedEngine==='deepseek'?'thinking':'process',phase:'waiting'},updateChatMessage);
  saveChatView();
 });
 if(activeChatId===submittedChatId)chatScroll.jump();
 if(clearComposer)await draftPersistence.accepted(state.draftKey,message).catch(()=>{});
 state.submitting=false;const events=state.events.splice(0);for(const event of events)dispatchWorkspaceEvent(event);
}
$('chatForm').onsubmit=event=>{event.preventDefault();void action(async()=>{if(deepseekComposer.reading)throw new Error('文档仍在读取，请稍候');const text=$('prompt').value.trim();const message=['deepseek','codex'].includes(selectedEngine)?deepseekComposer.payload(text):text;await sendChatMessage(message,{clearComposer:true});});};

function applyChatMerge(data){if(data.owner!==chatOwnerID)return;
   try{
    const local={sessions:chatSessions.map(({nodes,creationOrder,...item})=>item),views:chatViewData()};
    const merged=mergeChatPayload(data.base,local,data.payload);
    for(const value of merged.sessions || []){
     if((value.environmentId || null)!==dockerEnvironmentState.activeId)continue;
     let item=chatSessions.find(item=>item.id===value.id);
     if(!item){item={...value,nodes:[]};chatSessions.push(item);}else Object.assign(item,value);
     const view=merged.views?.find(view=>view.id===item.id);
     const current=chatViewData().find(view=>view.id===item.id);
     if(view && JSON.stringify(view.messages)!==JSON.stringify(current?.messages)){
      const previous=Array.from($('chat').childNodes);item.nodes=[];
      for(const message of view.messages || []){if(message.role==='assistant' && !message.text?.trim() && !message.reasoning?.text && !message.reasoning?.activities?.length && !Number.isFinite(message.reasoning?.durationMs))continue;const content=bubble(message.role,message.text,item.engine,false,message.images || [],message.reasoning,message.createdAt,message.documents||[]);item.nodes.push(content.parentNode);}
      $('chat').replaceChildren(...(item.id===activeChatId?item.nodes:previous));
     }
     if(view)Object.assign(item,{title:view.title,pinned:view.pinned,chatStatus:view.chatStatus});
    }
    renderSessionList();
   }catch{$('chatStorageStatus').textContent='对话有新的云端更新，本机内容已保留';}

}
function handleWorkspaceEvent(type,data){
  if(type==='connectionRecords' && data.owner===accountState.user?.id && data.environmentId===dockerEnvironmentState.activeId){connectionRecordsVersion++;renderConnectionRecords(data.entries);}
  if(type==='containerPrepareProgress' && setupDockerPreparing){setupDockerProgress=data;renderSetupDocker();}
  if (type === 'account') {renderAccount(data);void action(refreshEnvironments);}
  if(type==='runtimeLoginCallback' && data.owner===accountState.user?.id && data.environmentId===dockerEnvironmentState.activeId){switchPage('console');toast(data.ok?'Codex 已登录成功':'登录未完成，请查看控制台','runtime');void action(()=>refreshEnvironmentConfiguration(false,'codex'));}
  if(type==='containerLoginOutput')$('containerLoginOutput').value=($('containerLoginOutput').value+data).slice(-32000);
  if(type==='containerLoginEnd'){toast(data,'runtime');void action(()=>refreshEnvironmentConfiguration(true));}
  if(type==='chatAccountChanged'){approvalCards.clear();contextPicker.close();chatScroll.clear();gitSettings.invalidate(false);clearReasoningTimers();chatRuns.clear();busy=false;reply=null;pendingChatMerges=[];$('deepseekApiKey').value='';$('runtimeInstallDialog').open=false;void reloadAccountChats();}
  if(type==='chatMerged' && data.owner===chatOwnerID){if(chatRuns.size)pendingChatMerges.push(data);else applyChatMerge(data);}
  if(type==='chatSyncRecovered' && data.owner===chatOwnerID){lastChatSyncNotice='';$('chatStorageStatus').textContent='对话已保存到当前账号';}
  if(type==='chatSyncError' && data.owner===chatOwnerID){$('chatStorageStatus').textContent=data.message;}
  if (type === 'environment') setEnvironment(data);
  if (type === 'network'){setNetwork(data);updateConfigurationActions();}
  if (type === 'requestFailure') activity(`${data.reason} · ${data.target} · ${data.code}`);
  browserToolbar.handleEvent(type,data);
  if(type==='browserLibrary'){browserPreferences=data.settings;addressHistory=data.history||[];}
  if(type==='browserLibraryReset'){addressHistory=[];void browserLibrary.refresh();}
  if(type==='browserLibraryError'||type==='browserAgentBlocked')toast(data.message);
  if (type === 'browserTabs') renderBrowserTabs(data);
  if (type === 'browserCookieSync') browserSettingsUI.renderSync(data);
  if(type==='chatNetworkMode'){const item=chatSessions.find(item=>item.id===data.id);if(item)item.networkMode=data.networkMode;renderSessionList();renderChatAvailability();renderAuth();}
  if (type === 'browserError') { $('browserMessage').textContent = data; toast(data,'browser'); }
  if (type === 'ccStart') {if(selectedEngine!=='deepseek' && reply)reasoningView(reply,{kind:'process',phase:'process'},updateChatMessage);if(data.model){selectedCodexModel=data.model;const current=chatSessions.find(item=>item.id===activeChatId);if(current)current.model=data.model;renderRuntime();renderSessionHeader();}const item=chatSessions.find(item=>item.id===activeChatId);if(item){item.updatedAt=data.updatedAt || new Date().toISOString();item.chatStatus='running';renderSessionList();} busy = true;deepseekComposer.render(); $('send').disabled = false;updateSendButton(); $('ccState').textContent = 'CC 正在处理…'; }
  if(type==='ccActivity'){approvalCards.activity(data);const follow=chatScroll.canFollow($('chat'));reply ||= bubble('assistant','',selectedEngine,true);const state=reply.parentNode.messageReasoning;const activities=mergeRuntimeActivity(state?.activities || [],data);reasoningView(reply,{kind:'process',phase:'process',activities},updateChatMessage);if(follow)chatScroll.follow($('chat'));}
  if(type==='ccProcess'){reply ||= bubble('assistant','',selectedEngine,true);const state=reply.parentNode.messageReasoning;reasoningView(reply,{kind:'process',phase:'process',text:(state?.text?state.text+'\n\n':'')+data.text,startedAt:state?.startedAt},updateChatMessage);}
  if(type==='ccUsage'){const item=chatSessions.find(item=>item.id===data.sessionId);if(item){(item.tokenUsage ||= []).push(data.entry);renderProfileActivity();}}
  if(type==='ccNotice'){bubble('error',data);}
  if(type==='ccReasoning'){
    reply ||= bubble('assistant','',selectedEngine,true);
    const previous=reply.parentNode.querySelector('.deepseek-reasoning')?.lastChild;
    const follow=(!previous || previous.scrollHeight-previous.scrollTop-previous.clientHeight<40) && chatScroll.canFollow($('chat'));
    const state=reply.parentNode.messageReasoning;
    const details=reasoningView(reply,{text:(state?.text || '')+data,startedAt:state?.startedAt},updateChatMessage),body=details.lastChild;
    if(follow)body.scrollTop=body.scrollHeight;
    if(follow && details.open)chatScroll.follow($('chat'));
  }
  if (type === 'ccText') { reply ||= bubble('assistant', '');if(reply.parentNode.messageReasoning?.kind!=='process')finishReasoning(reply,updateChatMessage,'answering'); reply.classList.remove('reply-loading');reply.removeAttribute('role');reply.removeAttribute('aria-label');updateChatMessage(reply,(reply.dataset.rawText || '')+data); chatScroll.follow($('chat')); }
  if (type === 'ccTool' && !['userMessage','user_message','agentMessage','agent_message'].includes(data.name)) { const el = document.createElement('div'); el.className = 'tool-note'; el.textContent = ({WebSearch:'网页搜索',webSearch:'网页搜索',WebFetch:'读取网页',web_search:'网页搜索'})[data.name] || `工具：${data.name}`; $('chat').append(el); }
  if (type === 'ccError') {const status=data?.status==='stopped'?'stopped':'failed';finishReasoning(reply,updateChatMessage,status);if(reply?.classList.contains('reply-loading')){if(reply.parentNode.messageReasoning){reply.classList.remove('reply-loading');reply.replaceChildren();reply.removeAttribute('role');reply.removeAttribute('aria-label');}else{reply.parentNode.remove();reply=null;}}const item=chatSessions.find(item=>item.id===activeChatId);if(item)item.chatStatus=status;renderSessionList();bubble('error', typeof data==='string'?data:data.message);}
  if (type === 'ccEnd') {finishReasoning(reply,updateChatMessage,data?.status || 'completed');if(reply?.classList.contains('reply-loading')){if(reply.parentNode.messageReasoning){reply.classList.remove('reply-loading');reply.replaceChildren();reply.removeAttribute('role');reply.removeAttribute('aria-label');}else{reply.parentNode.remove();reply=null;}}const item=chatSessions.find(item=>item.id===activeChatId);if(item && !['failed','stopped'].includes(item.chatStatus))item.chatStatus=data?.status==='stopped'?'stopped':'done';renderSessionList();chatRuns.delete(activeChatId);busy = false;deepseekComposer.render(); $('send').disabled = draftPersistence.loading || !activeChatId; updateSendButton(); $('ccState').textContent = '请求已结束'; approvals = []; renderApproval(); reply = null; saveChatView();if(!chatRuns.size){const merges=pendingChatMerges;pendingChatMerges=[];for(const merged of merges)applyChatMerge(merged);}saveChatView(); }
  if (type === 'ccApproval') approvalCards.update(data);
  if (type === 'ccApprovalDone') approvalCards.update(data);
}
// Runtime events carry their conversation and request identity. Updating a
// background transcript is synchronous and never changes the user's selection.
function withChatView(id,callback,{refresh=true}={}){
 const target=chatSessions.find(item=>item.id===id);if(!target)return;
 const view={id:activeChatId,engine:selectedEngine,model:selectedCodexModel,reply};
 const current=chatSessions.find(item=>item.id===view.id),background=id!==view.id;
 if(background){
  if(current)current.nodes=[...$('chat').childNodes];
  chatRenderContainer=document.createElement('div');chatRenderContainer.append(...(target.nodes || []));
  activeChatId=id;selectedEngine=target.engine;selectedCodexModel=target.model;
 }
 busy=chatRuns.has(id);reply=chatRuns.get(id)?.reply || null;
 try{return callback();}finally{
  target.nodes=[...$('chat').childNodes];if(chatRuns.has(id))chatRuns.get(id).reply=reply;
  if(background){chatRenderContainer=null;activeChatId=view.id;selectedEngine=view.engine;selectedCodexModel=view.model;approvalCards.render();}
  busy=chatRuns.has(activeChatId);reply=chatRuns.get(activeChatId)?.reply || null;
  if(refresh){renderSessionList();renderChatAvailability();renderSessionHeader();renderRuntime();updateSendButton();}
 }
}
function dispatchWorkspaceEvent(event){
 const {type,data,chatId,requestId,owner,environmentId}=event;
 if(!type.startsWith('cc')){handleWorkspaceEvent(type,data);return;}
 if(owner!==chatOwnerID || environmentId!==dockerEnvironmentState.activeId)return;
 const state=chatRuns.get(chatId);if(!state || state.requestId!==requestId)return;
 if(state.submitting){state.events.push(event);return;}
 if(type==='ccError'){state.failed=true;if(data?.recovery)chatRecovery.show(data.recovery,JSON.stringify([owner,environmentId,chatId]),{message:state.message});}
 if(type==='ccEnd')void draftPersistence.settle(state.draftKey,state.requestId,!state.failed&&data?.status!=='stopped').catch(()=>{});
 withChatView(chatId,()=>handleWorkspaceEvent(type,data),{refresh:['ccStart','ccEnd','ccError'].includes(type)});
 if(chatId===activeChatId && ['ccStart','ccActivity','ccUsage','ccEnd'].includes(type))void insightPanel.refresh(true);
}
api.onEvent(dispatchWorkspaceEvent);
const popoutController=mountChatPopoutController({api,scope:()=>({owner:chatOwnerID,environmentId:chatEnvironmentID,chatId:activeChatId}),list:()=>chatSessions,activeDraft:()=>deepseekComposer.payload($('prompt').value),setActiveDraft:async payload=>{$('prompt').value=payload.text;deepseekComposer.restore(payload);await draftPersistence.capture();},messages:id=>chatViewData().find(v=>v.id===id)?.messages||[],running:id=>chatRuns.has(id),stop:id=>api.cancel(id),focus:async id=>{const item=chatSessions.find(v=>v.id===id);if(!item)return;saveChatView();applySession(await api.selectSession(id,{deferAuth:true,viewed:true}),item);},report:error=>toast(error.message,'chat'),send:async(scope,payload,store)=>{
 if(scope.chatId===activeChatId){await sendChatMessage(['deepseek','codex'].includes(selectedEngine)?payload:payload.text,{clearComposer:true});return;}
 const item=chatSessions.find(v=>v.id===scope.chatId);if(!item)throw Error('对话不存在');
 const requestId=crypto.randomUUID(),key=draftScopeKey(scope),message=['deepseek','codex'].includes(item.engine)?payload:payload.text;
 const state={message:structuredClone(message),requestId,submitting:true,events:[],reply:null,draftKey:key};chatRuns.set(item.id,state);
 try{await store.prepare(key,requestId,message);if(scope.owner!==chatOwnerID||scope.environmentId!==chatEnvironmentID)throw Error('对话环境已变化');await store.dispatch(key,requestId);if(scope.owner!==chatOwnerID||scope.environmentId!==chatEnvironmentID)throw Error('对话环境已变化，未发送');await api.cc(message,null,item.id,requestId);
  withChatView(item.id,()=>{bubble('user',payload.text,item.engine,false,payload.images||[],null,new Date().toISOString(),payload.documents||[]);reply=bubble('assistant','',item.engine,true);reasoningView(reply,{kind:item.engine==='deepseek'?'thinking':'process',phase:'waiting'},updateChatMessage);saveChatView();});
  const record=await store.read(key);if(JSON.stringify(record.draft)===JSON.stringify(payload))await store.save(key,{text:'',images:[],documents:[],thinking:payload.thinking});
  state.submitting=false;for(const event of state.events.splice(0))dispatchWorkspaceEvent(event);
 }catch(error){chatRuns.delete(item.id);throw error;}
}});
const popoutButton=document.createElement('app-button');popoutButton.id='openChatWindow';popoutButton.className='menu-action chat-settings-search';popoutButton.setAttribute('aria-label','独立窗口');popoutButton.title='独立窗口';popoutButton.append(createIcon('external-link','start'),document.createTextNode('独立窗口'));popoutButton.querySelector('wa-icon').slot='start';networkRow.before(popoutButton);popoutButton.onclick=()=>void action(()=>popoutController.open());

let environmentConfigBusy=false;
function updateConfigurationActions(){
 for(const button of document.querySelectorAll('[data-runtime-login]')){button.disabled=environmentConfigBusy || network.state!=='ready';button.title=network.state==='ready'?'登录当前容器的运行时':'请先连接当前环境的代理';}
 if(runtimeDetailEntry && !$('runtimeDetailPage').classList.contains('hidden'))updateRuntimeConfigureState(runtimeDetailEntry);
 $('openRuntimeInstall').disabled=environmentConfigBusy;
 const added=runtimeRegistry.runtimes.some(item=>item.id===runtimeInstallChoice);
 $('runtimeInstallConfirmHint').dataset.added=String(added);$('runtimeInstallConfirmHint').setAttribute('aria-label',added?'当前环境已添加此运行时，无需重复添加':'添加运行时');
 $('runtimeInstallConfirm').disabled=added || environmentConfigBusy || !dockerEnvironmentState.activeId || Boolean(dockerEnvironmentState.environments.find(item=>item.id===dockerEnvironmentState.activeId)?.external);
}
function runtimeAccess(entry){
 const method=entry.auth?.method || '';const api=entry.id==='deepseek' || /api[ _-]?key|api_key/i.test(method);const subscription=/oauth|claude|chatgpt|subscription/i.test(method);
 return {kind:api?'api-key':'account',icon:entry.auth?.state==='signed-in'?(api?'key-round':'check'):entry.auth?.state==='signed-out'?(api?'key-round':'user'):'history',label:api?'API Key':subscription || entry.auth?.state==='signed-out' && supportsChat(entry.id)?'订阅登录':'待检测',status:api?(entry.auth?.state==='signed-in'?'已配置':entry.auth?.state==='signed-out'?'未配置':'待检测'):(entry.auth?.state==='signed-in'?'已登录':entry.auth?.state==='signed-out'?'未登录':'待检测')};
}
let runtimeRefreshPending=false,runtimePageScope=null,runtimePageUpdatedAt=0;
async function refreshEnvironmentConfiguration(detect=false,refreshEngine=null,{navigation=false}={}){
 const scope=JSON.stringify([accountState.user?.id || null,dockerEnvironmentState.activeId]);
 const cached=runtimePageScope===scope;
 if(!cached){$('configuredRuntimeList').replaceChildren();closeRuntimeDetails();}
 if(navigation && cached && Date.now()-runtimePageUpdatedAt<60000)return;
 if(detect || refreshEngine)environmentPageDirty=true;
 if(environmentConfigBusy){runtimeRefreshPending=true;return;}const owner=accountState.user?.id,id=dockerEnvironmentState.activeId;environmentConfigBusy=true;
 const management=document.querySelector('#page-runtime>.runtime-management');management.classList.toggle('is-loading',!cached);management.setAttribute('aria-busy','true');$('runtimeLoadingText').textContent=detect?'正在检测运行时…':'正在加载运行时…';
 
 try{
 const registry=await refreshRuntimeRegistry(detect,refreshEngine);if(owner!==accountState.user?.id || id!==dockerEnvironmentState.activeId)return;
 renderRuntimeTable($('configuredRuntimeList'),registry.runtimes,{actions:Boolean(id)});
 runtimePageScope=scope;runtimePageUpdatedAt=Date.now();
 $('configuredRuntimeStatus').textContent=registry.runtimes.length?'':registry.checkedAt?'暂无运行时':'尚未检测运行时';
 $('runtimeEmptyState').classList.toggle('hidden',Boolean(registry.runtimes.length));
 if(runtimeDetailEntry && runtimeDetailOwner===owner && runtimeDetailEnvironment===id && !$('runtimeDetailPage').classList.contains('hidden')){const entry=registry.runtimes.find(item=>item.id===runtimeDetailEntry.id);if(entry)openRuntimeDetails(entry);else closeRuntimeDetails();}
 }catch(error){$('configuredRuntimeStatus').textContent='运行时加载失败，请重试。';if(!$('configuredRuntimeList').childElementCount)$('runtimeEmptyState').classList.remove('hidden');throw error;
 }finally{management.classList.remove('is-loading');management.setAttribute('aria-busy','false');environmentConfigBusy=false;updateConfigurationActions();if(runtimeRefreshPending){runtimeRefreshPending=false;void action(()=>refreshEnvironmentConfiguration());}}
}
let runtimeDetailEntry=null,runtimeDetailEnvironment=null,runtimeDetailOwner=null,runtimeRemoval=null,runtimeRemoving=false;
function runtimeVersion(entry){return entry.id==='deepseek'?'—':entry.version || '—';}
function supportedRuntimeModels(entry){
 const catalog=RUNTIME_CATALOG[entry.id]?.models || [];
 const models=Array.isArray(entry.models) && entry.models.length?entry.models:catalog;
 return models.map(item=>{
  const id=typeof item==='string'?item:item.model;
  const fallback=catalog.find(model=>model.model===id);
  return fallback && (typeof item==='string' || !item.name || item.name===id)?{...(typeof item==='string'?{model:id}:item),name:fallback.name}:item;
 });
}
function createRuntimeModelsCell(entry){
 const cell=document.createElement('span');cell.className='runtime-models-cell';
 const models=supportedRuntimeModels(entry);
 const labels=models.map(item=>typeof item==='string'?item:item.name || item.displayName || item.model).filter(Boolean);
 cell.textContent=labels.length?labels.join('、'):entry.modelsError || '暂无模型数据';cell.title=labels.join('、');return cell;
}
function renderSupportedModels(target,models,empty='暂无模型数据'){
 target.replaceChildren();for(const item of models){const tag=document.createElement('span');tag.className='runtime-model-tag';tag.textContent=item.name || item.model;tag.title=item.model || item.name;target.append(tag);}if(!models.length){const hint=document.createElement('span');hint.className='muted';hint.textContent=empty;target.append(hint);}
}
function renderRuntimeTable(target,entries,{columns=[{key:'name',label:'运行时',width:'145px'},{key:'version',label:'版本',width:'175px'},{key:'models',label:'模型'},{key:'method',label:'接入方式',width:'96px'},{key:'auth',label:'认证状态',width:'108px'},{key:'account',label:'登录账号',width:'110px'},{key:'added',label:'添加时间',width:'170px'}],actions=true,onOpen=openRuntimeDetails}={}){
 const rendered=entries.map(entry=>{
  const title=document.createElement('strong'),version=document.createElement('span');title.append(createIcon(runtimeIcon(entry.id)),document.createTextNode(entry.name));version.textContent=runtimeVersion(entry);const models=createRuntimeModelsCell(entry);
  const access=runtimeAccess(entry),method=document.createElement('span');method.textContent=access.label;const auth=document.createElement('span'),authBadge=document.createElement('span');authBadge.className='runtime-status-tag';authBadge.dataset.state=entry.auth?.state || 'unknown';authBadge.dataset.kind=access.kind;authBadge.append(createIcon(access.icon),document.createTextNode(access.status));auth.append(authBadge);const added=document.createElement('span');const addedDate=entry.addedAt?new Date(entry.addedAt):null;added.textContent=addedDate && !Number.isNaN(addedDate.getTime())?addedDate.toLocaleString('zh-CN',{hour12:false}):'—';added.title=added.textContent;const loginAccount=document.createElement('span');loginAccount.className='runtime-login-account';loginAccount.textContent=entry.auth?.state==='signed-in'?(entry.auth.accountName?.trim() || '—'):'—';loginAccount.title=loginAccount.textContent;
  if(entry.auth?.state==='signed-in' && entry.auth.accountName?.trim()){
   const accountLabel=document.createElement('span');accountLabel.className='runtime-account-name';accountLabel.textContent=loginAccount.textContent;
   const avatar=createUI('wa-avatar');avatar.className='runtime-account-avatar';setAccountAvatar(avatar,entry.auth.avatarUrl,runtimeAccountAvatar(entry));avatar.label=(entry.auth.accountName || '当前登录账号')+'的头像';
   loginAccount.replaceChildren(avatar,accountLabel);
  }
  return {entry,name:title,version,models,method,auth,account:loginAccount,added};
 });
 renderAppTable(target,{label:'运行时',columns:columns.map(column=>({...column,render:item=>item[column.key]})),rows:rendered,minWidth:columns.length===3?560:1060,onActivate:item=>onOpen(item.entry),rowLabel:item=>'查看 '+item.entry.name+' 详情',actions:actions?item=>{const entry=item.entry;
 const menu=createUI('wa-dropdown');menu.className='runtime-row-menu';menu.placement='bottom-end';
  const trigger=createUI('app-button');trigger.slot='trigger';trigger.size='s';trigger.className='icon-button';trigger.setAttribute('aria-label',entry.name+' 更多操作');trigger.setAttribute('appearance','plain');trigger.append(createIcon('ellipsis'));
  const remove=createUI('wa-dropdown-item');remove.variant='danger';remove.textContent=entry.id==='deepseek'?'删除':'卸载';remove.append(createIcon('trash-2'));remove.lastChild.slot='icon';
  remove.onclick=()=>{menu.open=false;requestRuntimeRemoval(entry);};menu.append(trigger,remove);menu.addEventListener('click',event=>event.stopPropagation());menu.addEventListener('keydown',event=>event.stopPropagation());return menu;

 }:undefined});
}
function openRuntimeDetails(entry){
 runtimeDetailEntry=entry;runtimeDetailEnvironment=dockerEnvironmentState.activeId;runtimeDetailOwner=accountState.user?.id;
 const content=$('runtimeDetailContent');content.replaceChildren();
 const access=runtimeAccess(entry),authLabel=access.status;
 const hero=$('runtimeDetailHero');hero.replaceChildren();const name=document.createElement('h1');name.textContent=entry.name;const badge=document.createElement('span');badge.className='runtime-auth-badge';badge.dataset.ready=String(entry.auth?.state==='signed-in');badge.dataset.kind=access.kind;badge.append(createIcon(access.icon),document.createTextNode(authLabel));hero.append(createIcon(runtimeIcon(entry.id)),name,badge);
 const environment=dockerEnvironmentState.environments.find(item=>item.id===dockerEnvironmentState.activeId)?.name || '本机环境';$('runtimeDetailBreadcrumb').textContent=entry.name;
 const summary=$('runtimeDetailSummary');summary.replaceChildren();for(const [label,value] of [['登录账号',entry.auth?.state==='signed-in'?(entry.auth.accountName?.trim() || '—'):'未登录'],['执行环境',environment],['运行时',entry.version]]){const cell=document.createElement('div'),term=document.createElement('span'),valueNode=document.createElement('strong');term.textContent=label;valueNode.className='runtime-summary-value';
  if(label==='登录账号' && entry.auth?.state==='signed-in' && entry.auth.accountName?.trim()){const avatar=createUI('wa-avatar');avatar.className='runtime-owner-avatar';setAccountAvatar(avatar,entry.auth.avatarUrl,runtimeAccountAvatar(entry));avatar.label=value+'的头像';valueNode.append(avatar);}
  if(label==='执行环境'){const active=dockerEnvironmentState.environments.find(item=>item.id===dockerEnvironmentState.activeId);valueNode.append(createIcon(environmentIcon(active?.icon || dockerEnvironmentState.localIcon,active?'boxes':'monitor')));}
  valueNode.append(document.createTextNode(value));cell.append(term,valueNode);summary.append(cell);}
 const chats=chatSessions.filter(item=>item.engine===entry.id).sort((a,b)=>(Date.parse(b.updatedAt || b.createdAt)||0)-(Date.parse(a.updatedAt || a.createdAt)||0)).slice(0,5);$('runtimeDetailChatCount').textContent=chats.length+' 个对话';$('runtimeDetailChats').replaceChildren();if(!chats.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='还没有对话关联到这个运行时。';const icon=createIcon('messages-square');const state=document.createElement('div');state.className='runtime-related-empty';state.append(icon,empty);$('runtimeDetailChats').append(state);}else for(const chat of chats){const row=document.createElement('div');row.className='runtime-related-row';const copy=document.createElement('div');copy.className='runtime-related-copy';const title=document.createElement('strong');title.textContent=chat.title || '新会话';title.title=title.textContent;const usage=document.createElement('small');const entries=(chat.tokenUsage || []).filter(item=>Number.isSafeInteger(item.totalTokens) && item.totalTokens>=0);usage.textContent=entries.length?new Intl.NumberFormat(uiLocale()).format(entries.reduce((sum,item)=>sum+item.totalTokens,0))+' Token':'暂无 Token 数据';copy.append(title,usage);row.append(createIcon('messages-square'),copy);$('runtimeDetailChats').append(row);}
 $('runtimeDetailRemoveLabel').textContent=entry.id==='deepseek'?'删除运行时':'卸载运行时';$('runtimeDetailRemove').disabled=!dockerEnvironmentState.activeId || environmentConfigBusy;

 const facts=document.createElement('dl');facts.className='info-card runtime-detail-facts';
 for(const [label,value] of [['接入方式',access.label],['运行时类型',entry.id==='deepseek'?'API':'CLI'],['添加时间',entry.addedAt?new Date(entry.addedAt).toLocaleString('zh-CN',{hour12:false}):'—'],...(entry.description?[['描述',entry.description]]:[])]){const field=document.createElement('div');field.className='runtime-detail-field';const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=value;if(label==='描述')field.classList.add('runtime-detail-field-wide');field.append(term,description);facts.append(field);}content.append(facts);
 if(supportsChat(entry.id)){const section=document.createElement('section');section.className='runtime-supported-section';const heading=document.createElement('h3');heading.textContent='支持的模型';const list=document.createElement('div');list.className='runtime-supported-models';renderSupportedModels(list,supportedRuntimeModels(entry),entry.auth?.state==='signed-in'?'暂无模型数据':'登录后获取可用模型');section.append(heading,list);content.append(section);}
 const local=!dockerEnvironmentState.activeId;
 $('runtimeDetailConfigure').querySelector('wa-icon').setAttribute('src','assets/icons/'+(!supportsChat(entry.id)?'terminal':entry.id==='deepseek'?'settings':entry.auth?.state==='signed-in'?'log-out':'log-in')+'.svg');
 $('runtimeDetailConfigureLabel').textContent=!supportsChat(entry.id)?'打开控制台':entry.id==='deepseek'?'配置 API Key':entry.auth?.state==='signed-in'?'退出登录':'登录 '+entry.name;
 $('runtimeDetailConfigure').classList.toggle('hidden',local || (access.label==='API Key' && entry.id!=='deepseek'));
 updateRuntimeConfigureState(entry);
 $('runtimeDetailHint').textContent=local?'使用本机 CLI 管理登录信息。':'';
 if(access.label==='API Key')$('runtimeDetailHint').textContent='';
 if(!supportsChat(entry.id))$('runtimeDetailHint').textContent=(local?'在本机终端运行：':'在当前环境控制台运行：')+RUNTIME_CATALOG[entry.id].usage+'。';
 $('runtimeDetailHint').classList.toggle('hidden',!$('runtimeDetailHint').textContent);
 $('runtimeDetailPage').classList.remove('hidden');document.querySelector('#page-runtime>.runtime-toolbar').classList.add('hidden');document.querySelector('#page-runtime>.runtime-management').classList.add('hidden');
}
function updateRuntimeConfigureState(entry){
 const needsProxy=supportsChat(entry.id) && entry.id!=='deepseek' && entry.auth?.state!=='signed-in' && network.state!=='ready';
 $('runtimeDetailConfigure').disabled=environmentConfigBusy || needsProxy;
 $('runtimeDetailConfigureTooltip').disabled=!needsProxy;
 if(!needsProxy)$('runtimeDetailConfigureTooltip').open=false;
}
function closeRuntimeDetails(){ $('runtimeDetailPage').classList.add('hidden');document.querySelector('#page-runtime>.runtime-toolbar').classList.remove('hidden');document.querySelector('#page-runtime>.runtime-management').classList.remove('hidden');}
$('runtimeDetailClose').onclick=closeRuntimeDetails;
$('runtimeDetailRemove').onclick=()=>{if(runtimeDetailEntry && runtimeDetailEnvironment===dockerEnvironmentState.activeId && runtimeDetailOwner===accountState.user?.id)requestRuntimeRemoval(runtimeDetailEntry);};
$('runtimeDetailConfigure').onclick=()=>void action(async()=>{
 const entry=runtimeDetailEntry;if(!entry || runtimeDetailEnvironment!==dockerEnvironmentState.activeId || runtimeDetailOwner!==accountState.user?.id)return;
 if(!supportsChat(entry.id)){switchPage('console');return;}
 if(entry.id==='deepseek'){openRuntimeInstall('deepseek');return;}
 if(entry.auth?.state==='signed-in'){
  const owner=runtimeDetailOwner,environmentId=runtimeDetailEnvironment;$('runtimeDetailConfigure').disabled=true;
  try{await api.dockerEnvironments('logout',{engine:entry.id,owner,environmentId});if(owner===accountState.user?.id && environmentId===dockerEnvironmentState.activeId){consoleView.authChanged(entry.name+' 已退出登录。');await refreshEnvironmentConfiguration();toast(entry.name+' 已退出登录','runtime');}}
  finally{updateConfigurationActions();}
  return;
 }
 switchPage('console',{connectConsole:false});await consoleView.login(entry.id);
});
function requestRuntimeRemoval(entry){
 runtimeRemoval={entry,environmentId:dockerEnvironmentState.activeId,owner:accountState.user?.id};
 const verb=entry.id==='deepseek'?'删除':'卸载';$('runtimeRemoveDialog').label=verb+'运行时';$('runtimeRemoveConfirmLabel').textContent=verb;
 $('runtimeRemoveMessage').textContent=entry.id==='deepseek'?`删除“${entry.name}”在当前环境中保存的 API Key 接入配置？对话记录会保留。`:`卸载当前环境中的“${entry.name}”CLI？登录信息和对话记录会保留。`;
 $('runtimeRemoveError').textContent='';$('runtimeRemoveDialog').open=true;
}
$('runtimeRemoveCancel').onclick=()=>{if(!runtimeRemoving)$('runtimeRemoveDialog').open=false;};
$('runtimeRemoveDialog').addEventListener('wa-hide',event=>{if(runtimeRemoving)event.preventDefault();});
$('runtimeRemoveConfirm').onclick=()=>void action(async()=>{
 if(runtimeRemoving || !runtimeRemoval)return;const target=runtimeRemoval;
 if(target.environmentId!==dockerEnvironmentState.activeId || target.owner!==accountState.user?.id){$('runtimeRemoveDialog').open=false;return;}
 runtimeRemoving=true;environmentConfigBusy=true;$('runtimeRemoveConfirm').loading=true;$('runtimeRemoveCancel').disabled=true;updateConfigurationActions();
 try{
  await api.dockerEnvironments('removeRuntime',{engine:target.entry.id,environmentId:target.environmentId});
  runtimeRemoving=false;$('runtimeRemoveDialog').open=false;closeRuntimeDetails();
  if(target.environmentId===dockerEnvironmentState.activeId && target.owner===accountState.user?.id){environmentConfigBusy=false;await refreshEnvironmentConfiguration();environmentPageDirty=true;toast(target.entry.id==='deepseek'?'运行时已删除':'运行时已卸载','runtime');}
 }catch(error){$('runtimeRemoveError').textContent=error.message;}
 finally{runtimeRemoving=false;environmentConfigBusy=false;$('runtimeRemoveConfirm').loading=false;$('runtimeRemoveCancel').disabled=false;updateConfigurationActions();}
});
let runtimeInstallChoice='cc';
function setRuntimeInstallLoading(busy,engine=runtimeInstallChoice){const dialog=$('runtimeInstallDialog');dialog.classList.toggle('is-installing',busy);dialog.querySelector('.runtime-add-body').setAttribute('aria-busy',String(busy));$('runtimeInstallLoading').classList.toggle('hidden',!busy);$('runtimeInstallLoadingText').textContent=engine==='deepseek'?'正在校验并接入 DeepSeek…':'正在安装 '+RUNTIME_CATALOG[engine].name+'…';}

function setRuntimeInstallStep(step){
 $('runtimeInstallStep').textContent='第 '+step+' / 2 步';
 $('runtimeSelectStep').classList.toggle('hidden',step!==1);$('runtimeConfigureStep').classList.toggle('hidden',step!==2);
 $('runtimeInstallBack').classList.toggle('hidden',step!==2);$('runtimeInstallConfirm').classList.toggle('hidden',step!==2);
}
function setRuntimeDescriptionExpanded(expanded){
 $('runtimeDescriptionToggle').setAttribute('aria-expanded',String(expanded));$('runtimeDescription').classList.toggle('hidden',!expanded);$('runtimeDescriptionChevron').src='assets/icons/'+(expanded?'chevron-down':'chevron-right')+'.svg';
}
$('runtimeDescriptionToggle').onclick=()=>setRuntimeDescriptionExpanded($('runtimeDescriptionToggle').getAttribute('aria-expanded')!=='true');
function renderRuntimeAddedBadges(){
 for(const button of document.querySelectorAll('[data-runtime-choice]')){
  button.querySelector('.runtime-added-badge')?.remove();
  if(runtimeRegistry.runtimes.some(item=>item.id===button.dataset.runtimeChoice)){
   const badge=document.createElement('span');badge.className='runtime-added-badge';badge.textContent='已添加';button.append(badge);
  }
 }
}
function openRuntimeInstall(engine){
 renderRuntimeAddedBadges();
 setRuntimeInstallLoading(false);
 setRuntimeDescriptionExpanded(false);
 $('deepseekApiKey').value='';$('runtimeDescription').value='';runtimeInstallChoice=engine || 'cc';
 if(engine){selectRuntimeInstall(engine);}else setRuntimeInstallStep(1);
 $('runtimeInstallDialog').open=true;
}
function selectRuntimeInstall(engine){
 runtimeInstallChoice=engine;const item=runtimeRegistry.runtimes.find(item=>item.id===engine);
 const name=RUNTIME_CATALOG[engine].name;
 $('runtimeDisplayName').value=item?.name || name;$('runtimeDescription').value=item?.description || '';
 renderSupportedModels($('runtimeSupportedModelList'),supportedRuntimeModels(item || {id:engine}),'暂无模型数据');
 $('runtimeSelectedBase').replaceChildren(createIcon(runtimeIcon(engine)),document.createTextNode(name));if(item){const badge=document.createElement('span');badge.className='runtime-added-badge';badge.textContent='已添加';$('runtimeSelectedBase').append(badge);}
 $('runtimeCommandLabel').textContent=engine==='deepseek'?'接入地址':'安装命令';
 $('runtimeDefaultCommand').textContent=engine==='deepseek'?'https://api.deepseek.com':RUNTIME_INSTALL_COMMANDS[engine];
 setRuntimeInstallStep(2);describeRuntimeInstall();
}
function describeRuntimeInstall(){
 const model=runtimeInstallChoice;$('runtimeSupportedModels').classList.remove('hidden');$('deepseekApiKey').classList.toggle('hidden',model!=='deepseek');
 const item=dockerEnvironmentState.environments.find(item=>item.id===dockerEnvironmentState.activeId);
 $('runtimeInstallStatus').textContent=!dockerEnvironmentState.activeId?'当前为本机环境，请先切换到容器环境。':item?.external?'请在原容器中安装工具，完成后重新检测。':'';
 updateConfigurationActions();
}
$('openRuntimeInstall').onclick=()=>openRuntimeInstall();
for(const [id,item] of Object.entries(RUNTIME_CATALOG)){if(document.querySelector('[data-runtime-choice="'+id+'"]'))continue;const button=createUI('app-button');button.dataset.runtimeChoice=id;button.append(createIcon(item.icon),document.createTextNode(item.name));document.querySelector('.runtime-choice-grid').append(button);}
for(const button of document.querySelectorAll('[data-runtime-choice]'))button.onclick=()=>selectRuntimeInstall(button.dataset.runtimeChoice);
$('runtimeInstallBack').onclick=()=>{if(!environmentConfigBusy)setRuntimeInstallStep(1);};
$('runtimeInstallClose').onclick=()=>{if(!environmentConfigBusy)$('runtimeInstallDialog').open=false;};
$('runtimeInstallCancel').onclick=()=>{if(!environmentConfigBusy)$('runtimeInstallDialog').open=false;};
// Refreshing the list must not cancel the dialog's asynchronous close after installation.
$('runtimeInstallDialog').addEventListener('wa-hide',event=>{if($('runtimeInstallConfirm').loading)event.preventDefault();else $('deepseekApiKey').value='';});
$('runtimeInstallConfirm').onclick=()=>void action(async()=>{
 if(environmentConfigBusy)return;
 const engine=runtimeInstallChoice;if(runtimeRegistry.runtimes.some(item=>item.id===engine)){$('runtimeInstallStatus').textContent='当前环境已添加此运行时，无需重复添加';return;}if(!$('runtimeDisplayName').value.trim()){$('runtimeDisplayName').reportValidity();return;}if(engine==='deepseek' && !$('deepseekApiKey').value.trim()){$('runtimeInstallStatus').textContent='请输入 DeepSeek API Key';return;}
 const owner=accountState.user?.id,id=dockerEnvironmentState.activeId;
 environmentConfigBusy=true;updateConfigurationActions();$('runtimeInstallConfirm').loading=true;$('runtimeInstallCancel').disabled=true;$('runtimeDisplayName').disabled=true;$('runtimeDescription').disabled=true;$('runtimeInstallBack').disabled=true;$('runtimeInstallClose').disabled=true;$('deepseekApiKey').disabled=true;
 setRuntimeInstallLoading(true,engine);$('runtimeInstallStatus').textContent='';
 try{environmentPageDirty=true;await api.dockerEnvironments('installRuntime',{engine,name:$('runtimeDisplayName').value.trim(),description:$('runtimeDescription').value.trim(),...(engine==='deepseek'?{apiKey:$('deepseekApiKey').value.trim()}:{})});$('deepseekApiKey').value='';if(owner!==accountState.user?.id || id!==dockerEnvironmentState.activeId)return;$('runtimeInstallStatus').textContent='安装完成';}
 catch(error){$('runtimeInstallStatus').textContent='安装失败：'+error.message;throw error;}
 finally{setRuntimeInstallLoading(false);environmentConfigBusy=false;$('runtimeInstallConfirm').loading=false;$('runtimeInstallCancel').disabled=false;$('runtimeDisplayName').disabled=false;$('runtimeDescription').disabled=false;$('runtimeInstallBack').disabled=false;$('runtimeInstallClose').disabled=false;$('deepseekApiKey').disabled=false;updateConfigurationActions();}
 if(owner===accountState.user?.id && id===dockerEnvironmentState.activeId){$('runtimeInstallDialog').open=false;await refreshEnvironmentConfiguration();}
});
const settingCopy={git:['Git 管理','管理 Git SSH 公钥与代码仓库认证。'],browser:['浏览器','管理浏览器网络、站点数据和 Cookie 同步。'],profile:['个人资料','管理当前账号的基础信息。'],notifications:['通知','管理当前账号在本设备上的通知。'],shortcuts:['快捷键','配置发送方式和常用操作快捷键，仅保存在本设备。'],preferences:['偏好设置','管理语言、外观、阅读、时间显示和退出行为。'],proxy:['代理与出口','管理应用代理的连接与固定出口。'],environment:['本地系统','检测系统语言与时区，管理本机使用条件。'],activity:['连接记录','查看出口核验、连接与恢复状态。']};
for(const tab of document.querySelectorAll('[data-setting]'))tab.onclick=()=>{const key=tab.dataset.setting;if(key==='git')void gitSettings.ensureLoaded();if(key==='browser'){void loadBrowserCookiePreferences();void browserLibrary.refresh();}if(key==='activity')void loadConnectionRecords();$('verify').classList.toggle('hidden',key!=='proxy');document.querySelectorAll('[data-setting]').forEach(item=>item.classList.toggle('active',item===tab));document.querySelectorAll('[data-panel]').forEach(panel=>panel.classList.toggle('hidden',panel.dataset.panel!==key));$('settingsTitle').textContent=settingCopy[key][0];$('notificationScopeBadge').classList.toggle('hidden',!['notifications','shortcuts'].includes(key));$('notificationScopeBadge').lastChild.textContent=key==='shortcuts'?'仅本设备':'当前账号 · 本设备';$('settingsTitleIcon').src='assets/icons/'+({git:'git-branch',browser:'globe',profile:'user',preferences:'sliders-horizontal',notifications:'bell',shortcuts:'keyboard',proxy:'shield-check',activity:'activity',environment:'monitor'})[key]+'.svg';$('settingsDescription').textContent=settingCopy[key][1];};
let themePreference='light';try{themePreference=localStorage.getItem('ui-theme') || 'light';}catch{}
if(!['light','dark','system'].includes(themePreference))themePreference='light';
const systemTheme=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){const dark=themePreference==='dark' || themePreference==='system' && systemTheme.matches;document.body.classList.toggle('dark',dark);document.querySelector('.credential-heading>.kuneco-logo').src=dark?'assets/brand/kuneco-mark-white.png':'assets/brand/kuneco-mark.png';setUITheme(dark);$('themeSelect').value=themePreference;}
applyTheme();systemTheme.addEventListener('change',()=>{if(themePreference==='system')applyTheme();});
$('themeSelect').onchange=()=>{themePreference=$('themeSelect').value;applyTheme();try{localStorage.setItem('ui-theme',themePreference);}catch{}};
void action(async () => {
  switchPage('cc');renderChatAvailability();performance.mark('chat-shell-ready');
  const state = await api.state();
  for (const field of ['protocol', 'host', 'port', 'username']) if (state.proxy[field] !== undefined) $(field).value = state.proxy[field];
  currentProxyConfig={...state.proxy};hasPassword = state.proxy.hasPassword; $('password').placeholder = hasPassword ? '已保存（留空沿用）' : '可选';
  
  setEnvironment(state.environment);
  void recheckEnvironment();
  setNetwork(state.network);
  renderBrowserTabs(state.browser);
  selectedEngine=state.selectedEngine || 'cc';defaultEngine=state.defaultEngine || selectedEngine;defaultModel=state.defaultCodexModel || null;$('runtimeEngine').value=defaultEngine;
  selectedCodexModel=state.codexModel || null;
  for(const runtime of state.runtimeRegistry?.runtimes || [])runtimeVersions[runtime.id]={available:true,version:runtime.version};
  await restoreChats(state);
  performance.mark('chat-records-ready');
  const owner=state.chatOwner || null,environment=state.containerId || null;
  for(const [engine,load] of [['cc',()=>api.claudeInfo()],['codex',()=>api.codexInfo()]])void action(async()=>{const info=await load();if(chatOwnerID!==owner || dockerEnvironmentState.activeId!==environment)return;runtimeVersions[engine]=info;renderRuntime();});
});

async function reloadAccountChats(){if(chatReloading){chatReloadPending=true;return;}chatReloading=true;try{await restoreChats(await api.state());}catch(error){toast(error.message,'errors');}finally{chatReloading=false;if(chatReloadPending){chatReloadPending=false;void reloadAccountChats();}}}
let contentTabsScope=null;const environmentContentTabs=new Map();
async function restoreChats(state){
 const scope=JSON.stringify([state.chatOwner || null,state.containerId || null]);
 if(scope!==contentTabsScope){const active=contentTabState.tabs.find(tab=>tab.id===contentTabState.activeId && tab.page==='cc');if(active)active.draft=$('prompt').value;if(contentTabsScope)environmentContentTabs.set(contentTabsScope,contentTabState);contentTabState=environmentContentTabs.get(scope) || {tabs:[],activeId:null};contentTabsScope=scope;$('prompt').value='';renderContentTabs();}
 const version=++chatRestoreVersion;
 chatRestoring=false;defaultModel=state.defaultCodexModel || null;chatOwnerID=state.chatOwner || null;chatEnvironmentID=state.containerId || null;clearReasoningTimers();chatSessions=[];activeChatId=null;$('chat').replaceChildren();runtimeRegistry=state.runtimeRegistry || {runtimes:[]};
 if(!runtimeRegistry.runtimes.some(item=>supportsChat(item.id))){renderSessionList();renderChatAvailability();switchPage('cc');return;}
 let stored=state.chatViews || [];if(!chatOwnerID || state.chatImportLegacy){try{stored=JSON.parse(localStorage.getItem(state.chatImportLegacy?'ai-chat-views':'anonymous-chat-views') || '[]');}catch{}}
 for(const [creationOrder,value] of (state.aiSessions || []).entries()){const saved=stored.find(item=>item.id===value.id);const item={...value,creationOrder,pinned:Boolean(saved?.pinned || value.pinned),chatStatus:restoredChatStatus(saved),title:saved?.title || value.title || '新会话',nodes:[]};chatSessions.push(item);for(const message of saved?.messages || []){if(message.role==='assistant' && !message.text?.trim() && !message.reasoning?.text && !message.reasoning?.activities?.length && !Number.isFinite(message.reasoning?.durationMs))continue;if(['user','assistant','error'].includes(message.role) && typeof message.text==='string'){const content=bubble(message.role,message.text,value.engine,false,message.images || [],message.reasoning,message.createdAt,message.documents||[]);item.nodes.push(content.parentNode);}}$('chat').replaceChildren();}
 const currentOwner=(await api.accountState()).user?.id || null;if(version!==chatRestoreVersion)return;if(currentOwner!==chatOwnerID){chatReloadPending=true;return;}
 const item=restoredChat(chatSessions,{environmentId:state.containerId || null,activeId:state.activeAISessionId});
 if(item){const selected=await api.selectSession(item.id,{deferAuth:true});if(version!==chatRestoreVersion)return;applySession(selected,item);}else{renderSessionList();renderChatAvailability();switchPage('cc');}
 $('chatStorageStatus').textContent=chatOwnerID?'对话保存到当前账号':'未登录 · 对话仅保存在本机';
}

async function selectProxyFile(files){
 const version=++proxyFileVersion;$('proxyFileChoose').disabled=true;$('proxyFileError').textContent='';
 try{
  if(files && files.length!==1)throw new Error('请一次选择一个 TXT 或 CSV 文件');
  const file=await (files?api.proxyFileDrop(files[0]):api.proxyFilePick());
  if(!file || version!==proxyFileVersion || proxyMethod!=='file')return;
  proxyFileSelection=file.path;$('proxyFileChoose').value=file.name;importPrepared=false;importPreview=null;
  for(const key of ['host','port','username','password'])$(key).value='';
  $('proxyImportResult').classList.add('hidden');$('importSelection').classList.add('hidden');updateProxyActions();
 }catch(error){if(version===proxyFileVersion)$('proxyFileError').textContent=error.message;}
 finally{$('proxyFileChoose').disabled=false;}
};

$('proxyFileChoose').onclick=()=>void selectProxyFile();
$('proxyFileChoose').addEventListener('files-selected',event=>void selectProxyFile(event.detail.files));

let pickerResolve=null,pickerKind='file',pickerDirectory='',pickerParent='',pickerSelection=null,pickerScope='host',pickerContext=null;
function finishFilePicker(value=null){const resolve=pickerResolve;pickerResolve=null;$('filePicker').open=false;if(resolve)resolve(value);}
async function loadFilePicker(directory){
 const data=pickerScope.startsWith('container')?await api.project({action:pickerScope==='container-download'?'browseDownloadDirectory':'browse',path:directory}):await api.browseFiles({directory,kind:pickerKind});pickerDirectory=data.directory;pickerParent=data.parent;if(pickerContext && (pickerContext.owner!==accountState.user?.id || pickerContext.environment!==dockerEnvironmentState.activeId))throw new Error('账号或环境已变化，请重新选择');pickerSelection=pickerKind==='directory'?pickerDirectory:null;
 $('filePickerPath').value=pickerDirectory;$('filePickerUp').disabled=pickerParent===pickerDirectory;$('filePickerConfirm').disabled=!pickerSelection;$('filePickerEntries').replaceChildren();
 for(const entry of data.entries){const row=createUI('app-button');row.className='file-picker-entry';row.dataset.path=entry.path;row.setAttribute('role','listitem');row.append(createIcon(entry.directory?'folder':'file-text'),document.createTextNode(entry.name));
  row.onclick=()=>{if(entry.directory)void action(()=>loadFilePicker(entry.path));else{pickerSelection=entry.path;$('filePickerEntries').querySelectorAll('app-button').forEach(button=>button.classList.toggle('active',button===row));$('filePickerConfirm').disabled=false;}};
  $('filePickerEntries').append(row);
 }
 if(!data.entries.length){const empty=document.createElement('div');empty.className='app-empty-state file-picker-empty';const description=document.createElement('p');description.textContent='此目录没有可选择的项目。';empty.append(description);$('filePickerEntries').append(empty);}
 $('filePickerHint').textContent=pickerKind==='file'?'选择不超过 1 MB 的 TXT 或 CSV 导出文件。':'进入目标目录后，点击“选择此文件夹”。';
}
async function openFilePicker(kind,scope='host',directory){if(pickerResolve)throw new Error('请先完成当前文件夹选择');pickerScope=scope;pickerContext={owner:accountState.user?.id,environment:dockerEnvironmentState.activeId};pickerKind=kind;$('filePickerTitle').textContent=kind==='file'?'导入 TXT / CSV':scope==='container-download'?'下载保存位置':scope==='container'?'选择容器文件夹':'选择本机项目文件夹';$('filePicker').label=$('filePickerTitle').textContent;$('filePickerConfirmLabel').textContent=kind==='file'?'导入文件':'选择此文件夹';await loadFilePicker(directory);$('filePicker').open=true;return new Promise(resolve=>{pickerResolve=resolve;});}
$('filePickerClose').onclick=$('filePickerCancel').onclick=()=>finishFilePicker();
$('filePickerConfirm').onclick=()=>{if(pickerSelection)finishFilePicker(pickerSelection);};
$('filePicker').addEventListener('wa-after-hide',()=>{if(pickerResolve)finishFilePicker();bounds();});
$('filePickerUp').onclick=()=>void action(()=>loadFilePicker(pickerParent));
$('filePickerGo').onclick=()=>void action(()=>loadFilePicker($('filePickerPath').value));
$('filePickerPath').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();void action(()=>loadFilePicker($('filePickerPath').value));}};


function renderCredentialMode(){
 const google=credentialMode==='google';$('credentialChoices').classList.toggle('hidden',credentialMode!=='choice');$('credentialForm').classList.toggle('hidden',credentialMode!=='password');$('credentialGoogleWaiting').classList.toggle('hidden',!google);$('credentialCancel').classList.toggle('hidden',!google);$('credentialGoogle').loading=google;$('credentialGoogle').disabled=credentialBusy;$('credentialPasswordChoice').disabled=credentialBusy;$('credentialBack').disabled=credentialBusy;
 $('credentialDescription').textContent=credentialMode==='password'?'首次使用？输入用户名和密码即可创建账号。':google?'正在安全地连接你的 Google 账号。':'选择登录方式，继续使用你的工作环境。';
}
$('credentialPasswordChoice').onclick=()=>{if(credentialBusy)return;credentialMode='password';$('credentialError').textContent='';renderCredentialMode();$('loginUsername').focus();};
$('credentialBack').onclick=()=>{if(credentialBusy)return;credentialMode='choice';$('loginPassword').value='';$('loginPasswordConfirm').value='';$('credentialError').textContent='';validateCredentials();renderCredentialMode();};
function validateCredentials(){const name=($('loginUsername').value||'').trim(),password=$('loginPassword').value||'',confirm=$('loginPasswordConfirm').value||'',length=new TextEncoder().encode(password).length;const valid=[...name].length>=2 && [...name].length<=64 && !/\s/.test(name) && [...password].length>=8 && length<=72 && password===confirm;$('credentialConfirmHint').textContent=confirm && confirm!==password?'两次输入的密码不一致':'';$('credentialSubmit').disabled=credentialBusy || !valid;return valid;}
for(const id of ['loginUsername','loginPassword','loginPasswordConfirm'])$(id).addEventListener('input',validateCredentials);
$('credentialForm').addEventListener('submit',event=>{event.preventDefault();if(credentialBusy || !validateCredentials())return;void (async()=>{credentialBusy=true;validateCredentials();$('credentialError').textContent='';try{const state=await api.accountLogin({username:$('loginUsername').value.trim(),password:$('loginPassword').value,confirmPassword:$('loginPasswordConfirm').value});renderAccount(state);await refreshEnvironments();}catch(error){$('credentialError').textContent=error.message.replace(/^Error invoking remote method '[^']+': Error: /,'');}finally{$('loginPassword').value='';$('loginPasswordConfirm').value='';credentialBusy=false;validateCredentials();}})();});
$('credentialGoogle').onclick=()=>void (async()=>{if(credentialBusy)return;credentialBusy=true;credentialMode='google';renderCredentialMode();validateCredentials();$('credentialGoogle').disabled=true;$('credentialError').textContent='';try{renderAccount(await api.accountLogin());await refreshEnvironments();}catch(error){$('credentialError').textContent=error.message.replace(/^Error invoking remote method '[^']+': Error: /,'');}finally{credentialBusy=false;credentialMode='choice';renderCredentialMode();validateCredentials();}})();
$('credentialCancel').onclick=()=>void api.accountCancel();
async function logoutAccount(){ saveChatView();$('accountMenu').open=false;const state=await api.accountLogout();renderAccount(state);await refreshEnvironments();if(!state.serverRevoked)toast('本机已退出，账号服务暂不可用，服务端会话未撤销。');}

function renderAccount(state){
 if(accountState.user?.id!==state.user?.id)gitSettings.invalidate(false);
 if(state.authRequired!==undefined)loginScreenEnabled=state.authRequired;
 const wasAuth=document.body.classList.contains('auth-mode');document.body.classList.remove('auth-pending');const showLogin=loginScreenEnabled && !state.user;if(showLogin && state.status!=='signing-in' && !credentialBusy){$('loginPassword').value='';$('loginPasswordConfirm').value='';validateCredentials();}document.body.classList.toggle('auth-mode',showLogin);$('accountScreen').classList.toggle('hidden',!showLogin);
 if(showLogin){$('environmentGate').open=false;for(const overlay of document.querySelectorAll('app-dialog[open],wa-dropdown[open]'))overlay.open=false;}else if(wasAuth && displayedEnvironmentStatus)setEnvironment(displayedEnvironmentStatus);
 if(showLogin && !wasAuth && !credentialBusy)credentialMode='choice';renderCredentialMode();
 $('setupAccountLogin').classList.toggle('hidden',Boolean(state.user));$('setupAccountLogout').classList.toggle('hidden',!state.user);
 const changed=accountState.user?.id!==state.user?.id;if(changed){$('renameEnvironmentDialog').open=false;clearBrowserCookies();lastChatSyncNotice='';$('chatStorageStatus').textContent='';}accountState=state;if(changed)notificationSettings.setOwner(state.user?.id);renderProxyStorageScope();if(changed)void loadConnectionRecords();if(changed){runtimeRegistry={runtimes:[]};renderChatAvailability();}if(changed && chatOwnerID!==state.user?.id){chatRestoreVersion++;chatOwnerID=null;clearReasoningTimers();chatSessions=[];activeChatId=null;$('chat').replaceChildren();renderSessionList();}
 if(changed){setupInProgress=false;setupSessionStarted=false;setupImageConfirmed=false;$('environmentCreatedDialog').open=false;setupPreviewKey='';$('setupRuntimePreviewList').replaceChildren();setupDockerChecked=false;setupDockerError='';$('setupEnvironmentName').value='';validateSetupEnvironment();clearTimeout(proxySaveTimer);proxySaveVersion++;}
 const user=state.user;renderProfile(state);$('accountName').textContent=user?.name || (state.status==='signing-in'?'正在登录…':'未登录');setAccountAvatar($('accountAvatar'),state.avatar,state.avatarFallback || generatedAvatar('kuneco-guest'));$('accountSubtitle').textContent=user?.email || user?.username || '登录后同步代理配置';setAccountAvatar($('accountMenuAvatar'),state.avatar,state.avatarFallback || generatedAvatar('kuneco-guest'));$('accountMenuName').textContent=user?.name || '未登录';
 $('accountLogin').classList.toggle('hidden',Boolean(user) || state.status==='signing-in');$('accountLogout').classList.toggle('hidden',!user);$('accountCancel').classList.toggle('hidden',state.status!=='signing-in');$('accountDetails').classList.toggle('hidden',!user);
 $('accountEmail').textContent=user?.email || '';
 $('accountStatus').textContent=state.status==='signing-in'?'请在浏览器完成授权':'';
 $('remember').classList.toggle('hidden',Boolean(user));
 if(runtimeDetailEntry && (runtimeDetailOwner!==state.user?.id || runtimeDetailEnvironment!==dockerEnvironmentState.activeId))closeRuntimeDetails();
 if(state.proxy){currentProxyConfig={...state.proxy};for(const field of ['protocol','host','port','username'])$(field).value=state.proxy[field] ?? (field==='protocol'?'http':field==='port'?8080:'');$('password').value='';hasPassword=state.proxy.hasPassword;$('password').placeholder=hasPassword?'账号已保存（留空沿用）':'可选';}
 updateProxyActions();
}
$('accountLogin').onclick=()=>{if(loginScreenEnabled){$('accountMenu').open=false;document.body.classList.add('auth-mode');$('accountScreen').classList.remove('hidden');}else void action(async()=>{$('accountMenu').open=false;renderAccount(await api.accountLogin());});};
$('setupAccountLogin').onclick=()=>$('accountLogin').click();
$('setupAccountLogout').onclick=()=>void action(logoutAccount);
$('accountCancel').onclick=()=>void api.accountCancel();
$('accountLogout').onclick=()=>void action(logoutAccount);
for(const field of ['protocol','host','port','username','password'])for(const event of ['input','change'])$(field).addEventListener(event,updateProxyActions);
void api.accountState().then(state=>{renderAccount(state);return refreshEnvironments();}).catch(error=>toast(error.message,'errors'));

let profileSaving=false,profileStatusTimer;
function renderProfileActivity(){
 const sessions=chatOwnerID && chatOwnerID===accountState.user?.id?chatSessions:[];
 const activity=profileActivity(sessions);
 for(const [valueId,value] of [['profileTotalTokens',activity.totalTokens],['profilePeakTokens',activity.peakTokens]]){$(valueId).textContent=value===null?'—':new Intl.NumberFormat(uiLocale()).format(value);}
 $('profileChatCount').textContent=activity.total;$('profileArchivedCount').textContent=activity.archived;$('profileActiveDays').textContent=activity.activeDays;
 let tooltip=$('profileActivityTooltip');
 if(!tooltip){tooltip=document.createElement('wa-tooltip');tooltip.id='profileActivityTooltip';tooltip.placement='top';tooltip.trigger='manual';document.body.append(tooltip);}
 tooltip.open=false;
 const cells=activity.days.map(day=>{
  const cell=document.createElement('span');cell.id='profile-day-'+day.date;cell.dataset.level=day.level;cell.tabIndex=0;
  const label=activityTooltip(day,uiLocale());cell.setAttribute('aria-label',label);
  const show=()=>{tooltip.for=cell.id;tooltip.textContent=label;tooltip.open=true;};
  const hide=()=>{tooltip.open=false;};
  cell.addEventListener('mouseenter',show);cell.addEventListener('mouseleave',hide);cell.addEventListener('focus',show);cell.addEventListener('blur',hide);
  cell.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
  return cell;
 });
 $('profileActivityGrid').replaceChildren(...cells);
 $('profileActivityRange').textContent=displayDate(activity.days[0].date,'date')+' — '+displayDate(activity.days.at(-1).date,'date');
}
function renderProfile(state){
 const user=state.user,locale=user?.language || 'zh-CN';
 $('languageSelect').value=locale;document.documentElement.lang=locale;
 const dateLabel=value=>formatDisplayDate(value,locale);
 $('profileName').value=user?.name||'';
 const profileEmail=user ? (user.email||'') : '请先登录';
 $('profileEmail').textContent=profileEmail;$('profileEmail').hidden=!profileEmail;
 $('profileCreated').textContent=dateLabel(user?.createdAt);$('profileLogin').textContent=dateLabel(user?.lastLoginAt);
 $('profileIP').textContent=user?.loginIp?`${user.loginIp}`:'—';
 setAccountAvatar($('profileAvatar'),state.avatar,state.avatarFallback || generatedAvatar('kuneco-guest'));
 renderProxyRegion(network);renderProfileActivity();refreshDisplayedTimes();
 for(const id of ['profileName','changeAvatar','languageSelect'])$(id).disabled=!user;

}
async function saveProfileChange(change){
 if(profileSaving)return;clearTimeout(profileStatusTimer);profileSaving=true;$('profileName').disabled=true;$('changeAvatar').disabled=true;$('profileStatus').textContent='正在保存…';
 try{renderAccount(await api.accountProfileSave(change));$('profileStatus').textContent='已保存';profileStatusTimer=setTimeout(()=>{$('profileStatus').textContent='';},2500);}
 catch(error){$('profileStatus').textContent=error.message;throw error;}
 finally{profileSaving=false;const signedIn=Boolean(accountState.user);$('profileName').disabled=!signedIn;$('changeAvatar').disabled=!signedIn;}
}
$('profileName').addEventListener('keydown',event=>{if(event.key==='Enter' && !mountCompositionGuard($('prompt')).isComposing(event)){event.preventDefault();void action(()=>saveProfileChange({name:$('profileName').value}));}});
$('changeAvatar').onclick=()=>void action(async()=>{if(profileSaving)return;const owner=accountState.user?.id;const avatar=await api.avatarPick();if(owner!==accountState.user?.id)throw new Error('选择期间账号已变化，请重新选择头像');if(avatar)await saveProfileChange({avatar});});
$('languageSelect').onchange=()=>void action(async()=>{renderAccount(await api.accountProfileSave({language:$('languageSelect').value}));$('languageStatus').textContent='语言已保存到当前账号';});

async function refreshRuntimeRegistry(detect=false,refreshEngine=null){
 const owner=accountState.user?.id,environment=dockerEnvironmentState.activeId;
 const result=await api.runtimeInfo({detect,refreshEngine});if(owner!==accountState.user?.id || environment!==dockerEnvironmentState.activeId)return runtimeRegistry;
 runtimeRegistry=result;renderRuntimeAddedBadges();updateConfigurationActions();for(const item of result.runtimes)runtimeVersions[item.id]={...runtimeVersions[item.id],available:true,...item};
 $('runtimeEngine').replaceChildren(...result.runtimes.map(item=>{const option=document.createElement('wa-option');option.value=item.id;option.label=item.name;option.disabled=!supportsChat(item.id);const icon=createIcon(runtimeIcon(item.id));icon.slot='start';option.append(icon,document.createTextNode(item.name+(option.disabled?' · 暂不支持对话，请使用控制台':'')));return option;}));
 updateRuntimeSelectIcon();
 $('createNewSession').disabled=!result.runtimes.some(item=>supportsChat(item.id));$('runtimeCount').textContent=result.runtimes.length?String(result.runtimes.length):'';$('runtimeCount').classList.toggle('hidden',result.runtimes.length===0);$('openRuntimeInstall').classList.remove('hidden');
 renderChatAvailability();renderSessionModel();return result;
}
void action(refreshRuntimeRegistry);

$('proxyQuickToggle').onclick=()=>{const button=$('proxyQuickToggle');if(button.disabled)return;if(button.dataset.action==='disconnect')void action(disconnectProxy);else void action(reconnectCurrentProxy);};
for(const field of ['protocol','host','port','username','password'])for(const type of ['input','change'])$(field).addEventListener(type,updateProxyActions);
updateProxyActions();
for(const type of ['transitionrun','transitionend'])document.querySelector('.sidebar').addEventListener(type,bounds);
new ResizeObserver(bounds).observe(document.querySelector('.sidebar'));

let renameEnvironmentTarget=null,renameEnvironmentBusy=false;
function updateRenameEnvironmentSave(){const name=$('renameEnvironmentName').value.trim();$('saveRenameEnvironment').disabled=renameEnvironmentBusy || !name || name.length>40;}
$('renameEnvironmentName').addEventListener('input',updateRenameEnvironmentSave);
$('renameEnvironment').onclick=()=>{
 const state=dockerEnvironmentState,entry=state.environments.find(item=>item.id===state.activeId);
 renameEnvironmentTarget={owner:accountState.user?.id,id:state.activeId};
 $('renameEnvironmentName').value=entry?.name || state.localName || '本机环境';$('renameEnvironmentError').textContent='';updateRenameEnvironmentSave();$('renameEnvironmentDialog').open=true;
};
$('cancelRenameEnvironment').onclick=()=>{if(!renameEnvironmentBusy)$('renameEnvironmentDialog').open=false;};
$('saveRenameEnvironment').onclick=async()=>{
 if(renameEnvironmentBusy || !renameEnvironmentTarget || !$('renameEnvironmentName').value.trim() || $('renameEnvironmentName').value.trim().length>40)return;
 const target=renameEnvironmentTarget;if(target.owner!==accountState.user?.id || target.id!==dockerEnvironmentState.activeId){$('renameEnvironmentError').textContent='账号或环境已变化，请重新打开弹窗';return;}
 renameEnvironmentBusy=true;$('saveRenameEnvironment').loading=true;$('saveRenameEnvironment').disabled=true;$('cancelRenameEnvironment').disabled=true;
 try{await environmentOperation('rename',{...target,name:$('renameEnvironmentName').value});if(target.owner!==accountState.user?.id || target.id!==dockerEnvironmentState.activeId)return;$('renameEnvironmentDialog').open=false;}
 catch(error){$('renameEnvironmentError').textContent=error.message.replace(/^Error invoking remote method '[^']+': Error: /,'');}
 finally{renameEnvironmentBusy=false;$('saveRenameEnvironment').loading=false;updateRenameEnvironmentSave();$('cancelRenameEnvironment').disabled=false;}
};
$('renameEnvironmentName').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('saveRenameEnvironment').click();}});
function createEnvironmentIconPicker(id,icon){
 const owner=accountState.user?.id,menu=createUI('wa-dropdown');menu.className='environment-detail-icon-picker';menu.placement='bottom-start';
 const trigger=createUI('app-button');trigger.slot='trigger';trigger.className='environment-detail-icon-button';trigger.setAttribute('aria-label','更换环境图标');trigger.title='更换环境图标';trigger.append(createIcon(icon));trigger.disabled=!owner;
 const grid=document.createElement('div');grid.className='environment-icon-grid';grid.setAttribute('role','group');grid.setAttribute('aria-label','选择环境图标');
 for(const name of ENVIRONMENT_ICONS){const button=createUI('app-button');button.classList.add('environment-icon-choice');button.setAttribute('aria-label',name);button.setAttribute('aria-pressed',String(name===icon));button.append(createIcon(name));button.onclick=()=>void action(async()=>{
  if(owner!==accountState.user?.id || id!==dockerEnvironmentState.activeId)throw new Error('账号或环境已变化，请重新选择');
  menu.open=false;if(name===icon)return;trigger.loading=true;trigger.disabled=true;
  try{await environmentOperation('icon',{owner,id,icon:name});if(runtimeDetailEntry && !$('runtimeDetailPage').classList.contains('hidden'))openRuntimeDetails(runtimeDetailEntry);}
  finally{trigger.loading=false;trigger.disabled=false;}
 });grid.append(button);}
 menu.append(trigger,grid);return menu;
}
async function environmentOperation(action,value={}){
 const hasCurrentEnvironment=dockerEnvironmentState.activeId===null?dockerEnvironmentState.localEnabled!==false:dockerEnvironmentState.environments.some(item=>item.id===dockerEnvironmentState.activeId);
 if(action==='select' && hasCurrentEnvironment && value.id!==dockerEnvironmentState.activeId){
  const dialog=$('switchEnvironmentDialog'),confirm=$('confirmEnvironmentSwitch'),cancel=$('cancelEnvironmentSwitch');
  if(dialog.open)throw new Error('请先完成当前环境切换');
  const previous=dockerEnvironmentState.activeId,owner=accountState.user?.id;
  const target=dockerEnvironmentState.environments.find(item=>item.id===value.id);
  $('switchEnvironmentDescription').textContent='是否切换到“'+(target?.name || dockerEnvironmentState.localName || '本机环境')+'”？';
  $('switchEnvironmentProgress').textContent='切换会停止其他已登记环境的容器及其中的后台任务，工作文件和聊天记录会保留。切换后会自动连接该环境已保存的代理。';
  confirm.loading=false;confirm.disabled=false;cancel.disabled=false;dialog.open=true;
  return new Promise((resolve,reject)=>{
   let switching=false,settled=false;
   const preventClose=event=>{if(switching && !settled)event.preventDefault();};
   dialog.addEventListener('wa-hide',preventClose);
   const close=()=>{if(!settled){settled=true;resolve(dockerEnvironmentState);}dialog.removeEventListener('wa-after-hide',close);dialog.removeEventListener('wa-hide',preventClose);};
   dialog.addEventListener('wa-after-hide',close);
   cancel.onclick=()=>{dialog.open=false;};
   confirm.onclick=async()=>{
    if(switching)return;
    switching=true;confirm.loading=true;confirm.disabled=true;cancel.disabled=true;
    $('switchEnvironmentProgress').textContent='正在切换环境并连接已保存的代理，请稍候…';
    try{
     if(owner!==accountState.user?.id || previous!==dockerEnvironmentState.activeId)throw new Error('当前账号或环境已变化，请重新选择');
     const state=await performEnvironmentOperation(action,value);settled=true;resolve(state);
    }catch(error){settled=true;reject(error);}
    finally{dialog.open=false;confirm.loading=false;confirm.disabled=false;cancel.disabled=false;}
   };
  });
 }
 return performEnvironmentOperation(action,value);
}
async function performEnvironmentOperation(action,value={}){
 if(action==='select' && value.id===dockerEnvironmentState.activeId)return dockerEnvironmentState;
 const owner=accountState.user?.id;
 if(action==='select' || action==='delete'){clearTimeout(proxySaveTimer);proxySaveVersion++;}
 if(action==='select' && chatOwnerID)await api.saveChats(chatViewData(),chatOwnerID,dockerEnvironmentState.activeId);
 const previousEnvironment=dockerEnvironmentState.activeId;if(action==='select' || action==='delete')clearBrowserCookies();
 const state=await api.dockerEnvironments(action,value);if(owner!==accountState.user?.id)throw new Error('操作期间账号已变化，请重新打开环境');dockerEnvironmentState=state;await refreshEnvironments(state);
 if(action==='select' || (action==='delete' && previousEnvironment===value.id)){navigationHistory=[];navigationIndex=-1;defaultModel=null;runtimeVersions={};void loadConnectionRecords();await reloadAccountChats();await refreshRuntimeRegistry();if(action==='select'){const selected=state.environments.find(item=>item.id===state.activeId);toast(`已切换到“${selected?.name || state.localName || '本机环境'}”环境，${state.proxyConnection?.reason || ('当前环境为 '+(selected?'Docker 容器':'本机'))}`,'network');}}
 return state;
}
function setEnvironmentTypeIcon(target,local){
 const brand=local?(api.platform==='darwin'?'apple':api.platform==='win32'?'windows':api.platform==='linux'?'linux':'monitor'):'docker';
 const label=local?({apple:'本机 · macOS',windows:'本机 · Windows',linux:'本机 · Linux',monitor:'本机'})[brand]:'Docker 容器';
 target.className='environment-type-icon';target.dataset.kind=local?'local':'docker';target.title=label;target.setAttribute('aria-label',label);target.setAttribute('role','img');
 const icon=createIcon(brand==='monitor'?'monitor':'brand-'+brand);icon.setAttribute('aria-hidden','true');target.replaceChildren(icon);
}
let environmentLoadVersion=0,environmentPageScope=null,environmentPageDirty=false;
const environmentScope=()=>JSON.stringify([accountState.user?.id || null,dockerEnvironmentState.activeId || null]);
async function ensureEnvironmentPage(){
 if(document.querySelector('#page-environments>.environments-body').classList.contains('is-loading'))return;
 if(environmentPageScope===environmentScope() && !environmentPageDirty)return;
 await refreshEnvironments();
}
async function refreshEnvironments(existing){
 const version=++environmentLoadVersion,body=document.querySelector('#page-environments>.environments-body');body.classList.add('is-loading');body.setAttribute('aria-busy','true');
 try{
 const owner=accountState.user?.id;const state=existing || await api.dockerEnvironments('state');if(owner!==accountState.user?.id || version!==environmentLoadVersion)return;const gitEnvironmentChanged=dockerEnvironmentState.activeId!==state.activeId || dockerEnvironmentState.localEnabled!==state.localEnabled;dockerEnvironmentState=state;if(gitEnvironmentChanged)gitSettings.invalidate();renderProxyStorageScope();if(!document.querySelector('[data-panel=browser]').classList.contains('hidden'))void loadBrowserCookiePreferences();
 const hasLocal=state.localEnabled!==false,localName=state.localName || '本机环境';
 const noEnvironments=!hasLocal && !state.environments.length;
 if(!accountState.user){setupInProgress=false;setupSessionStarted=false;}
 if(noEnvironments && accountState.user){if(!setupSessionStarted)beginEnvironmentSetup();setupInProgress=true;setSetupWizardStep(setupWizardStep);}
 if(setupInProgress)void previewSetupRuntimes();
 document.body.classList.toggle('environment-onboarding',setupInProgress);$('environmentSetup').classList.toggle('hidden',!setupInProgress);
 const selected=state.environments.find(item=>item.id===state.activeId);
 $('environmentMenu').querySelector('[slot=trigger] wa-icon').src='assets/icons/'+environmentIcon(selected?selected.icon:state.localIcon,selected?'boxes':'monitor')+'.svg';
 $('renameEnvironment').disabled=noEnvironments || !accountState.user;
 $('environmentName').textContent=selected?.name || (hasLocal?localName:'暂无环境');
 setEnvironmentTypeIcon($('environmentTypeBadge'),!selected);$('environmentTypeBadge').classList.toggle('hidden',noEnvironments);
 document.querySelectorAll('[data-environment-option]').forEach(item=>item.remove());
 for(const item of [...(hasLocal?[{id:null,name:localName,icon:state.localIcon}]:[]),...state.environments]){
  const option=createUI('wa-dropdown-item');option.dataset.environmentOption='true';
  const icon=createIcon(environmentIcon(item.icon,item.id===null?'monitor':'boxes'));icon.className='environment-option-icon';
  const copy=document.createElement('span');copy.className='environment-option-copy';const name=document.createElement('span');name.className='environment-option-name';name.textContent=item.name;name.title=item.name;const type=document.createElement('span');setEnvironmentTypeIcon(type,item.id===null);copy.append(icon,name,type);option.append(copy);
  const check=createIcon('check');check.style.visibility=item.id===state.activeId?'visible':'hidden';copy.append(check);if(item.id===state.activeId){option.setAttribute('aria-current','true');option.disabled=true;}
  option.onclick=()=>{if(item.id===dockerEnvironmentState.activeId)return;void action(async()=>{$('environmentMenu').open=false;await environmentOperation('select',{id:item.id});});};$('environmentMenu').append(option);
 }
 $('newEnvironment').disabled=!accountState.user;
 $('deleteEnvironmentMenuTrigger').disabled=noEnvironments;
 $('environmentList').replaceChildren();
 const localRow=document.createElement('div');localRow.className='docker-environment-row';localRow.dataset.localEnvironment='true';
 const localInfo=document.createElement('div'),localTitle=document.createElement('strong'),localMeta=document.createElement('p');localTitle.textContent=localName;localMeta.className='muted';localMeta.textContent='本机环境 · 使用本机运行时与文件'+(state.activeId===null?' · 当前环境':'');localInfo.append(localTitle,localMeta);localRow.append(createIcon(environmentIcon(state.localIcon,'monitor')),localInfo);
 if(hasLocal && state.activeId===null){$('environmentList').append(localRow);await renderEnvironmentCard(localRow,null);}

 for(const item of state.environments.filter(item=>item.id===state.activeId)){
  const row=document.createElement('div');row.className='docker-environment-row';
  const info=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('p');name.textContent=item.name;meta.className='muted';meta.textContent=`${item.statusText || (item.running?'运行中':'已停止')} · ${item.runtimeCount} 个运行时${item.external?' · 已有容器（原网络）':''}${item.id===state.activeId?' · 当前环境':''}`;info.append(name,meta);row.append(createIcon(environmentIcon(item.icon,'boxes')),info);

  row.dataset.environmentId=item.id;
  $('environmentList').append(row);await renderEnvironmentCard(row,item.id);
 }

 if(version===environmentLoadVersion){environmentPageScope=environmentScope();environmentPageDirty=false;}
 }finally{if(version===environmentLoadVersion){body.classList.remove('is-loading');body.setAttribute('aria-busy','false');}}
}

$('deleteEnvironmentMenuTrigger').onclick=()=>{const state=dockerEnvironmentState;const item=state.activeId===null?(state.localEnabled!==false?{id:null,name:state.localName || '本机环境'}:null):state.environments.find(item=>item.id===state.activeId);if(item)environmentDeleteButton(item).onclick();};
function environmentDeleteButton(item){
 const remove=createUI('wa-dropdown-item');remove.variant='danger';remove.dataset.environmentDelete='true';const icon=createIcon('trash-2');icon.slot='icon';remove.append(icon,document.createTextNode((item.external?'移除关联：':'删除：')+item.name));remove.setAttribute('aria-label','删除环境 '+item.name);
 remove.onclick=()=>{pendingEnvironmentDeletion={id:item.id,name:item.name};$('deleteEnvironmentExpected').textContent=item.name;$('deleteEnvironmentName').value='';$('deleteEnvironmentName').placeholder=item.name;$('confirmDeleteEnvironment').disabled=true;$('deleteEnvironmentError').textContent='';document.querySelector('.delete-environment-warning').textContent=item.external?'只移除此账号在应用中的容器关联、对话记录、代理配置和浏览数据。原容器及其文件、登录信息会保留。':item.id===null?'此操作不可撤销。应用内该环境的对话记录、代理配置、运行时检测记录和浏览数据将被永久删除。本机项目文件及系统 CLI 登录不会删除。':'此操作不可撤销。该环境的工作文件、运行时登录、代理配置、对话记录和浏览数据都将被永久删除。';$('deleteEnvironmentDialog').open=true;};return remove;
}
async function renderEnvironmentCard(row,id){
 const owner=accountState.user?.id,header=document.createElement('div'),details=document.createElement('div');
 row.classList.add('environment-expanded');header.className='environment-card-header';header.append(...row.childNodes);
 details.className='environment-inline-details';details.textContent='正在读取环境信息…';row.append(header,details);
 try{
  const detail=await api.dockerEnvironments('detail',{id});
  if(owner!==accountState.user?.id || id!==dockerEnvironmentState.activeId || !row.isConnected)return;
  details.replaceChildren();
  const item=dockerEnvironmentState.environments.find(item=>item.id===id),local=id===null,current=id===dockerEnvironmentState.activeId;
  row.classList.toggle('environment-has-image-details',!local);
  const identity=document.createElement('div');identity.className='environment-identity';
  const nameLine=document.createElement('div');nameLine.className='environment-name-line';const name=document.createElement('h2');name.textContent=detail.name;
  const status=document.createElement('span');status.className='environment-running-status';status.dataset.running=String(local || Boolean(item?.running));status.textContent=local?'本机':detail.reliability?.worker?.status || item?.statusText || (item?.running?'运行中':'已停止');
  const type=document.createElement('span');setEnvironmentTypeIcon(type,local);nameLine.append(name);nameLine.append(type);
  if(current){const active=createUI('wa-badge');active.className='small-tag';active.textContent='当前环境';nameLine.append(active);}if(!local)nameLine.append(status);
  const metadata=document.createElement('div');metadata.className='environment-summary-meta environment-image-versions';
  const baseVersion=detail.baseSystem?['Node.js '+detail.baseSystem.node,detail.baseSystem.os].filter(Boolean).join(' · '):detail.baseImage || '版本信息未记录';
  if(!local)for(const [title,text] of [['基础镜像版本',baseVersion],['容器镜像版本',detail.containerImage || '未知']]){const pair=document.createElement('div'),label=document.createElement('span'),value=document.createElement('strong');label.textContent=title;value.textContent=text;pair.append(label,value);metadata.append(pair);}
  if(!local){const identifiers=document.createElement('div');identifiers.className='environment-container-identifiers';for(const [label,text] of [['容器名称',detail.containerName],['容器 ID',detail.containerId]]){if(!text)continue;const pair=document.createElement('div'),term=document.createElement('span'),value=document.createElement('strong');term.textContent=label;value.textContent=text;pair.append(term,value);identifiers.append(pair);}metadata.append(identifiers);}
  if(!local)for(const [index,label,date] of [[0,'创建时间',detail.createdAt],[1,'最近检测',detail.checkedAt]]){const row=document.createElement('div');row.className='environment-version-date';const term=document.createElement('span'),value=document.createElement('span');term.textContent=label;value.textContent=date?displayEnvironmentDate(date,index===1):'尚未检测';if(date){value.dataset.environmentDate=date;value.dataset.environmentRecent=String(index===1);value.title=displayDate(date);}row.append(term,value);metadata.children[index].append(row);}
  identity.append(nameLine);if(local){const subtitle=document.createElement('p');subtitle.className='environment-container-name';subtitle.textContent='使用本机运行时与工作文件';identity.append(subtitle);}else identity.append(metadata);
  header.replaceChildren(createEnvironmentIconPicker(id,environmentIcon(local?dockerEnvironmentState.localIcon:dockerEnvironmentState.environments.find(item=>item.id===id)?.icon,local?'monitor':'boxes')),identity);
  const facts=document.createElement('dl');facts.className='environment-inline-facts';
  for(const [label,value,date] of [
   ...(!local?[['基础镜像来源',detail.baseImage]]:[]),
   ['工作文件',id===null?'使用本机文件':detail.external?'使用原容器文件':'独立容器数据卷'],
   ['运行时登录',id===null?'使用本机登录':detail.external?'使用原容器登录':'仅保存在当前环境'],
   ['代理配置',id===null?'使用本机代理配置':detail.proxyConfigured?'已配置':'未配置'],
   ...(local?[
    ['创建时间',detail.createdAt?displayDate(detail.createdAt):null,detail.createdAt],
    ['最近检测',detail.checkedAt?displayDate(detail.checkedAt):'尚未检测',detail.checkedAt]
   ]:[])
  ]){if(value===null)continue;const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=value;if(date){description.dataset.environmentDate=date;description.dataset.environmentRecent=String(label==='最近检测');description.textContent=displayEnvironmentDate(date,label==='最近检测');description.title=displayDate(date);}const pair=document.createElement('div');if(label==='基础镜像来源')pair.className='environment-fact-wide';pair.append(term,description);facts.append(pair);}
  const runtimes=document.createElement('div');runtimes.className='environment-inline-runtimes';
  const title=document.createElement('h3');title.className='preference-heading';title.textContent='运行时';const count=document.createElement('span');count.className='environment-runtime-count muted';count.textContent=detail.runtimes.length+' 个运行时';title.append(count);const hint=document.createElement('p');hint.className='environment-runtimes-hint settings-section-description muted';hint.textContent='此环境中已检测到的运行时、CLI 版本及支持的模型。';runtimes.append(title,hint);
  if(detail.runtimes.length){
   const table=document.createElement('app-table');
   renderRuntimeTable(table,detail.runtimes,{columns:[{key:'name',label:'运行时',width:'145px'},{key:'version',label:'CLI 版本',width:'175px'},{key:'models',label:'模型'}],actions:false,onOpen:runtime=>{if(owner!==accountState.user?.id || id!==dockerEnvironmentState.activeId)return;switchPage('runtime');openRuntimeDetails(runtimeRegistry.runtimes.find(entry=>entry.id===runtime.id) || runtime);}});runtimes.append(table);
  }else{const empty=document.createElement('p');empty.className='environment-runtime-empty muted';empty.textContent='尚未配置运行时。'+(id===dockerEnvironmentState.activeId?'请前往「运行时」配置。':'切换到此环境后，请前往「运行时」配置。');runtimes.append(empty);}
  details.append(facts);
  if(!local){
   const section=document.createElement('section');section.className='environment-reliability environment-network';
   const heading=document.createElement('h3');heading.className='preference-heading';heading.textContent='网络与防火墙';
   const description=document.createElement('p');description.className='settings-section-description';description.textContent='显示本次读取的实际配置。防火墙检查与代理出口核验独立，检查失败不会重启代理。';
   const facts=document.createElement('dl');facts.className='environment-network-facts';
   for(const entry of networkDisplayRows(detail.reliability?.network,{external:detail.external})){const pair=document.createElement('div'),label=document.createElement('dt'),value=document.createElement('dd');label.textContent=entry.label;value.textContent=entry.value;pair.append(label,value);facts.append(pair);}
   section.append(heading,description,facts);details.append(section);
  }
  if(!local){
   const section=document.createElement('section');section.className='environment-reliability';
   const heading=document.createElement('h3');heading.className='preference-heading';heading.textContent='容器状态与保障';
   const description=document.createElement('p');description.className='settings-section-description';description.textContent=detail.external?'以下为原容器当前配置，由原容器管理方维护。':'容器自检只检查本地服务，不代表代理出口已核验。数据卷保留，规格更新失败会回退。';
   const table=document.createElement('app-table');renderAppTable(table,{label:'容器状态与保障',columns:[{key:'label',label:'项目',width:'120px'},{key:'worker',label:detail.external?'关联容器':'工作容器'},...(!detail.external?[{key:'gateway',label:'代理网关'}]:[])],rows:containerDisplayRows(detail.reliability?.worker,detail.reliability?.gateway,{external:detail.external}),minWidth:detail.external?400:600});section.append(heading,description,table);details.append(section);
  }
  details.append(runtimes);
 }catch(error){if(owner===accountState.user?.id && row.isConnected)details.textContent='环境信息读取失败：'+error.message;}
}

function renderNetworkTimes(status){
  $('connectionReason').textContent = (status.recovering ? `自动恢复中${status.nextRetryAt ? ' · 下次重试 ' + displayDate(status.nextRetryAt,'time') : ''}。` : '') + (status.reason || '请先连接代理');
  $('lastCheck').textContent = status.checkedAt ? `核验时间 ${displayDate(status.checkedAt,'time')}` : '仅通过你配置的代理检测';
}

function refreshDisplayedTimes(){
 refreshTimeElements(document);
 if(displayedEnvironmentStatus)setEnvironment(displayedEnvironmentStatus);
 renderNetworkTimes(network);renderAuth();renderSessionHeader();
 for(const element of document.querySelectorAll('[data-environment-date]'))element.textContent=displayEnvironmentDate(element.dataset.environmentDate,element.dataset.environmentRecent==='true');
}



setInterval(()=>{refreshTimeElements(document);for(const element of document.querySelectorAll('[data-environment-date]'))element.textContent=displayEnvironmentDate(element.dataset.environmentDate,element.dataset.environmentRecent==='true');},30000);

mountLearningAutomation(api,()=>({runtimes:runtimeRegistry.runtimes,refreshRuntimes:refreshRuntimeRegistry,language:uiLocale(),name:dockerEnvironmentState.environments.find(e=>e.id===dockerEnvironmentState.activeId)?.name || '当前环境'}));

mountShortcuts({document,platform:api.platform,getBindings:()=>preferences.shortcuts,onError:error=>toast(error.message),actions:{
 newChat:()=>{if(document.body.matches('.auth-mode,.auth-pending,.environment-onboarding'))return false;document.getElementById('railNewSession').click();},
 searchChat:()=>{if(page!=='cc')return false;chatSearch.open();},
 focusComposer:()=>{if(page!=='cc'||$('prompt').disabled)return false;$('prompt').focus();},
 stopReply:()=>{if(page!=='cc'||!chatRuns.has(activeChatId))return false;return api.cancel(activeChatId);},
 toggleSidebar:()=>$('toggleSidebar').click(),settings:()=>openAccountSettings('preferences'),shortcuts:()=>openAccountSettings('shortcuts'),
 nextTab:()=>cycleContentTab(1),previousTab:()=>cycleContentTab(-1),
 closeTab:()=>{const tab=contentTabState.tabs.find(tab=>tab.id===contentTabState.activeId);if(!tab||tab.pinned||contentTabState.tabs.length<2)return false;return closeContentTabView(tab.id);},
 pinTab:()=>{const tab=contentTabState.tabs.find(tab=>tab.id===contentTabState.activeId);if(!tab)return false;toggleContentTabPin(tab.id);},
 browser:()=>switchPage('browser'),automation:()=>switchPage('automation'),runtimes:()=>switchPage('runtime'),console:()=>switchPage('console')
}});
function cycleContentTab(direction){const tabs=contentTabState.tabs,index=tabs.findIndex(tab=>tab.id===contentTabState.activeId);if(tabs.length<2)return false;return activateContentTab(tabs[(index+direction+tabs.length)%tabs.length]);}
