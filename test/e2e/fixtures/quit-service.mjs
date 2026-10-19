import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
export function createQuitFixture({evaluate:e,until,client,modelControl,child,directory}){
 let blocked=0;const requests=[];
 return {
  async startTasks(){
   await e("workspace.dockerEnvironments('select',{id:null})");
   await e("workspace.runtimeInfo({detect:true})");
   await writeFile(modelControl,JSON.stringify({holdAll:true}));
   await e("workspace.newSession({engine:'codex',model:'desktop-fixture-model',networkMode:'direct'})");
   const origin=await e('performance.timeOrigin');await client.call('Page.reload');
   await until(()=>e(`performance.timeOrigin!==${origin}&&performance.getEntriesByName('chat-records-ready').length>0`));
   await e("document.querySelector('[data-page=cc]').click()");
   // Record restoration precedes draft hydration and the asynchronous auth probe.
   // A merely enabled button can still save to the outbox instead of sending.
   await until(()=>e("!document.getElementById('prompt').disabled && !document.getElementById('send').disabled && document.getElementById('send').getAttribute('aria-label')==='发送消息'"));
   await e("document.getElementById('prompt').value='KUNECO_QUIT_HOLD';document.getElementById('prompt').dispatchEvent(new Event('input',{bubbles:true}))");
   await e("document.getElementById('send').shadowRoot.querySelector('button').click()");
   await until(()=>e("workspace.state().then(state=>workspace.chatInsights({owner:state.chatOwner,environmentId:state.containerId,chatId:state.activeAISessionId})).then(view=>view.running)"));
   const next=new Date(Math.floor(Date.now()/60000)*60000+60000),time=next.toISOString().slice(11,16);
   await e(`workspace.learningAutomation('create',${JSON.stringify({name:'退出保护自动化验收',engine:'codex',language:'zh',networkMode:'direct',schedule:{mode:'fixed',time,timeZone:'UTC',days:[0,1,2,3,4,5,6]}})})`);
   await until(()=>e("workspace.learningAutomation('list').then(items=>items.some(item=>item.name==='退出保护自动化验收'&&item.status==='running'))"),85000);
   await e("window.__desktopQuitBlocked=0;document.addEventListener('quit-blocked',()=>window.__desktopQuitBlocked++)");
  },
  async request(){
   blocked=await e('window.__desktopQuitBlocked');
   const command={id:randomUUID(),action:requests.length%2===0?'window-close':'app-quit'};requests.push(command);
   const file=path.join(directory,'native-app-command.json');await writeFile(file+'.tmp',JSON.stringify(command));await rename(file+'.tmp',file);
   await until(async()=>{try{return (await readFile(path.join(directory,'native-app-events.jsonl'),'utf8')).includes(command.id);}catch{return false;}});
  },
  requests:()=>requests.map(command=>command.action),
  alive:async()=>child.exitCode===null,
  settled:()=>until(()=>e(`window.__desktopQuitBlocked>${blocked}`)),
  waitExit:()=>until(()=>child.exitCode!==null,20000),
 };
}
