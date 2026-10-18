import {renderAppTable} from '../../shared/ui/app-table.mjs';

export function mountBrowserSettings({document,api,getScope,formatDate,onOpenSite}){
 const $=id=>document.getElementById(id);let current=null,list=null,generation=0,listRequest=0,busy=false,selection=null,siteDetailsOpen=false;
 const scope=()=>({owner:getScope().owner,environmentId:getScope().environmentId || null});
 const matches=value=>value?.owner===scope().owner && (value?.environmentId || null)===scope().environmentId;
 function renderSync(value){
  if(!matches(value))return;current=value;const sync=value.sync,cloud=value.settings.mode==='account';
  $('browserSyncState').textContent=cloud?({idle:'等待首次同步',syncing:'正在同步…',synced:'已同步',error:'同步失败'}[sync.state] || '等待同步'):'仅保存在本设备';
  $('browserSyncTime').textContent=sync.lastSuccessAt?'本次启动最近成功：'+formatDate(sync.lastSuccessAt):cloud?'本次启动尚未成功同步':'未启用云端同步';
  $('browserSyncNow').disabled=busy || !cloud || sync.state==='syncing';$('browserSyncNow').loading=cloud && sync.state==='syncing';
  $('browserSyncNow').querySelector('span').textContent=sync.state==='error'?'重试同步':'立即同步';
  $('browserCookieSettingsStatus').textContent=sync.error || '';
 }
 $('browserSyncNow').onclick=async()=>{
  const token=generation;busy=true;$('browserSyncNow').loading=true;$('browserSyncNow').disabled=true;$('browserCookieMode').disabled=true;
  try{const result=await api.browserData('sync',scope());if(token===generation)renderSync(result);}
  catch(error){if(token===generation)$('browserCookieSettingsStatus').textContent=error.message;}
  finally{if(token===generation){busy=false;$('browserCookieMode').disabled=false;$('browserSyncNow').loading=false;if(current)renderSync(current);}}
 };
 function renderList(){
  const query=$('browserSiteFilter').value.trim().toLowerCase(),rows=(list?.sites || []).filter(row=>row.domain.includes(query));
  renderAppTable($('browserSiteTable'),{label:'已记录站点',minWidth:480,columns:[{key:'domain',label:'域名'},{key:'cookies',label:'Cookie',width:'90px'},{key:'origins',label:'已记录来源',width:'110px',render:row=>row.origins.length}],rows,onActivate:row=>void openSite(row),rowLabel:row=>'查看 '+row.domain+' 的 Cookie',empty:query?'没有匹配的站点':'当前环境暂无已记录站点',actions:row=>{
   const menu=document.createElement('wa-dropdown'),button=document.createElement('app-button'),icon=document.createElement('wa-icon');button.slot='trigger';button.className='icon-button';button.setAttribute('aria-label','管理 '+row.domain);icon.src='assets/icons/ellipsis.svg';button.append(icon);
   const item=document.createElement('wa-dropdown-item'),trash=document.createElement('wa-icon');item.variant='danger';trash.slot='icon';trash.src='assets/icons/trash-2.svg';item.append(trash,'清除站点数据');item.onclick=()=>{menu.open=false;confirm({kind:'site',domain:row.domain});};menu.append(button,item);return menu;
  }});
  $('browserCacheSize').textContent=list?'环境总缓存 '+(list.cacheBytes/1024/1024).toFixed(2)+' MB。':'';
 }
 async function refresh(){
  const token=generation,request=++listRequest;list=null;renderList();$('browserSiteStatus').textContent='正在读取…';
  $('browserSiteRefresh').loading=true;for(const id of ['browserSiteRefresh','browserClearCache','browserClearAll'])$(id).disabled=true;
  try{const result=await api.browserData('list');if(token!==generation || request!==listRequest || !matches(result))return;list=result;renderSync(result);renderList();$('browserSiteScope').textContent=getScope().label+' · 数据按账号和环境隔离';$('browserSiteStatus').textContent=result.indexWarning || '已记录 '+result.sites.length+' 个站点。';}
  catch(error){if(token===generation && request===listRequest)$('browserSiteStatus').textContent='读取失败：'+error.message;}
  finally{if(token===generation && request===listRequest){$('browserSiteRefresh').loading=false;$('browserSiteRefresh').disabled=false;$('browserClearCache').disabled=!list;$('browserClearAll').disabled=!list;}}
 }
 const closeDialog=dialog=>new Promise(resolve=>{if(!dialog.open){resolve();return;}dialog.addEventListener('wa-after-hide',resolve,{once:true});dialog.open=false;});
 async function openSite(row){
  if(siteDetailsOpen || !list)return;const token=generation;siteDetailsOpen=true;
  await closeDialog($('browserSiteDataDialog'));if(token!==generation)return;
  onOpenSite(row.domain);
 }
 $('browserCookiesDialog').addEventListener('wa-after-hide',event=>{
  if(event.target===$('browserCookiesDialog') && siteDetailsOpen){siteDetailsOpen=false;$('browserSiteDataDialog').open=true;}
 });
 async function confirm(value){
  if(!list)return;const token=generation;selection={...value,...scope()};await closeDialog($('browserSiteDataDialog'));if(token!==generation)return;
  const cloud=current?.settings.mode==='account';
  $('browserClearDescription').textContent=(value.kind==='cache'?'仅清除当前环境的 HTTP 缓存，保留 Cookie 和登录数据。':value.kind==='all'?'清除当前环境全部站点的 Cookie、本地存储、缓存及 HTTP 登录缓存，可能退出网站登录。':'清除 '+value.domain+' 的 Cookie 与已记录来源的站点存储、缓存；共享域 Cookie 可能影响子站点登录。')+' 当前环境的浏览器标签页将关闭，其他账号和环境不受影响。'+(value.kind!=='cache'?(cloud?'当前启用了云端同步：同时移除对应云端 Cookie；同步失败时不清除本地数据。':'仅清理本设备；已有云端副本保留，重新开启同步可能恢复 Cookie。'):'');
  $('browserClearStatus').textContent='';$('browserClearDialog').open=true;
 }
 $('browserClearConfirm').onclick=async()=>{
  if(!selection || busy)return;const token=generation;busy=true;const value=selection;
  $('browserClearConfirm').loading=true;$('browserClearConfirm').disabled=true;$('browserClearCancel').disabled=true;
  $('browserClearStatus').textContent='正在处理，请稍候…';
  try{const result=await api.browserData('clear',value);if(token!==generation)return;list=result;renderSync(result);renderList();selection=null;busy=false;await closeDialog($('browserClearDialog'));if(token!==generation)return;$('browserSiteDataDialog').open=true;$('browserSiteStatus').textContent='清理完成，已关闭当前环境的浏览器标签页。';}
  catch(error){if(token===generation)$('browserClearStatus').textContent='清理未完成：'+error.message+'。如网络响应中断，云端结果可能尚未确认，请刷新后重试。';}
  finally{if(token===generation){busy=false;$('browserClearConfirm').loading=false;$('browserClearConfirm').disabled=false;$('browserClearCancel').disabled=false;if(current)renderSync(current);}}
 };
 $('browserClearCancel').onclick=()=>{$('browserClearDialog').open=false;};
 $('browserClearDialog').addEventListener('wa-hide',event=>{if(event.target!==$('browserClearDialog'))return;if(busy)event.preventDefault();});
 $('browserClearDialog').addEventListener('wa-after-hide',event=>{if(event.target===$('browserClearDialog') && selection){selection=null;$('browserSiteDataDialog').open=true;}});
 $('browserManageData').onclick=()=>{$('browserSiteFilter').value='';$('browserSiteDataDialog').open=true;void refresh();};
 $('browserSiteRefresh').onclick=()=>void refresh();$('browserSiteFilter').addEventListener('input',renderList);
 $('browserClearCache').onclick=()=>confirm({kind:'cache'});$('browserClearAll').onclick=()=>confirm({kind:'all'});
 $('browserSiteClose').onclick=()=>{$('browserSiteDataDialog').open=false;};
 return {renderSync,invalidate(){siteDetailsOpen=false;generation++;listRequest++;$('browserSyncNow').loading=false;current=null;list=null;selection=null;busy=false;$('browserClearDialog').open=false;$('browserSiteDataDialog').open=false;$('browserSiteTable').replaceChildren();$('browserSyncState').textContent='正在读取同步状态';$('browserSyncTime').textContent='';$('browserSyncNow').disabled=true;},refresh};
}

// Keep exactly one network mode active, including during save and rollback.
export function mountBrowserModeSwitches({document,getMode,save,onSaved}){
 const switches=[...document.querySelectorAll('[data-browser-mode]')],status=document.getElementById('browserModeStatus');
 let pending=false;
 function render(mode=getMode()){
  for(const control of switches){control.checked=control.dataset.browserMode===(mode || 'proxy');control.disabled=pending;}
 }
 for(const control of switches)control.addEventListener('change',async()=>{
  const mode=control.dataset.browserMode;
  if(pending || !control.checked || mode===getMode()){render();return;}
  pending=true;render(mode);status.textContent='';
  try{onSaved(await save(mode));}
  catch(error){status.textContent=error.message;}
  finally{pending=false;render();}
 });
 render();return {render};
}
