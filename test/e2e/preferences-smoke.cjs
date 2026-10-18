// Real Electron components with isolated preferences and synthetic running tasks.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
let window,temp;
app.whenReady().then(async()=>{
 const root=path.resolve(__dirname,'../..'),url=p=>pathToFileURL(path.join(root,p)).href;
 const {createQuitConfirmation}=await import(url('src/features/preferences/quit-confirmation.mjs'));
 temp=await fs.mkdtemp(path.join(os.tmpdir(),'kuneco-preference-ui-'));
 const guard=createQuitConfirmation({enabled:()=>true,tasks:()=>['对话 · 验收任务','自动化 · 验收任务'],prompt:data=>window.webContents.send('test:event',{type:'quitConfirmation',data}),id:()=>crypto.randomUUID()});
 ipcMain.handle('test:reply',(_event,value)=>guard.answer(value));
 await fs.writeFile(path.join(temp,'preload.cjs'),`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('testAPI',{onEvent:fn=>ipcRenderer.on('test:event',(_e,v)=>fn(v)),quitConfirmation:v=>ipcRenderer.invoke('test:reply',v)});`);
 await fs.writeFile(path.join(temp,'page.html'),`<!doctype html><html lang="zh-CN"><head><link rel="stylesheet" href="${url('src/vendor/ui.css')}"><link rel="stylesheet" href="${url('src/shared/ui/style.css')}"><link rel="stylesheet" href="${url('src/vendor/ui-overrides.css')}"></head><body><script type="module" src="./page.mjs"></script></body></html>`);
 await fs.writeFile(path.join(temp,'page.mjs'),`import '${url('src/vendor/ui.js')}';import {mountQuitDialog} from '${url('src/features/preferences/quit-dialog.mjs')}';mountQuitDialog({document,api:window.testAPI});window.ready=true;`);
 window=new BrowserWindow({width:900,height:700,show:true,webPreferences:{preload:path.join(temp,'preload.cjs'),contextIsolation:true,sandbox:true}});
 await window.loadFile(path.join(temp,'page.html'));
 const evalJS=code=>window.webContents.executeJavaScript(code);
 for(let i=0;i<80&&!await evalJS('Boolean(window.ready)');i++)await new Promise(r=>setTimeout(r,50));
 const first=guard.request();await new Promise(r=>setTimeout(r,300));
 const metrics=await evalJS(`(()=>{const d=document.querySelector('app-dialog'),real=d.shadowRoot.querySelector('dialog'),h=d.shadowRoot.querySelector('[part=header]'),f=d.shadowRoot.querySelector('[part=footer]');return {open:real.open,items:d.querySelectorAll('li').length,radius:getComputedStyle(real).borderRadius,backdrop:getComputedStyle(real,'::backdrop').backgroundColor,filter:getComputedStyle(real,'::backdrop').backdropFilter,header:getComputedStyle(h).borderBottomWidth,footer:getComputedStyle(f).borderTopWidth,buttons:[...d.querySelectorAll('app-button')].map(b=>({icon:!!b.querySelector('wa-icon[slot=start]'),action:b.classList.contains('content-action')}))}})()`);
 assert.equal(metrics.open,true);assert.equal(metrics.items,2);assert.equal(metrics.radius,'14px');assert.equal(metrics.filter,'blur(4px)');assert.equal(metrics.header,'1px');assert.equal(metrics.footer,'1px');assert.ok(metrics.buttons.every(b=>b.icon&&b.action));
 await evalJS(`document.querySelector('app-dialog app-button').click()`);assert.equal(await first,false);
 await new Promise(r=>setTimeout(r,200));const second=guard.request();await new Promise(r=>setTimeout(r,250));await window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});assert.equal(await second,false);
 await new Promise(r=>setTimeout(r,200));const third=guard.request();await new Promise(r=>setTimeout(r,250));await evalJS(`document.querySelectorAll('app-dialog app-button')[1].click()`);assert.equal(await third,true);
 await new Promise(r=>setTimeout(r,250));await evalJS("const other=document.createElement('app-dialog');other.id='existing';other.label='既有操作';document.body.append(other);other.open=true;");await new Promise(r=>setTimeout(r,200));const blocked=guard.request();assert.equal(await blocked,false);assert.equal(await evalJS("document.getElementById('existing').open"),true);assert.equal(await evalJS("document.querySelectorAll('app-dialog[open]').length"),1);
 console.log(JSON.stringify({passed:true,metrics,cancel:true,escape:true,confirm:true}));
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{window?.destroy();if(temp)await fs.rm(temp,{recursive:true,force:true});app.exit(process.exitCode||0);});
setTimeout(()=>{console.error('preferences smoke timeout');app.exit(1);},20000).unref();
