import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

/** Call after fixture login/onboarding, with no active modal or running business action. */
export async function verifyComponents(context){
 const {evaluate:expression,until,client,captureUI}=context;
 const evaluate=(fn,...args)=>expression(`(${fn.toString()})(...${JSON.stringify(args)})`);
 const tick=()=>evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const click=async selector=>{
  const position=await evaluate(async selector=>{
  const host=document.querySelector(selector);if(!host || host.disabled)throw Error('Unavailable component action: '+selector);
  await host.updateComplete;host.scrollIntoView({block:'nearest',inline:'nearest'});
  const button=host.localName==='wa-select'?host.shadowRoot?.querySelector('[part~=combobox]'):host.shadowRoot?.querySelector('button');
  const box=(button || host).getBoundingClientRect();if(!box.width || !box.height)throw Error('Component action is not visible: '+selector);
  return {x:box.left+box.width/2,y:box.top+box.height/2};
  },selector);
  await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',...position});
  await client.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...position});
  await client.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...position});
 };
 const openAccountMenu=async()=>{if(!await evaluate(()=>document.getElementById('accountMenu').open))await click('#accountTrigger');await until(()=>evaluate(()=>document.getElementById('accountMenu').open));};
 const setting=async key=>{
  await openAccountMenu();
  await click('#accountSettings');await until(()=>evaluate(()=>!document.getElementById('page-overview').classList.contains('hidden')));
  await click(`[data-setting="${key}"]`);
  await until(()=>evaluate(key=>document.querySelector(`.settings-panel[data-panel="${key}"]`).getBoundingClientRect().height>0,key));await tick();
 };
 const closed=id=>until(()=>evaluate(id=>{const d=document.getElementById(id);return !d.open && !d.dialog.open && !d.dialog.matches(':modal');},id));
 const escape=async()=>{for(const type of ['keyDown','keyUp'])await client.call('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});};
 const initial=await evaluate(async()=>({url:location.href,ready:performance.getEntriesByName('chat-records-ready').length>0,bridge:typeof workspace?.state,account:Boolean((await workspace.accountState())?.user),theme:document.getElementById('themeSelect').value,setting:document.querySelector('.settings-tab.active')?.dataset.setting,modal:[...document.querySelectorAll('app-dialog')].some(d=>d.open)}));
 assert.match(initial.url,/\/src\/index\.html(?:[?#]|$)/,'components require the real application main page');
 assert.equal(initial.ready,true,'real renderer must finish startup');assert.equal(initial.bridge,'function','real preload bridge is required');
 assert.equal(initial.account,true,'components scenario runs after fixture login');assert.equal(initial.modal,false,'finish existing business dialogs before component acceptance');
 const directory=path.resolve('artifacts/desktop-components');await mkdir(directory,{recursive:true});
 const evidence={url:initial.url,frames:[],closeActions:[],inventory:[]};
 const geometry=()=>evaluate(()=>{
  const d=document.getElementById('proxyDialog'),button=document.getElementById('cancelProxyDialog'),base=button.shadowRoot.querySelector('button'),label=button.shadowRoot.querySelector('[part~=label]'),icon=button.querySelector('[slot=start]'),rect=node=>node.getBoundingClientRect();
  const box=d.dialog,header=d.shadowRoot.querySelector('[part~=header]'),footer=d.shadowRoot.querySelector('[part~=footer]'),backdrop=getComputedStyle(box,'::backdrop'),bounds=rect(box);
  const host=document.getElementById('host');
  return {width:innerWidth,dark:document.body.classList.contains('dark'),button:{gap:rect(label).left-rect(icon).right,left:rect(icon).left-rect(base).left-parseFloat(getComputedStyle(base).borderLeftWidth),right:rect(base).right-rect(label).right-parseFloat(getComputedStyle(base).borderRightWidth),overflow:rect(label).right>rect(base).right},dialog:{radius:getComputedStyle(box).borderRadius,backdrop:backdrop.backgroundColor,filter:backdrop.backdropFilter,header:getComputedStyle(header).borderBottomWidth,footer:getComputedStyle(footer).borderTopWidth,headerLeft:rect(header).left,footerLeft:rect(footer).left,headerWidth:rect(header).width,footerWidth:rect(footer).width,within:bounds.left>=0&&bounds.right<=innerWidth},form:document.getElementById('connect').getForm()?.id,required:host.required&&Boolean(host.shadowRoot.querySelector('label')),modalCount:[...document.querySelectorAll('app-dialog')].filter(el=>el.dialog?.matches(':modal')).length};
 });
 const openProxy=async()=>{await setting('proxy');await click('#addProxyProfile');await until(()=>evaluate(()=>document.getElementById('proxyDialog').dialog.matches(':modal')));await tick();};
 const setTheme=theme=>evaluate(async theme=>{const control=document.getElementById('themeSelect');control.value=theme;control.dispatchEvent(new Event('change'));await control.updateComplete;},theme);
 try{
  await openAccountMenu();await tick();
  const menu=await evaluate(()=>{
   const host=document.getElementById('accountMenu'),item=document.getElementById('accountSettings'),label=item.shadowRoot.querySelector('[part~=label]'),style=getComputedStyle(label || item);
   return {open:host.open,radius:getComputedStyle(host.shadowRoot.querySelector('[part~=menu]')).borderRadius,itemRadius:getComputedStyle(item).borderRadius,font:style.fontSize,weight:style.fontWeight,line:style.lineHeight};
  });
  assert.equal(menu.open,true);assert.equal(menu.radius,'14px');assert.equal(menu.itemRadius,'14px');assert.equal(menu.font,'12px');assert.equal(menu.weight,'400');assert.equal(menu.line,'18px');evidence.menu=menu;
  await escape();await until(()=>evaluate(()=>!document.getElementById('accountMenu').open));
  for(const theme of ['light','dark'])for(const width of [1280,1050]){
   await client.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await until(()=>evaluate(width=>Math.abs(innerWidth-width)<2,width));
   await setting('preferences');await setTheme(theme);await tick();
   await click('#languageSelect');await until(()=>evaluate(()=>document.getElementById('languageSelect').open));await tick();
   const select=await evaluate(()=>{
    const host=document.getElementById('languageSelect'),option=host.querySelector('wa-option'),label=option.shadowRoot.querySelector('[part~=label]'),style=getComputedStyle(label);
    return {value:host.value,listbox:getComputedStyle(host.shadowRoot.querySelector('[part~=listbox]')).borderRadius,radius:getComputedStyle(option).borderRadius,font:style.fontSize,weight:style.fontWeight,line:style.lineHeight};
   });
   assert.equal(select.listbox,'14px');assert.equal(select.radius,'14px');assert.equal(select.font,'12px');assert.equal(select.weight,'400');assert.equal(select.line,'18px');
   await escape();await until(()=>evaluate(()=>!document.getElementById('languageSelect').open));
   await setting('proxy');await tick();
   const profiles=await evaluate(()=>{
    const root=document.getElementById('proxyProfilesSettings'),rect=e=>e.getBoundingClientRect(),heading=root.querySelector('.preference-heading'),description=root.querySelector('.settings-section-description'),toolbar=root.querySelector('.proxy-list-toolbar'),table=root.querySelector('app-table'),add=document.getElementById('addProxyProfile');
    return {headingGap:rect(description).top-rect(heading).bottom,toolbarGap:rect(toolbar).top-rect(description).bottom,tableGap:rect(table).top-rect(toolbar).bottom,headers:[...table.querySelectorAll('th')].map(e=>e.textContent),within:rect(add).right<=rect(toolbar).right+.5,topActionsHidden:!document.getElementById('proxyPageActions'),empty:table.querySelector('.app-table-empty')?.colSpan};
   });
   assert.equal(profiles.headingGap,4);assert.equal(profiles.toolbarGap,8);assert.equal(profiles.tableGap,16);assert.deepEqual(profiles.headers,['名称','代理商','协议','节点','状态','']);assert.equal(profiles.within,true);assert.equal(profiles.topActionsHidden,true);assert.equal(profiles.empty,6);
   const profileScreenshot=await captureUI();await writeFile(path.join(directory,'proxy-profiles-'+theme+'-'+width+'.png'),Buffer.from(profileScreenshot.data,'base64'));
   await openProxy();const frame=await geometry();
   for(const [key,value] of Object.entries(frame.button))if(key!=='overflow')assert.ok(Math.abs(value-6)<.7,theme+' '+width+' button '+key+' '+value);
   assert.equal(frame.button.overflow,false);assert.equal(frame.dialog.radius,'14px');assert.equal(frame.dialog.backdrop,'rgba(160, 165, 175, 0.18)');assert.equal(frame.dialog.filter,'blur(4px)');assert.equal(frame.dialog.header,'1px');assert.equal(frame.dialog.footer,'1px');assert.equal(frame.dialog.within,true);assert.equal(frame.form,'proxyForm');assert.equal(frame.required,true);assert.equal(frame.modalCount,1);
   assert.ok(Math.abs(frame.dialog.headerLeft-frame.dialog.footerLeft)<1);assert.ok(Math.abs(frame.dialog.headerWidth-frame.dialog.footerWidth)<1);
   evidence.frames.push({...frame,select});const screenshot=await captureUI();await writeFile(path.join(directory,theme+'-'+width+'.png'),Buffer.from(screenshot.data,'base64'));
   await click('#cancelProxyDialog');await closed('proxyDialog');
  }
  for(const action of ['#closeProxyDialog','Escape']){
   await openProxy();if(action==='Escape')await escape();else await click(action);await closed('proxyDialog');evidence.closeActions.push({dialog:'proxyDialog',action});
  }
  // These root-level, already-mounted dialogs have no start/install/submit side effects.
  // Inspect only their shell and close lifecycle, leaving all business fields untouched.
  for(const id of ['browserClearDialog','renameEnvironmentDialog']){
   const metrics=await evaluate(async id=>{
    const d=document.getElementById(id);await d.show();
    const header=d.shadowRoot.querySelector('[part~=header]'),footer=d.shadowRoot.querySelector('[part~=footer]'),box=d.dialog,backdrop=getComputedStyle(box,'::backdrop');
    return {id,open:box.matches(':modal'),radius:getComputedStyle(box).borderRadius,backdrop:backdrop.backgroundColor,filter:backdrop.backdropFilter,header:getComputedStyle(header).borderBottomWidth,footer:getComputedStyle(footer).borderTopWidth};
   },id);
   assert.equal(metrics.open,true);assert.equal(metrics.radius,'14px');assert.equal(metrics.backdrop,'rgba(160, 165, 175, 0.18)');assert.equal(metrics.filter,'blur(4px)');assert.equal(metrics.header,'1px');assert.equal(metrics.footer,'1px');
   await evaluate(id=>document.getElementById(id).shadowRoot.querySelector('.close').shadowRoot.querySelector('button').click(),id);await closed(id);evidence.closeActions.push({dialog:id,action:'standard-header-close',...metrics});
   await evaluate(id=>document.getElementById(id).show(),id);await escape();await closed(id);evidence.closeActions.push({dialog:id,action:'native-Escape'});
   const lifecycle=await evaluate(async id=>{
    const d=document.getElementById(id);await d.show();let count=0;const countHide=()=>count++;d.addEventListener('wa-after-hide',countHide);
    await Promise.all([d.hide(),d.hide()]);d.removeEventListener('wa-after-hide',countHide);const duplicateClosed=!d.open&&!d.dialog.open;
    await d.show();const prevent=event=>event.preventDefault();d.addEventListener('wa-hide',prevent);await d.hide();const guarded=d.open&&d.dialog.open;
    d.removeEventListener('wa-hide',prevent);await d.hide();return {count,duplicateClosed,guarded};
   },id);
   assert.deepEqual(lifecycle,{count:1,duplicateClosed:true,guarded:true});evidence.closeActions.push({dialog:id,action:'hide-api-duplicate-and-cancel-guard',...lifecycle});
  }
  evidence.inventory=await evaluate(()=>[...document.querySelectorAll('app-dialog')].map(d=>({id:d.id,label:d.label,custom:d.hasAttribute('custom-close'),footer:Boolean(d.querySelector(':scope>[slot=footer]')),open:d.open})));
  assert.ok(evidence.inventory.length>=15,'real renderer must mount static and dynamic application dialogs');assert.ok(evidence.inventory.every(item=>!item.open),'component checks leave no modal behind');
  assert.equal(await evaluate(()=>document.querySelectorAll('wa-dialog,dialog,button,input:not([type=file][hidden]),select,textarea').length),0,'business markup continues to use shared controls');
  await writeFile(path.join(directory,'report.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log('PASS actual application components: expanded account/language menus, real buttons and forms, light/dark 1280/1050 proxy dialog geometry, business cancel/header/Escape, standard dialog lifecycle; evidence '+directory);
  return evidence;
 }finally{
  await evaluate(async()=>{for(const id of ['proxyDialog','browserClearDialog','renameEnvironmentDialog']){const d=document.getElementById(id);if(d.open)await d.hide();}document.getElementById('accountMenu').open=false;await document.getElementById('languageSelect').hide();});
  await client.call('Emulation.clearDeviceMetricsOverride');await setTheme(initial.theme);if(initial.setting)await setting(initial.setting);
 }
}
