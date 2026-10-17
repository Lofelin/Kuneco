const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kuneco-reasoning-'));app.setPath('userData',dir);await app.whenReady();let win;
 try{
  const src=path.resolve(__dirname,'../../src');let html=await fs.readFile(path.join(src,'index.html'),'utf8');
  html=html.replace('<head>','<head><base href="file://'+src+'/">').replace('src="app/renderer.js"','src="vendor/ui.js"');await fs.writeFile(path.join(dir,'index.html'),html);
  win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{contextIsolation:true}});await win.loadFile(path.join(dir,'index.html'));
  const result=await win.webContents.executeJavaScript(`(async()=>{
   const {reasoningView,finishReasoning}=await import('file://${src}/features/chat/reasoning-view.mjs');
   const {reasoningSnapshot}=await import('file://${src}/features/chat/reasoning-state.mjs');
   const {updateChatMessage}=await import('file://${src}/vendor/chat-markdown.js');
   document.body.classList.remove('auth-pending','auth-mode','environment-onboarding');document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));document.getElementById('page-cc').classList.remove('hidden');document.getElementById('chatSetupNotice').classList.add('hidden');
   const chat=document.getElementById('chat');chat.replaceChildren();
   const make=()=>{const block=document.createElement('div');block.className='bubble assistant';const content=document.createElement('div');content.className='message-content markdown-body';block.append(content);chat.append(block);return content;};
   const content=make(),details=reasoningView(content,{phase:'waiting',startedAt:Date.now()-5000},updateChatMessage);
   reasoningView(content,{text:'这是运行时实际提供的思考文本。\\n\\n'+('长内容会自然换行。'.repeat(50))},updateChatMessage);
   const waiting=content.parentNode.messageReasoning.waitingMs;
   details.querySelector('summary').click();reasoningView(content,{text:'追加内容仍保持手动收起。'+('长内容会自然换行。'.repeat(50))},updateChatMessage);
   const stayedClosed=!details.open;
   details.querySelector('summary').click();finishReasoning(content,updateChatMessage,'answering');const thought=content.parentNode.messageReasoning.thinkingMs;
   finishReasoning(content,updateChatMessage,'stopped');finishReasoning(content,updateChatMessage);
   const saved=reasoningSnapshot(content.parentNode.messageReasoning),restored=make();reasoningView(restored,{...saved,complete:true},updateChatMessage);
   const failed=make();reasoningView(failed,{kind:'process',startedAt:Date.now()-11000,activities:[{id:'cmd',type:'command_execution',icon:'terminal',title:'运行命令 · fixture',command:'fixture',status:'in_progress',detail:''}]},updateChatMessage);finishReasoning(failed,updateChatMessage,'failed');
   const done=make();reasoningView(done,{text:'已完成的思考记录',thinkingMs:3200,phase:'completed',complete:true},updateChatMessage);
   window.qa={details,content,chat};
   return {waiting,stayedClosed,phase:saved.phase,thought,restored:restored.parentNode.querySelector('details').open,failed:failed.parentNode.messageReasoning.activities[0].status,timer:content.parentNode.messageReasoning.timer};
  })()`);
  assert.ok(result.waiting>=5000);assert.equal(result.stayedClosed,true);assert.equal(result.phase,'stopped');assert.equal(result.restored,true);assert.equal(result.failed,'failed');assert.equal(result.timer,null);
  await win.webContents.executeJavaScript('qa.details.querySelector("summary").focus()');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await new Promise(r=>setTimeout(r,300));
  const folded=await win.webContents.executeJavaScript(`({open:qa.details.open,height:parseFloat(getComputedStyle(qa.details,'::details-content').height),preference:qa.content.parentNode.messageReasoning.userExpanded})`);
  assert.equal(folded.open,false);assert.equal(folded.preference,false);assert.equal(folded.height,0);
  await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/reasoning-state-light.png',(await win.webContents.capturePage()).toPNG());
  win.setSize(650,850);await win.webContents.executeJavaScript(`document.body.classList.add('dark');document.documentElement.dataset.theme='dark';document.documentElement.classList.add('wa-dark');qa.details.querySelector('summary').click()`);await new Promise(r=>setTimeout(r,300));
  const narrow=await win.webContents.executeJavaScript(`({open:qa.details.open,overflow:qa.details.scrollWidth>qa.details.clientWidth+1,height:parseFloat(getComputedStyle(qa.details,'::details-content').height)})`);
  assert.equal(narrow.open,true);assert.equal(narrow.overflow,false);assert.ok(narrow.height>0);await fs.writeFile('artifacts/reasoning-state-dark-narrow.png',(await win.webContents.capturePage()).toPNG());
  console.log('PASS reasoning phases, manual/keyboard folding, restored stop, failed activity, timer cleanup, narrow layout',result,folded,narrow);
 }finally{win?.destroy();app.quit();await fs.rm(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);app.exit(1);});
