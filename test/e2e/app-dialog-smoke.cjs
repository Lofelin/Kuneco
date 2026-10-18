const {app,BrowserWindow}=require('electron');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');
app.on('window-all-closed',()=>{});
(async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kuneco-dialog-'));app.setPath('userData',dir);await app.whenReady();let win;try{
 const src=path.resolve(__dirname,'../../src');let html=await fs.readFile(path.join(src,'index.html'),'utf8');html=html.replace('<head>','<head><base href="file://'+src+'/">').replace('src="app/renderer.js"','src="vendor/ui.js"');await fs.writeFile(path.join(dir,'dialogs.html'),html);
 win=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});await win.loadFile(path.join(dir,'dialogs.html'));
 const result=await win.webContents.executeJavaScript(`(async()=>{
  await customElements.whenDefined('app-dialog');
  const {mountLearningAutomation}=await import(${JSON.stringify('file://'+src+'/features/automation/learning-ui.mjs')});
  mountLearningAutomation({onEvent(){},async learningAutomation(){return[];}},()=>({name:'测试环境',runtimes:[{id:'cc',name:'Claude Code'}]}));
  const {mountDeepSeekComposer}=await import(${JSON.stringify('file://'+src+'/features/runtimes/deepseek-composer.mjs')});
  mountDeepSeekComposer({context:()=>({key:'fixture',engine:'deepseek'}),toast(){}});
  const {mountGitSettings}=await import(${JSON.stringify('file://'+src+'/features/git/git-settings.mjs')});
  mountGitSettings({host:document.getElementById('gitSettings'),api:{}});
  const {mountBrowserSettings}=await import(${JSON.stringify('file://'+src+'/features/browser/browser-settings.mjs')});
  mountBrowserSettings({document,api:{},getScope:()=>({owner:'fixture'}),formatDate:String,onOpenSite(){}});
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),out=[];
  const check=(value,message)=>{if(!value)throw Error(message);};
  const closed=async(d,action)=>{action();for(let i=0;i<40 && (d.open || d.dialog.open);i++)await wait(10);check(!d.open && !d.dialog.open,d.id+' did not close');check(!d.dialog.matches(':modal'),d.id+' retained modal');};
  for(const d of document.querySelectorAll('app-dialog')){
   for(let p=d;p;p=p.parentElement){p.hidden=false;p.classList.remove('hidden');}
   await d.updateComplete;
   const custom=d.hasAttribute('custom-close'),noHeader=d.withoutHeader;d.removeAttribute('custom-close');d.withoutHeader=false;await d.updateComplete;
   await d.show();
   const h=d.shadowRoot.querySelector('[part=header]'),f=d.shadowRoot.querySelector('[part=footer]'),box=d.dialog;
   const backdrop=getComputedStyle(box,'::backdrop');check(backdrop.backgroundColor==='rgba(160, 165, 175, 0.18)' && backdrop.backdropFilter==='blur(4px)',d.id+' backdrop');
   if(d.id!=='deepseekImagePreview')check(getComputedStyle(h).borderBottomWidth==='1px',d.id+' header divider');
   if(d.querySelector(':scope>[slot=footer]')){check(getComputedStyle(f).borderTopWidth==='1px',d.id+' footer divider');check(Math.abs(h.getBoundingClientRect().width-f.getBoundingClientRect().width)<1,d.id+' footer width');}
   await closed(d,()=>d.shadowRoot.querySelector('.close').shadowRoot.querySelector('button').click());
   await d.show();await closed(d,()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
   await d.show();await closed(d,()=>{d.open=false;});
   await d.show();let hides=0;const count=()=>hides++;d.addEventListener('wa-after-hide',count);await Promise.all([d.hide(),d.hide()]);check(!d.open&&!d.dialog.open,d.id+' hide API');check(hides===1,d.id+' duplicate hide event');d.removeEventListener('wa-after-hide',count);
   await d.show();const prevent=e=>e.preventDefault();d.addEventListener('wa-hide',prevent);await d.hide();check(d.open&&d.dialog.open,d.id+' bypassed close guard');d.removeEventListener('wa-hide',prevent);await d.hide();
   if(custom)d.setAttribute('custom-close','');d.withoutHeader=noHeader;
   out.push(d.id);
  }
  const actual=[['gitPublicKeyDialog','gitPublicKeyClose'],['gitKeyDialog','gitKeyDialogClose'],['learningDialog','learningCancel'],['deepseekImageDialog','deepseekImageCancel'],['deepseekImagePreview','[aria-label="关闭图片预览"]'],['browserSiteDataDialog','browserSiteClose'],['browserClearDialog','browserClearCancel']];
  for(const [id,button] of actual){const d=document.getElementById(id);await d.show();await closed(d,()=>{const b=button.startsWith('[')?d.querySelector(button):document.getElementById(button);check(!b.disabled,id+' close disabled');b.shadowRoot.querySelector('button').click();});}
  const d=document.getElementById('gitPublicKeyDialog');await d.show();await closed(d,()=>{d.open=false;});
  return {out,actual:actual.length,form:document.getElementById('connect').getForm()?.id,modalCount:document.querySelectorAll('app-dialog').length};
 })()`);
 assert.equal(result.out.length,21);assert.equal(result.form,'proxyForm');console.log('PASS '+result.out.length+' static/dynamic dialogs: header close, Escape, hide API, duplicate close, cancellation guards, backdrop and dividers; '+result.actual+' real module close handlers');
 }finally{win?.destroy();await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}})().then(()=>app.quit()).catch(e=>{console.error(e);app.exit(1);});
