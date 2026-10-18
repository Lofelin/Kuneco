import assert from 'node:assert/strict';
import {mkdir,writeFile,rm,access} from 'node:fs/promises';
import path from 'node:path';

// Original assertion IDs are retained in results.json. Everything below uses
// the already-running index.html, its renderer and its real preload/IPC bridge.
export async function verifyBrowserRegression(ctx){
 const {evaluate:e,until,client,temp,captureUI}=ctx,fixture=ctx.browserRegressionFixture;
 assert.ok(fixture,'browser regression requires controlled local HTTP/native-dialog fixtures');
 const localURL=new URL(fixture.localURL).href;
 const checks=[];
 const run=(fn,...args)=>e(`(${fn.toString()})(...${JSON.stringify(args)})`);
 const check=(id)=>{checks.push(id);console.log('PASS browser regression '+id);};
 const click=selector=>run(selector=>{const node=document.querySelector(selector);if(!node)throw Error('Missing '+selector);node.click();},selector);
 const state=()=>e('workspace.state()');
 const modal=title=>until(()=>run(title=>[...document.querySelectorAll('app-dialog')].some(d=>d.label===title&&d.open&&d.shadowRoot?.querySelector('dialog')?.matches(':modal')),title));
 const button=async(title,label)=>run((title,label)=>{const d=[...document.querySelectorAll('app-dialog')].find(d=>d.label===title&&d.open);const b=[...d.querySelectorAll('app-button')].find(b=>b.textContent.trim()===label);if(!b)throw Error('Missing '+title+': '+label);b.click();},title,label);
 const close=async title=>{await run(title=>{const d=[...document.querySelectorAll('app-dialog')].find(d=>d.label===title&&d.open);if(d)d.open=false;},title);await until(()=>run(title=>![...document.querySelectorAll('app-dialog')].some(d=>d.label===title&&d.shadowRoot?.querySelector('dialog')?.matches(':modal')),title));};
 const settings=async()=>{
  await run(()=>{document.querySelector('#accountMenu').open=true;});await click('#accountSettings');
  await until(()=>run(()=>!document.querySelector('#page-overview').classList.contains('hidden')));
  await click('[data-setting=browser]');
  await until(()=>run(()=>document.querySelector('#browserLibrarySettings')?.textContent.includes('密码管理器')&&!document.querySelector('#browserCookieMode').disabled));
 };
 const kindTitle={history:'浏览历史',bookmarks:'收藏',passwords:'密码管理器',permissions:'网站权限',agentRules:'智能体权限',extensions:'扩展程序',downloads:'下载'};
 const manager=async kind=>{
  if(['permissions','agentRules','extensions'].includes(kind)){
   await settings();
   if(kind==='extensions')await run(()=>{const group=document.querySelector('#browserAdvancedSettings');if(group.classList.contains('hidden'))group.parentElement.querySelector('app-button').click();});
   await run(kind=>{const title={permissions:'网站权限',agentRules:'智能体权限规则',extensions:'扩展程序管理器'}[kind];const row=[...document.querySelectorAll('#browserSettingsPanel .cookie-preference-row')].find(row=>row.querySelector('strong')?.textContent===title);row.querySelector('app-button').click();},kind);
  }else{
   await click('[data-page=browser]');
   await run(kind=>{const label={history:'历史记录',bookmarks:'收藏',passwords:'密码管理器',downloads:'下载'}[kind],menu=document.querySelector('#browserMoreMenu');menu.open=true;[...menu.querySelectorAll('wa-dropdown-item')].find(item=>item.textContent.trim()===label).click();},kind);
  }
  await modal(kindTitle[kind]);
 };
 const dialogMetrics=title=>run(title=>{
  const host=[...document.querySelectorAll('app-dialog')].find(d=>d.label===title&&d.open),native=host.shadowRoot.querySelector('dialog'),header=host.shadowRoot.querySelector('.header'),footer=host.shadowRoot.querySelector('.footer'),r=native.getBoundingClientRect(),f=footer.getBoundingClientRect(),style=getComputedStyle(native,'::backdrop');
  return {background:style.backgroundColor,filter:style.backdropFilter,modals:[...document.querySelectorAll('app-dialog')].filter(d=>d.shadowRoot?.querySelector('dialog')?.matches(':modal')).length,header:getComputedStyle(header).borderBottomWidth,footer:getComputedStyle(footer).borderTopWidth,left:f.left-r.left,right:r.right-f.right,width:r.width,height:r.height,within:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,table:host.querySelector('app-table')?.localName,layoutWidth:getComputedStyle(host).getPropertyValue('--width').trim(),gaps:[...(host.querySelector('.browser-data-dialog-content')?.children||[])].filter(n=>n.getBoundingClientRect().height).map(n=>n.getBoundingClientRect()).map((r,i,all)=>i?r.top-all[i-1].bottom:null).filter(v=>v!==null)};
 },title);
 const assertDialog=value=>{assert.equal(value.modals,1);assert.equal(value.background,'rgba(160, 165, 175, 0.18)');assert.equal(value.filter,'blur(4px)');assert.equal(value.header,'1px');assert.equal(value.footer,'1px');assert.ok(value.left<=1.1&&value.right<=1.1);assert.ok(value.within);};
 const buttonMetrics=ids=>run(async ids=>{
  const values=[];for(const id of ids){const b=document.getElementById(id);await b.updateComplete;const base=b.shadowRoot.querySelector('button'),r=base.getBoundingClientRect(),icon=b.querySelector('[slot=start]'),i=icon.getBoundingClientRect(),style=getComputedStyle(base),ranges=[...b.childNodes].filter(n=>n.nodeType===3?n.textContent.trim():!n.slot).map(n=>{const range=document.createRange();range.selectNodeContents(n);return range.getBoundingClientRect();}).filter(r=>r.width),left=Math.min(...ranges.map(r=>r.left)),right=Math.max(...ranges.map(r=>r.right));values.push({id,gap:left-i.right,padLeft:i.left-r.left-parseFloat(style.borderLeftWidth),padRight:r.right-right-parseFloat(style.borderRightWidth),within:right<=r.right&&r.right<=innerWidth});}return values;
 },ids);
 const assertButtons=values=>{for(const value of values){for(const key of ['gap','padLeft','padRight'])assert.ok(Math.abs(value[key]-6)<.7,JSON.stringify(value));assert.ok(value.within,JSON.stringify(value));}};
 const original={mode:(await state()).browser.mode,theme:await run(()=>document.querySelector('#themeSelect').value)};
 const output=path.resolve('artifacts/browser-regression');await mkdir(output,{recursive:true});
 await settings();

 // BS-01: real network switches, including a genuine disk-write failure.
 const selectMode=mode=>run(mode=>{const node=document.querySelector(`[data-browser-mode="${mode}"]`);node.checked=!node.checked;node.dispatchEvent(new Event('change'));return {selected:[...document.querySelectorAll('[data-browser-mode]')].filter(c=>c.checked).map(c=>c.dataset.browserMode),disabled:[...document.querySelectorAll('[data-browser-mode]')].every(c=>c.disabled)};},mode);
 const waitMode=mode=>until(async()=>!(await run(()=>document.querySelector('[data-browser-mode]').disabled))&&(await state()).browser.mode===mode);
 try{
  if(original.mode!=='mixed'){await selectMode('mixed');await waitMode('mixed');}
  assert.deepEqual((await selectMode('mixed')).selected,['mixed']);
  assert.deepEqual(await selectMode('direct'),{selected:['direct'],disabled:true});await waitMode('direct');
  const fault=path.join(temp,'browser-preferences.json.tmp');await mkdir(fault);
  try{await selectMode('proxy');await until(()=>run(()=>!document.querySelector('[data-browser-mode]').disabled&&!!document.querySelector('#browserModeStatus').textContent));assert.equal((await state()).browser.mode,'direct');assert.deepEqual(await run(()=>[...document.querySelectorAll('[data-browser-mode]')].filter(c=>c.checked).map(c=>c.dataset.browserMode)),['direct']);}
  finally{await rm(fault,{recursive:true,force:true});}
  for(const mode of ['proxy','mixed','direct']){await selectMode(mode);await waitMode(mode);}
  check('BS-01 modes-exclusive/pending/cannot-disable/real-failure-rollback/all-three');

  // BL-01/02: grouping remains unique after actual settings refreshes.
  await settings();await settings();
  const grouping=await run(()=>[...document.querySelectorAll('#browserSettingsPanel .cookie-preference-row')].map(row=>({title:row.querySelector('strong')?.textContent,group:row.closest('section')?.querySelector('h2')?.textContent.trim()})));
  assert.equal(await run(()=>document.querySelector('#browserSettingsPanel > section h2').firstChild.textContent.trim()),'常规');assert.equal(await run(()=>getComputedStyle(document.querySelector('#browserSettingsPanel > section')).marginTop),'0px');
  for(const [title,group] of [['导入 Cookie','Cookie'],['密码管理器','密码'],['允许智能体使用浏览器','权限'],['智能体访问浏览历史','权限'],['启用站点工具','高级'],['网站权限','权限'],['智能体权限规则','权限'],['已记录站点','数据']]){const rows=grouping.filter(row=>row.title===title);assert.equal(rows.length,1,title);assert.ok(rows[0].group.startsWith(group));}
  for(const title of ['显示完整网址','收藏','批注截图','联系信息','导入密码','浏览历史','下载历史记录'])assert.equal(grouping.some(row=>row.title===title),false);
  assert.equal(await run(()=>document.querySelector('#browserAdvancedSettings').classList.contains('hidden')),true);
  await run(()=>document.querySelector('#browserAdvancedSettings').parentElement.querySelector('app-button').click());await settings();assert.equal(await run(()=>document.querySelector('#browserAdvancedSettings').classList.contains('hidden')),false);
  check('BL-01 groups/no-duplicate-rows; BL-02 advanced-expansion-survives-refresh');

  // The native file dialog alone is deterministic; the real IPC performs import
  // and save. No workspace API, feature module or application DOM is replaced.
  const downloadPath=path.join(temp,'chosen-downloads');await mkdir(downloadPath);
  const oldDownload=(await e("workspace.browserLibrary('get')")).settings.downloadPath;
  const beforeNative=(await fixture.refreshNativeDialogRequests()).length;
  await fixture.setNativeDialogResult({canceled:true,filePaths:[]});
  await run(()=>document.querySelector('[data-download-change]').click());await until(async()=>(await fixture.refreshNativeDialogRequests()).length>beforeNative);assert.equal((await e("workspace.browserLibrary('get')")).settings.downloadPath,oldDownload);
  await fixture.setNativeDialogResult({canceled:false,filePaths:[downloadPath]});await run(()=>document.querySelector('[data-download-change]').click());
  await until(async()=>(await e("workspace.browserLibrary('get')")).settings.downloadPath===downloadPath);
  assert.ok((await fixture.refreshNativeDialogRequests()).at(-1).properties.includes('openDirectory'));
  check('BL-03 native-download-picker/cancel/save; container-initial-path-not-applicable-to-local');
  const cookiesFile=path.join(temp,'browser-regression-cookies.json');
  await writeFile(cookiesFile,JSON.stringify(Array.from({length:31},(_,i)=>({domain:`site-${String(i).padStart(2,'0')}.example.test`,name:'regression',value:'fixture-only',path:'/',session:true,hostOnly:true}))));
  await fixture.setNativeDialogResult({canceled:false,filePaths:[cookiesFile]});await e("workspace.browserLibrary('importCookies')");
  const imported=await e("workspace.browserData('list')");assert.equal(imported.sites.filter(s=>s.domain.endsWith('.example.test')).length,31);

  // BS-02 sync local/loading/error/retry through the real cookie service.
  await run(()=>{document.querySelector('#browserCookieMode').value='local';document.querySelector('#browserCookieMode').dispatchEvent(new Event('change'));});await until(()=>run(()=>!document.querySelector('#browserCookieMode').disabled));
  assert.equal(await run(()=>document.querySelector('#browserSyncNow').disabled),true);assert.equal(await run(()=>document.querySelector('#browserSyncState').textContent),'仅保存在本设备');
  await fixture.setCookieResponse({defer:false,failGet:false,failPut:false});
  await run(()=>{document.querySelector('#browserCookieMode').value='account';document.querySelector('#browserCookieMode').dispatchEvent(new Event('change'));});
  await until(()=>run(()=>document.querySelector('#browserSyncState').textContent==='已同步'&&!document.querySelector('#browserCookieMode').disabled));
  const beforeAccountSync=fixture.cookieRequests.length;
  await fixture.setCookieResponse({defer:true,failGet:false,failPut:false});await click('#browserSyncNow');
  await until(()=>fixture.cookieRequests.length>beforeAccountSync);
  assert.equal(await run(()=>document.querySelector('#browserSyncNow').disabled&&document.querySelector('#browserSyncNow').loading),true);
  await fixture.setCookieResponse({defer:false,failGet:false,failPut:false});await fixture.releaseCookies();
  await until(()=>run(()=>document.querySelector('#browserSyncState').textContent==='已同步'&&!document.querySelector('#browserCookieMode').disabled&&!document.querySelector('#browserSyncNow').loading));
  await fixture.setCookieResponse({defer:false,failGet:true,failPut:false});await click('#browserSyncNow');
  await until(()=>run(()=>document.querySelector('#browserSyncNow').textContent.includes('重试同步')&&!!document.querySelector('#browserCookieSettingsStatus').textContent));
  await fixture.setCookieResponse({defer:false,failGet:false,failPut:false});await click('#browserSyncNow');await until(()=>run(()=>document.querySelector('#browserSyncState').textContent==='已同步'&&!document.querySelector('#browserSyncNow').disabled));
  await click('#browserManageData');await modal('数据');
  const beforeSync=fixture.cookieRequests.length;await fixture.setCookieResponse({defer:true,failGet:false,failPut:false});
  // Temporarily close the manager to activate the real settings sync button,
  // then refresh the site manager concurrently with that pending IPC.
  await close('数据');await click('#browserSyncNow');await until(()=>fixture.cookieRequests.length>beforeSync);await click('#browserManageData');await modal('数据');
  await fixture.setCookieResponse({defer:false,failGet:false,failPut:false});await fixture.releaseCookies();
  await until(()=>run(()=>!document.querySelector('#browserSyncNow').disabled&&!document.querySelector('#browserCookieMode').disabled));await click('#browserSiteRefresh');await until(()=>run(()=>document.querySelectorAll('#browserSiteTable tbody tr').length>=31&&!document.querySelector('#browserSiteRefresh').disabled));
  check('BS-02 local/loading/error/retry/concurrent-refresh-releases-controls');

  // BS-03/04: real imported Cookie sites, keyboard activation and menu isolation.
  const search=await run(()=>{const table=document.querySelector('#browserSiteTable'),count=table.querySelectorAll('tbody tr').length;document.querySelector('#browserSiteFilter').value='missing-regression';document.querySelector('#browserSiteFilter').dispatchEvent(new Event('input'));const empty=table.textContent;document.querySelector('#browserSiteFilter').value='';document.querySelector('#browserSiteFilter').dispatchEvent(new Event('input'));return {count,empty,tag:table.localName,nativeButtons:table.querySelectorAll('button,wa-button').length,actions:table.querySelectorAll('app-button').length};});
  assert.ok(search.count>=31);assert.match(search.empty,/没有匹配的站点/);assert.equal(search.tag,'app-table');assert.equal(search.nativeButtons,0);assert.equal(search.actions,search.count);
  for(const method of ['click','Enter',' ']){
   await run(method=>{const row=[...document.querySelectorAll('#browserSiteTable tbody tr')].find(row=>row.textContent.includes('site-00.example.test'));if(method==='click')row.querySelector('td').click();else row.dispatchEvent(new KeyboardEvent('keydown',{key:method,bubbles:true}));},method);
   await modal('Cookie · site-00.example.test');assert.equal((await dialogMetrics('Cookie · site-00.example.test')).modals,1);
   await click('#closeBrowserCookies');await modal('数据');
  }
  await run(()=>document.querySelector('#browserSiteTable .app-table-actions').dispatchEvent(new MouseEvent('click',{bubbles:true})));assert.equal(await run(()=>document.querySelector('#browserSiteDataDialog').open),true);assert.equal(await run(()=>document.querySelector('#browserCookiesDialog').open),false);
  assert.equal((await e("workspace.browserData('list')")).sites.filter(s=>s.domain.endsWith('.example.test')).length,31);
  check('BS-03 app-table/search/actions; BS-04 click-enter-space/detail-return/single-modal/menu-isolation');

  // A failed cloud deletion must retain every local test Cookie.
  await fixture.setCookieResponse({defer:false,failGet:false,failPut:true});await click('#browserClearAll');await modal('清理站点数据');await click('#browserClearConfirm');
  await until(()=>run(()=>document.querySelector('#browserClearStatus').textContent.includes('清理未完成')&&!document.querySelector('#browserClearConfirm').disabled));
  assert.equal((await e("workspace.browserData('list')")).sites.filter(s=>s.domain.endsWith('.example.test')).length,31);
  await fixture.setCookieResponse({defer:false,failGet:false,failPut:false});await click('#browserClearCancel');await modal('数据');await close('数据');
  check('BS-05 failed-cloud-clear-preserves-local-data-and-unlocks-cancel');

  // Password import is real vault storage; no secret is printed in artifacts.
  const passwordsFile=path.join(temp,'browser-regression-passwords.csv');await writeFile(passwordsFile,'url,username,password\nhttps://import.example.test,import-user,fixture-import-only\n');
  await manager('passwords');await fixture.setNativeDialogResult({canceled:false,filePaths:[passwordsFile]});await button('密码管理器','导入密码');
  await until(async()=>(await e("workspace.browserLibrary('get')")).passwords.some(p=>p.username==='import-user'));await close('密码管理器');check('BL-04 import-passwords-through-real-vault');

  for(const width of [1400,1050])for(const dark of [false,true]){
   await client.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
   await run(dark=>{document.querySelector('#themeSelect').value=dark?'dark':'light';document.querySelector('#themeSelect').dispatchEvent(new Event('change'));},dark);
   await settings();
   const spacing=await run(()=>[...document.querySelectorAll('#browserSettingsPanel section')].map(section=>{const h=section.querySelector('.preference-heading'),p=section.querySelector('.settings-section-description'),g=section.querySelector('.preference-group');return h&&g?{heading:p?p.getBoundingClientRect().top-h.getBoundingClientRect().bottom:null,content:g.getBoundingClientRect().top-(p||h).getBoundingClientRect().bottom}:null;}).filter(Boolean));
   for(const s of spacing){if(s.heading!==null)assert.ok(Math.abs(s.heading-4)<.7,JSON.stringify(s));assert.ok(Math.abs(s.content-8)<.7,JSON.stringify(s));}
   assertButtons(await buttonMetrics(['browserSyncNow','browserManageData']));
   for(const kind of Object.keys(kindTitle)){await manager(kind);const value=await dialogMetrics(kindTitle[kind]);assertDialog(value);assert.equal(value.table,'app-table');assert.equal(value.layoutWidth,'640px');for(const gap of value.gaps)assert.ok(Math.abs(gap-12)<.7,JSON.stringify({kind,gap}));await close(kindTitle[kind]);}
   await settings();await click('#browserManageData');await modal('数据');
   const site=await dialogMetrics('数据');assertDialog(site);assert.ok(site.height<650);
   const layout=await run(()=>{const table=document.querySelector('#browserSiteTable');return {height:table.getBoundingClientRect().height,scrolls:table.scrollHeight>table.clientHeight,singleParagraph:document.querySelector('#browserSiteStatus').parentElement===document.querySelector('#browserCacheSize').parentElement&&document.querySelector('#browserSiteStatus').parentElement.tagName==='P',footer:[...document.querySelector('#browserSiteDataDialog [slot=footer]').children].map(n=>n.id)};});assert.ok(layout.height<=320.6);assert.equal(layout.scrolls,true);assert.equal(layout.singleParagraph,true);assert.deepEqual(layout.footer,['browserSiteClose','browserClearCache','browserClearAll']);
   assertButtons(await buttonMetrics(['browserSiteRefresh','browserClearCache','browserClearAll','browserSiteClose']));
   const before=(await e("workspace.browserData('list')")).sites.length;await click('#browserClearAll');await modal('清理站点数据');assertDialog(await dialogMetrics('清理站点数据'));assertButtons(await buttonMetrics(['browserClearCancel','browserClearConfirm']));await click('#browserClearCancel');await modal('数据');assert.equal((await e("workspace.browserData('list')")).sites.length,before);
   const screenshot=await captureUI();await writeFile(path.join(output,`${dark?'dark':'light'}-${width}.png`),Buffer.from(screenshot.data,'base64'));await close('数据');
  }
  check('BL-05 seven-managers/app-table/12px/bounds; BS-06 site-scroll/footer/4-8px/6px/buttons/backdrop/cancel/light-dark-supported-widths');

  await client.call('Emulation.clearDeviceMetricsOverride');await run(()=>{document.querySelector('#themeSelect').value='light';document.querySelector('#themeSelect').dispatchEvent(new Event('change'));});
  await manager('passwords');await button('密码管理器','添加');await modal('添加密码');
  const visual=await run(()=>{const d=[...document.querySelectorAll('app-dialog')].find(d=>d.label==='添加密码'&&d.open);return {labels:[...d.querySelectorAll('wa-input')].map(field=>({display:getComputedStyle(field.shadowRoot.querySelector('[part~=label]')).display,height:field.shadowRoot.querySelector('[part~=label]').getBoundingClientRect().height})),save:getComputedStyle([...d.querySelectorAll('app-button')].find(b=>b.textContent.trim()==='保存').shadowRoot.querySelector('button')).backgroundColor};});assert.ok(visual.labels.every(l=>l.display!=='none'&&l.height>0));assert.equal(visual.save,'rgb(32, 33, 39)');
  await run(()=>{const d=[...document.querySelectorAll('app-dialog')].find(d=>d.label==='添加密码'&&d.open);for(const [label,value] of [['网站地址','https://example.test'],['用户名','fixture-user'],['密码','fixture-input']])[...d.querySelectorAll('wa-input')].find(f=>f.label===label).value=value;});await button('添加密码','保存');await modal('密码管理器');
  const saved=(await e("workspace.browserLibrary('get')")).passwords.find(p=>p.username==='fixture-user');assert.ok(saved);assert.equal(saved.origin,'https://example.test');assert.equal(Object.hasOwn(saved,'password'),false);
  await run(()=>{const d=[...document.querySelectorAll('app-dialog')].find(d=>d.label==='密码管理器'&&d.open),row=[...d.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('fixture-user'));row.querySelector('wa-dropdown').open=true;[...row.querySelectorAll('wa-dropdown-item')].find(item=>item.textContent.trim()==='查看密码').click();});await modal('查看密码');
  assert.deepEqual(await run(()=>{const d=[...document.querySelectorAll('app-dialog')].find(d=>d.label==='查看密码'&&d.open),f=d.querySelector('wa-input');return {type:f.type,value:f.value??''};}),{type:'password',value:''});await button('查看密码','显示密码');await until(()=>run(()=>[...document.querySelectorAll('app-dialog')].find(d=>d.label==='查看密码'&&d.open)?.querySelector('wa-input').value==='fixture-input'));
  await button('查看密码','返回');await modal('密码管理器');assert.equal(await run(()=>[...document.querySelectorAll('app-dialog')].find(d=>d.label==='查看密码')?.querySelector('wa-input')?.value), '');await close('密码管理器');check('BL-06 password-labels/primary/payload/no-eager-secret/reveal/clear-on-return');

  await manager('permissions');await button('网站权限','添加');await modal('添加网站权限');await run(()=>{const d=[...document.querySelectorAll('app-dialog')].find(d=>d.label==='添加网站权限'&&d.open);d.querySelector('wa-input').value='https://example.test';const fields=[...d.querySelectorAll('wa-select')];fields[0].value='media-microphone';fields[1].value='block';for(const f of fields)f.dispatchEvent(new Event('change'));});await button('添加网站权限','保存');await modal('网站权限');const permission=(await e("workspace.browserLibrary('get')")).permissions.find(p=>p.origin==='https://example.test'&&p.permission==='media-microphone');assert.equal(permission.value,'block');await close('网站权限');check('BL-07 permission-selected-values-persist-through-real-IPC');

  const connection=await e(`workspace.connect(${JSON.stringify({protocol:'http',host:'127.0.0.1',port:ctx.proxyPort,username:'demo',password:'secret'})},false)`);assert.equal(connection.state,'ready');
  await e("workspace.browserSettings('proxy')");await click('[data-page=browser]');await e(`workspace.browser('navigate',${JSON.stringify(localURL)})`);await until(async()=>(await e("workspace.browserLibrary('get')")).history.some(h=>h.url===localURL));
  await manager('history');await run(url=>{const d=[...document.querySelectorAll('app-dialog')].find(d=>d.label==='浏览历史'&&d.open),row=[...d.querySelectorAll('tbody tr')].find(row=>row.textContent.includes(url));row.querySelector('td').click();},localURL);await until(()=>run(()=>![...document.querySelectorAll('app-dialog')].some(d=>d.shadowRoot?.querySelector('dialog')?.matches(':modal'))));await until(async()=>{const navigated=await state();return navigated.browser.tabs.find(t=>t.id===navigated.browser.activeId)?.url===localURL;});check('BL-08 history-row-closes-dialog-before-real-navigation');
  await settings();await run(()=>{const row=[...document.querySelectorAll('#browserSiteDataGroup .cookie-preference-row')].find(row=>row.querySelector('strong')?.textContent==='清除浏览数据');row.querySelector('app-button').click();});await modal('清除浏览数据');await button('清除浏览数据','取消');await until(()=>run(()=>![...document.querySelectorAll('app-dialog')].some(d=>d.label==='清除浏览数据'&&d.open)));assert.ok((await e("workspace.browserLibrary('get')")).history.length);
  await run(()=>{const row=[...document.querySelectorAll('#browserSiteDataGroup .cookie-preference-row')].find(row=>row.querySelector('strong')?.textContent==='清除浏览数据');row.querySelector('app-button').click();});await modal('清除浏览数据');
  const clearVisual=await run(async()=>{const d=[...document.querySelectorAll('app-dialog')].find(d=>d.label==='清除浏览数据'&&d.open),checks=[...d.querySelectorAll('wa-checkbox')];checks[0].checked=true;checks[2].checked=true;await Promise.all(checks.map(c=>c.updateComplete));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await new Promise(resolve=>setTimeout(resolve,180));return {fill:getComputedStyle(checks[0].shadowRoot.querySelector('[part~=control]')).backgroundColor,width:d.shadowRoot.querySelector('dialog').getBoundingClientRect().width,selection:checks.map(c=>c.checked)};});assert.equal(clearVisual.width,480);assert.equal(clearVisual.fill,'rgb(32, 33, 39)');assert.deepEqual(clearVisual.selection,[true,false,true,false]);await button('清除浏览数据','确认清除');await until(async()=>(await e("workspace.browserLibrary('get')")).history.length===0);assert.equal((await e("workspace.browserData('list')")).sites.filter(s=>s.domain.endsWith('.example.test')).length,31);check('BL-09 clear-browsing-cancel/480px/selected-history-cache-only/preserves-cookies');
  const icons=await run(()=>[...document.querySelectorAll('#browserMoreMenu wa-icon')].map(i=>i.src||i.getAttribute('src')));for(const icon of icons)await access(path.resolve('src',icon));check('BL-10 toolbar-menu-icon-assets');
  await writeFile(path.join(output,'results.json'),JSON.stringify({pass:true,source:'real index.html renderer/preload/IPC',checks,widths:[1400,1050],themes:['light','dark'],localFixtureOnly:true},null,2));
 }finally{
  await fixture.setCookieResponse({defer:false,failGet:false,failPut:false});await fixture.releaseCookies();
  await client.call('Emulation.clearDeviceMetricsOverride');
  await run(theme=>{for(const d of document.querySelectorAll('app-dialog'))if(d.open)d.open=false;document.querySelector('#themeSelect').value=theme;document.querySelector('#themeSelect').dispatchEvent(new Event('change'));},original.theme);
 }
 console.log('PASS complete browser library/settings regression on real Kuneco application');
}

// Call while the suite's disposable Docker environment is selected. Exercise
// both the mounted settings directory browser and the alternate IPC prompt.
export async function verifyContainerBrowserRegression(ctx){
 const {evaluate:e,until}=ctx;
 const run=(fn,...args)=>e(`(${fn.toString()})(...${JSON.stringify(args)})`);
 assert.ok((await e('workspace.state()')).containerId,'container picker regression requires the suite disposable environment');
 const original=(await e("workspace.browserLibrary('get')")).settings.downloadPath;
 const open=async()=>{
  await e("void workspace.browserLibrary('chooseDownloadPath')");
  await until(()=>run(()=>[...document.querySelectorAll('app-dialog')].some(d=>d.label==='下载保存位置'&&d.open&&d.shadowRoot?.querySelector('dialog')?.matches(':modal'))));
 };
 const field=()=>run(()=>[...document.querySelectorAll('app-dialog')].find(d=>d.label==='下载保存位置'&&d.open).querySelector('wa-input').value);
 const button=label=>run(label=>{const d=[...document.querySelectorAll('app-dialog')].find(d=>d.label==='下载保存位置'&&d.open);[...d.querySelectorAll('app-button')].find(b=>b.textContent.trim()===label).click();},label);
 const closed=()=>until(()=>run(()=>![...document.querySelectorAll('app-dialog')].some(d=>d.label==='下载保存位置'&&d.shadowRoot?.querySelector('dialog')?.matches(':modal'))));
 try{
  await e("workspace.browserLibrary('settings',{downloadPath:'/tmp'})");
  // The mounted settings page receives chooseDownloadDirectory from renderer;
  // this primary path must use its real container directory browser.
  await run(()=>{document.querySelector('#accountMenu').open=true;document.querySelector('#accountSettings').click();document.querySelector('[data-setting=browser]').click();});
  await until(()=>run(()=>document.querySelector('#browserLibrarySettings').textContent.includes('/tmp')));
  await run(()=>document.querySelector('[data-download-change]').click());
  await until(()=>run(()=>document.querySelector('#filePicker').open&&!document.querySelector('#filePickerConfirm').disabled));
  assert.equal(await run(()=>document.querySelector('#filePickerPath').value),'/tmp');
  await run(()=>document.querySelector('#filePickerCancel').click());
  await until(()=>run(()=>!document.querySelector('#filePicker').open));
  assert.equal((await e("workspace.browserLibrary('get')")).settings.downloadPath,'/tmp');
  await run(()=>document.querySelector('[data-download-change]').click());
  await until(()=>run(()=>document.querySelector('#filePicker').open));
  assert.equal(await run(()=>document.querySelector('#filePickerPath').value),'/tmp');
  await run(()=>{document.querySelector('#filePickerPath').value='/';document.querySelector('#filePickerGo').click();});
  await until(()=>run(()=>document.querySelector('#filePickerPath').value==='/'&&!document.querySelector('#filePickerConfirm').disabled));
  await run(()=>document.querySelector('#filePickerConfirm').click());
  await until(async()=>(await e("workspace.browserLibrary('get')")).settings.downloadPath==='/');
  console.log('PASS browser regression BL-03-container-ui: real settings directory picker initial path, cancel unchanged, selected directory persisted');
  // Also exercise the alternate privileged IPC entry independently.
  await e("workspace.browserLibrary('settings',{downloadPath:'/tmp'})");
  await open();assert.equal(await field(),'/tmp');await button('取消');await closed();
  assert.equal((await e("workspace.browserLibrary('get')")).settings.downloadPath,'/tmp');
  await open();assert.equal(await field(),'/tmp');
  await run(()=>{const d=[...document.querySelectorAll('app-dialog')].find(d=>d.label==='下载保存位置'&&d.open);d.querySelector('wa-input').value='/';});
  await button('确认');await closed();
  await until(async()=>(await e("workspace.browserLibrary('get')")).settings.downloadPath==='/');
  console.log('PASS browser regression BL-03-container: real IPC path prompt initial path, cancel unchanged, selected directory persisted');
 }finally{await e(`workspace.browserLibrary('settings',{downloadPath:${JSON.stringify(original)}})`);}
}
