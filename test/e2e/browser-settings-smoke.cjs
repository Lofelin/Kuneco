// Isolated real-component fixture; no account, network, or user-data mutation.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
app.on('window-all-closed',()=>{});
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kuneco-browser-settings-'));app.setPath('userData',dir);await app.whenReady();let win;
 try{
  const src=path.resolve(__dirname,'../../src');let html=await fs.readFile(path.join(src,'index.html'),'utf8');html=html.replace('<head>','<head><base href="file://'+src+'/">').replace('src="app/renderer.js"','src="vendor/ui.js"');await fs.writeFile(path.join(dir,'fixture.html'),html);
  win=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{contextIsolation:true}});await win.loadFile(path.join(dir,'fixture.html'));
  const evaluate=code=>win.webContents.executeJavaScript(code);
  await evaluate(`(async()=>{
   await Promise.all(['app-button','app-dialog','wa-input','wa-select','wa-switch'].map(x=>customElements.whenDefined(x)));
   const {mountBrowserSettings,mountBrowserModeSwitches}=await import(${JSON.stringify('file://'+src+'/features/browser/browser-settings.mjs')});
   window.mountBrowserModeSwitches=mountBrowserModeSwitches;
   window.$=id=>document.getElementById(id);window.dialogSettled=new Map();
   for(const id of ['browserSiteDataDialog','browserClearDialog','browserCookiesDialog']){const d=$(id);dialogSettled.set(id,false);d.addEventListener('wa-after-show',e=>{if(e.target===d)dialogSettled.set(id,true)});d.addEventListener('wa-after-hide',e=>{if(e.target===d)dialogSettled.set(id,false)});}
   window.waitDialog=(id,open)=>new Promise((resolve,reject)=>{const d=$(id);const ready=()=>d.open===open&&Boolean(d.shadowRoot.querySelector('dialog')?.matches(':modal'))===open&&dialogSettled.get(id)===open;let timer,deadline;const clean=()=>{clearInterval(timer);clearTimeout(deadline);d.removeEventListener('wa-after-show',check);d.removeEventListener('wa-after-hide',check)};const check=()=>{if(ready()){clean();resolve()}};d.addEventListener('wa-after-show',check);d.addEventListener('wa-after-hide',check);timer=setInterval(check,20);deadline=setTimeout(()=>{clean();reject(Error('Dialog transition timeout: '+id+' open='+open))},5000);check()});
   document.body.classList.remove('auth-pending','auth-mode','environment-onboarding');document.querySelectorAll('.page,.settings-panel').forEach(p=>p.classList.add('hidden'));let p=$('browserSettingsPanel');while(p&&p!==document.body){p.classList.remove('hidden');p=p.parentElement;}
   $('browserSiteFilter').value='';window.scope={owner:'fixture',environmentId:'env',label:'测试环境'};
   window.value={...scope,settings:{mode:'account'},sync:{state:'synced',lastSuccessAt:'2026-10-17T12:00:00Z',error:''}};
   window.calls=[];window.deferSync=false;
   window.api={browserData:async(action)=>{calls.push(action);if(action==='sync'&&deferSync)return new Promise(resolve=>window.finishSync=()=>resolve(structuredClone(value)));return {...structuredClone(value),sites:Array.from({length:31},(_,i)=>({domain:'site-'+i+'.example.test',cookies:2,origins:['https://site-'+i+'.example.test']})),cacheBytes:1024};},verify:async()=>{},state:async()=>({browser:{mode:'direct'}})};
   window.view=mountBrowserSettings({document,api,getScope:()=>scope,getNetwork:()=>({mode:'direct',status:{state:'ready'},allowed:true}),formatDate:x=>x,onOpenSite:domain=>{window.openedSite=domain;$('browserCookiesDialog').open=true;}});
   window.buttonMetrics=async id=>{const b=$(id);await b.updateComplete;const base=b.shadowRoot.querySelector('button'),br=base.getBoundingClientRect(),icon=b.querySelector('[slot=start]'),ir=icon.getBoundingClientRect();const ranges=[...b.childNodes].filter(n=>n.nodeType===3?n.textContent.trim():!n.slot).map(n=>{const r=document.createRange();r.selectNodeContents(n);return r.getBoundingClientRect()}).filter(r=>r.width);const left=Math.min(...ranges.map(r=>r.left)),right=Math.max(...ranges.map(r=>r.right));const cs=getComputedStyle(base);return {id,gap:left-ir.right,padLeft:ir.left-br.left-parseFloat(cs.borderLeftWidth),padRight:br.right-right-parseFloat(cs.borderRightWidth),within:right<=br.right&&br.right<=innerWidth};};
   window.dialogMetrics=id=>{const host=$(id),d=host.shadowRoot.querySelector('dialog'),footer=host.shadowRoot.querySelector('.footer'),header=host.shadowRoot.querySelector('.header'),r=d.getBoundingClientRect(),f=footer.getBoundingClientRect(),h=header.getBoundingClientRect(),back=getComputedStyle(d,'::backdrop');return {background:back.backgroundColor,filter:back.backdropFilter,modals:[...document.querySelectorAll('app-dialog')].filter(x=>x.shadowRoot.querySelector('dialog')?.matches(':modal')).length,footer:getComputedStyle(footer).borderTopWidth,header:getComputedStyle(header).borderBottomWidth,footerInset:f.left-r.left,footerRight:r.right-f.right};};
  })()`);
  const modes=await evaluate(`(async()=>{
   let mode='mixed',reject=false,release;const saves=[];
   const controls=[...document.querySelectorAll('[data-browser-mode]')];
   const view=mountBrowserModeSwitches({document,getMode:()=>mode,save:value=>{saves.push(value);return new Promise((resolve,rejectSave)=>release=()=>reject?rejectSave(Error('保存失败')):resolve({mode:value}));},onSaved:value=>mode=value.mode});
   const snapshot=()=>controls.filter(x=>x.checked).map(x=>x.dataset.browserMode);
   const initial=snapshot();const toggle=value=>{const c=controls.find(x=>x.dataset.browserMode===value);c.checked=!c.checked;c.dispatchEvent(new Event('change'));};
   toggle('mixed');const cannotDisable=snapshot();
   toggle('direct');const pending={selected:snapshot(),disabled:controls.every(x=>x.disabled)};release();await Promise.resolve();await Promise.resolve();const success=snapshot();
   reject=true;toggle('proxy');release();await Promise.resolve();await Promise.resolve();const rollback={selected:snapshot(),error:$('browserModeStatus').textContent,enabled:controls.every(x=>!x.disabled)};
   reject=false;for(const next of ['proxy','mixed']){toggle(next);release();await Promise.resolve();await Promise.resolve();}
   return {initial,cannotDisable,pending,success,rollback,final:snapshot(),saves};
  })()`);
  assert.deepEqual(modes.initial,['mixed']);assert.deepEqual(modes.cannotDisable,['mixed']);assert.deepEqual(modes.pending,{selected:['direct'],disabled:true});assert.deepEqual(modes.success,['direct']);assert.deepEqual(modes.rollback,{selected:['direct'],error:'保存失败',enabled:true});assert.deepEqual(modes.final,['mixed']);assert.deepEqual(modes.saves,['direct','proxy','proxy','mixed']);
  console.log('PASS mutually exclusive switches, all three modes, cannot disable sole selection, pending lock, failure rollback');
  const states=await evaluate(`(async()=>{
   const results=[];for(const [mode,state,error]of [['local','local',''],['account','syncing',''],['account','error','连接失败']]){view.renderSync({...value,settings:{mode},sync:{state,error}});results.push({disabled:$('browserSyncNow').disabled,loading:$('browserSyncNow').loading,text:$('browserSyncState').textContent,label:$('browserSyncNow').textContent,error:$('browserCookieSettingsStatus').textContent});}
   await $('browserSyncNow').onclick();results.push({disabled:$('browserSyncNow').disabled,text:$('browserSyncState').textContent});
   deferSync=true;const pending=$('browserSyncNow').onclick();await view.refresh();finishSync();await pending;results.push({disabled:$('browserSyncNow').disabled,modeDisabled:$('browserCookieMode').disabled});deferSync=false;return results;
  })()`);
  assert.equal(states[0].disabled,true);assert.equal(states[0].text,'仅保存在本设备');assert.equal(states[1].loading,true);assert.equal(states[1].disabled,true);assert.match(states[2].label,/重试同步/);assert.equal(states[2].error,'连接失败');assert.equal(states[3].text,'已同步');assert.equal(states[3].disabled,false);assert.equal(states[4].disabled,false);assert.equal(states[4].modeDisabled,false);
  console.log('PASS sync local/loading/error/retry and concurrent list refresh');
  const search=await evaluate(`(async()=>{$('browserSiteDataDialog').open=true;await view.refresh();await waitDialog('browserSiteDataDialog',true);const table=$('browserSiteTable');const count=table.querySelectorAll('tbody tr').length;$('browserSiteFilter').value='missing';$('browserSiteFilter').dispatchEvent(new Event('input'));const empty=table.textContent;$('browserSiteFilter').value='';$('browserSiteFilter').dispatchEvent(new Event('input'));return {count,empty,tag:table.localName,nativeButtons:table.querySelectorAll('button,wa-button').length,actions:table.querySelectorAll('app-button').length};})()`);
  assert.equal(search.count,31);assert.match(search.empty,/没有匹配的站点/);assert.equal(search.tag,'app-table');assert.equal(search.nativeButtons,0);assert.equal(search.actions,31);
  const activation=await evaluate(`(async()=>{
   const results=[];
   for(const method of ['click','Enter',' ']){
    const row=$('browserSiteTable').querySelector('tbody tr');openedSite=null;
    if(method==='click')row.querySelector('td').click();else row.dispatchEvent(new KeyboardEvent('keydown',{key:method,bubbles:true}));
    await waitDialog('browserSiteDataDialog',false);await waitDialog('browserCookiesDialog',true);
    results.push({domain:openedSite,modals:dialogMetrics('browserCookiesDialog').modals});
    $('browserCookiesDialog').open=false;await waitDialog('browserCookiesDialog',false);await waitDialog('browserSiteDataDialog',true);
   }
   openedSite=null;const row=$('browserSiteTable').querySelector('tbody tr');row.querySelector('.app-table-actions').dispatchEvent(new MouseEvent('click',{bubbles:true}));
   return {results,isolated:openedSite===null&&$('browserSiteDataDialog').open,clears:calls.filter(x=>x==='clear').length};
  })()`);
  assert.deepEqual(activation.results,Array.from({length:3},()=>({domain:'site-0.example.test',modals:1})));assert.equal(activation.isolated,true);assert.equal(activation.clears,0);console.log('PASS site row click/Enter/Space, detail return, one backdrop, action isolation, no deletion');
  for(const width of [1400,900]){win.setSize(width,1000);for(const dark of [false,true]){
   const metrics=await evaluate(`(async()=>{document.documentElement.classList.toggle('wa-dark',${dark});document.body.classList.toggle('dark',${dark});$('browserSiteDataDialog').open=false;await waitDialog('browserSiteDataDialog',false);const sections=[...$('browserSettingsPanel').children].map(s=>{const h=s.querySelector('.preference-heading'),p=s.querySelector('.settings-section-description');return {heading:p.getBoundingClientRect().top-h.getBoundingClientRect().bottom,content:p.nextElementSibling.getBoundingClientRect().top-p.getBoundingClientRect().bottom}});const buttons=[];for(const id of ['browserSyncNow','browserManageData'])buttons.push(await buttonMetrics(id));$('browserSiteDataDialog').open=true;await waitDialog('browserSiteDataDialog',true);for(const id of ['browserSiteRefresh','browserClearCache','browserClearAll','browserSiteClose'])buttons.push(await buttonMetrics(id));const table=$('browserSiteTable'),status=$('browserSiteStatus').getBoundingClientRect(),cache=$('browserCacheSize').getBoundingClientRect();return {sections,buttons,dialog:dialogMetrics('browserSiteDataDialog'),layout:{height:$('browserSiteDataDialog').shadowRoot.querySelector('dialog').getBoundingClientRect().height,tableHeight:table.getBoundingClientRect().height,scrolls:table.scrollHeight>table.clientHeight,singleParagraph:$('browserSiteStatus').parentElement===$('browserCacheSize').parentElement && $('browserSiteStatus').parentElement.tagName==='P',footer:[...$('browserSiteDataDialog').querySelector('[slot=footer]').children].map(x=>x.id)}};})()`);
   assert.ok(metrics.layout.height<650,JSON.stringify(metrics.layout));assert.ok(metrics.layout.tableHeight<=320.6);assert.equal(metrics.layout.scrolls,true);assert.equal(metrics.layout.singleParagraph,true);assert.deepEqual(metrics.layout.footer,['browserSiteClose','browserClearCache','browserClearAll']);
   for(const item of metrics.sections){assert.ok(Math.abs(item.heading-4)<0.6,JSON.stringify({width,dark,item}));assert.ok(Math.abs(item.content-8)<0.6,JSON.stringify({width,dark,item}));}
   for(const item of metrics.buttons){assert.ok(Math.abs(item.gap-6)<0.6,JSON.stringify({width,dark,item}));assert.ok(Math.abs(item.padLeft-6)<0.6,JSON.stringify({width,dark,item}));assert.ok(Math.abs(item.padRight-6)<0.6,JSON.stringify({width,dark,item}));assert.ok(item.within,JSON.stringify(item));}
   assert.equal(metrics.dialog.background,'rgba(160, 165, 175, 0.18)');assert.equal(metrics.dialog.filter,'blur(4px)');assert.equal(metrics.dialog.modals,1);assert.equal(metrics.dialog.footer,'1px');assert.equal(metrics.dialog.header,'1px');assert.ok(metrics.dialog.footerInset<=1.1);assert.ok(metrics.dialog.footerRight<=1.1);
   const confirm=await evaluate(`(async()=>{await $('browserClearAll').onclick();await waitDialog('browserSiteDataDialog',false);await waitDialog('browserClearDialog',true);const dialog=dialogMetrics('browserClearDialog'),buttons=[await buttonMetrics('browserClearCancel'),await buttonMetrics('browserClearConfirm')];$('browserClearCancel').onclick();await waitDialog('browserClearDialog',false);await waitDialog('browserSiteDataDialog',true);return {dialog,buttons,clears:calls.filter(x=>x==='clear').length,returned:$('browserSiteDataDialog').open};})()`);
   assert.equal(confirm.dialog.modals,1);assert.equal(confirm.dialog.background,'rgba(160, 165, 175, 0.18)');assert.equal(confirm.dialog.filter,'blur(4px)');assert.equal(confirm.dialog.footer,'1px');assert.equal(confirm.clears,0);assert.equal(confirm.returned,true);for(const item of confirm.buttons){assert.ok(Math.abs(item.gap-6)<0.6,JSON.stringify(item));assert.ok(Math.abs(item.padLeft-6)<0.6,JSON.stringify(item));assert.ok(Math.abs(item.padRight-6)<0.6,JSON.stringify(item));}
  }}
  console.log('PASS search empty state, app-table/app-button, cancel without clear, 4/8px section spacing, single shared backdrop, full-width separators, 6px button spacing, light/dark 1400/900px');
 }finally{win?.destroy();await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
})().then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)});
