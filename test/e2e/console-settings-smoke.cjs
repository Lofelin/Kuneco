// Real xterm and global components; all terminal input goes to a fake IPC sink.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');let win,temp;
app.whenReady().then(async()=>{
 const root=path.resolve(__dirname,'../..'),url=p=>pathToFileURL(path.join(root,p)).href;
 temp=await fs.mkdtemp(path.join(os.tmpdir(),'kuneco-console-ui-'));
 await fs.writeFile(path.join(temp,'page.html'),`<!doctype html><html><head><link rel="stylesheet" href="${url('src/vendor/ui.css')}"><link rel="stylesheet" href="${url('src/shared/ui/style.css')}"><link rel="stylesheet" href="${url('src/vendor/ui-overrides.css')}"></head><body><section id="page-console"><span id="consoleStatus"></span><app-button id="consoleConnect"><span id="consoleConnectLabel"></span></app-button><div id="containerTerminal" style="height:380px;width:700px"></div></section><script type="module" src="./page.mjs"></script></body></html>`);
 await fs.writeFile(path.join(temp,'page.mjs'),`import '${url('src/vendor/ui.js')}';import {mountConsole} from '${url('src/vendor/console.js')}';import {consoleDefaults} from '${url('src/shared/console-preferences.mjs')}';window.p={...consoleDefaults,consoleAutoConnect:false};window.calls=[];window.listen=null;let n=0;const api={onEvent:fn=>window.listen=fn,console:async(action,value)=>{calls.push({action,value});if(action==='status')return {available:true,id:'env'};if(action==='open')return {token:'session-'+(++n)};return true;}};window.view=mountConsole(api,{getPreferences:()=>p});window.paste=text=>{const data=new DataTransfer();data.setData('text/plain',text);document.querySelector('.xterm-helper-textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));};await view.show();window.ready=true;`);
 win=new BrowserWindow({width:920,height:740,show:true,webPreferences:{contextIsolation:true,sandbox:true}});await win.loadFile(path.join(temp,'page.html'));
 const run=code=>win.webContents.executeJavaScript(code),wait=()=>new Promise(r=>setTimeout(r,180));
 for(let i=0;i<100&&!await run('Boolean(window.ready)');i++)await new Promise(r=>setTimeout(r,50));
 assert.equal(await run("calls.filter(c=>c.action==='open').length"),0);
 await run("document.getElementById('consoleConnect').click()");await wait();assert.equal(await run("calls.filter(c=>c.action==='open').length"),1);
 await run("p.consoleFontSize=18;p.consoleTheme='light';document.dispatchEvent(new CustomEvent('preferences-changed'))");await wait();assert.equal(await run("document.getElementById('containerTerminal').style.background"),'rgb(255, 255, 255)');
 await run("listen({type:'console',data:{type:'data',token:'session-1',text:'\\x1b[?2004h'}})");await wait();
 await run("paste('first\\nsecond')");await wait();assert.equal(await run("calls.filter(c=>c.action==='input').length"),0);
 const metrics=await run(`(()=>{let d=document.querySelector('app-dialog'),r=d.shadowRoot.querySelector('dialog');return {open:r.open,backdrop:getComputedStyle(r,'::backdrop').backgroundColor,filter:getComputedStyle(r,'::backdrop').backdropFilter,radius:getComputedStyle(r).borderRadius,header:getComputedStyle(d.shadowRoot.querySelector('[part=header]')).borderBottomWidth,footer:getComputedStyle(d.shadowRoot.querySelector('[part=footer]')).borderTopWidth}})()`);
 assert.equal(metrics.open,true);assert.equal(metrics.filter,'blur(4px)');assert.equal(metrics.radius,'14px');assert.equal(metrics.header,'1px');assert.equal(metrics.footer,'1px');
 await run("document.querySelector('#consolePasteDialog app-button').click()");await wait();assert.equal(await run("calls.filter(c=>c.action==='input').length"),0);
 await run("paste('first\\nsecond')");await wait();win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait();assert.equal(await run("calls.filter(c=>c.action==='input').length"),0);
 await run("paste('first\\nsecond')");await wait();await run("document.querySelectorAll('#consolePasteDialog app-button')[1].click()");await wait();assert.equal(await run("calls.filter(c=>c.action==='input').length"),1);assert.equal(await run("calls.find(c=>c.action==='input').value.data.startsWith('\\x1b[200~')"),true);
 await run("paste('stale\\ntext');view.reset()");await wait();await run("document.querySelectorAll('#consolePasteDialog app-button')[1].click()");assert.equal(await run("calls.filter(c=>c.action==='input').length"),1);
 await run("p.consoleAutoConnect=true;view.show()");await wait();assert.equal(await run("calls.filter(c=>c.action==='open').length"),2);
 await run("p.consoleConfirmPaste=false;paste('allowed\\ntext')");await wait();assert.equal(await run("calls.filter(c=>c.action==='input').length"),2);
 await run("p.consoleTheme='system';document.body.classList.add('dark')");await wait();assert.equal(await run("document.getElementById('containerTerminal').style.background"),'rgb(21, 24, 32)');
 console.log(JSON.stringify({passed:true,metrics,manualConnect:true,cancel:true,escape:true,confirm:true,stalePasteBlocked:true,autoConnect:true,theme:true}));
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{win?.destroy();if(temp)await fs.rm(temp,{recursive:true,force:true});app.exit(process.exitCode||0);});
setTimeout(()=>app.exit(1),25000).unref();
