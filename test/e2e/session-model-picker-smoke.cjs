const {app,BrowserWindow}=require('electron');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');
app.on('window-all-closed',()=>{});
(async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dingtu-actions-'));app.setPath('userData',dir);await app.whenReady();let win;try{
 const src=path.resolve(__dirname,'../../src');let html=await fs.readFile(path.join(src,'index.html'),'utf8');html=html.replace('<head>','<head><base href="file://'+src+'/">').replace('src="app/renderer.js"','src="vendor/ui.js"');await fs.writeFile(path.join(dir,'test.html'),html);win=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{contextIsolation:true}});await win.loadFile(path.join(dir,'test.html'));

 const renderer=await fs.readFile(path.join(src,'app/renderer.js'),'utf8');
 const behavior=renderer.slice(renderer.indexOf('function renderSessionModel(){'),renderer.indexOf('function fillSessionModels(){'));
 await win.webContents.executeJavaScript('(async()=>{await customElements.whenDefined("wa-select");document.body.innerHTML=\'<wa-select id="sessionModel" style="display:block;position:absolute;left:200px;top:300px;width:170px" placement="top"></wa-select>\';})()');
 await win.webContents.executeJavaScript(`const $=id=>document.getElementById(id);let runtimeRegistry={runtimes:[{id:'deepseek',model:'a',models:[{model:'a',name:'DeepSeek-V4.1-Flash'},{model:'b',name:'DeepSeek-V4-Pro'}]}]},selectedEngine='deepseek',selectedCodexModel='a',activeChatId='chat',busy=false,chatSessions=[{id:'chat'}];const action=fn=>fn(),toast=()=>{},renderRuntime=()=>renderSessionModel(),renderSessionHeader=()=>{},api={sessionModel:async(id,model)=>({id,model})};async function refreshRuntimeRegistry(){await new Promise(r=>setTimeout(r,120));renderSessionModel();}`+behavior+'renderSessionModel()');
 await win.webContents.executeJavaScript("document.getElementById('sessionModel').updateComplete");
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 async function click(x,y){win.webContents.sendInputEvent({type:'mouseMove',x,y});win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});await pause(300);}
 const position=await win.webContents.executeJavaScript("(()=>{const r=document.getElementById('sessionModel').shadowRoot.querySelector('[part=combobox]').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
 for(const mode of ['toggle','outside','escape','select']){
  await click(position.x,position.y);assert.equal(await win.webContents.executeJavaScript("document.getElementById('sessionModel').open"),true,mode+' opens after refresh');
  const widths=await win.webContents.executeJavaScript("(()=>{const s=document.getElementById('sessionModel');return [s.shadowRoot.querySelector('[part=combobox]').getBoundingClientRect().width,s.shadowRoot.querySelector('[part=listbox]').getBoundingClientRect().width]})()");assert.ok(Math.abs(widths[0]-widths[1])<1,JSON.stringify(widths));
  if(mode==='toggle')await click(position.x,position.y);
  if(mode==='outside')await click(600,500);
  if(mode==='escape'){win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await pause(300);}
  if(mode==='select'){const p=await win.webContents.executeJavaScript("(()=>{const r=document.querySelectorAll('wa-option')[1].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");await click(p.x,p.y);assert.equal(await win.webContents.executeJavaScript('selectedCodexModel'),'b');}
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('sessionModel').open"),false,mode+' closes');console.log('PASS model picker',mode,'equal widths',widths);
 }
 }finally{win?.destroy();await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}})().then(()=>app.quit()).catch(e=>{console.error(e);app.exit(1);});