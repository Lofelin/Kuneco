import {applyPreferences} from '../preferences/preference-effects.mjs';
import {preferenceDefaults,shouldSend} from '../../shared/preferences.mjs';
import {updateChatMessage} from '../../vendor/chat-markdown.js';
import {renderDocumentCards} from './document-attachments.mjs';
import {mountCompositionGuard} from './composition-guard.mjs';
import '../../vendor/ui.js';
const api=window.chatPopout,$=id=>document.getElementById(id);let snapshot=null,timer,pending=false,dirty=false,editRevision=null;
let preferences={...preferenceDefaults};api.onPreferences(value=>{preferences=applyPreferences(value);});
const messageText=message=>typeof message==='string'?message:String(message.text??message.rawText??message.content??'');
function controls(){ $('draft').disabled=!snapshot;$('send').disabled=!snapshot||snapshot.busy||pending||!$('draft').value.trim();$('stop').hidden=!snapshot?.busy; }
async function action(kind){
 if(!snapshot)return;clearTimeout(timer);
 try{pending=true;controls();await api.action({action:kind,text:$('draft').value,revision:dirty?editRevision:snapshot.revision});if(kind==='send')dirty=false;if(['focus','stop'].includes(kind)){pending=false;controls();}}
 catch(error){pending=false;$('status').textContent=error.message;controls();}
}
api.onSnapshot(value=>{
 snapshot=value;document.title='Kuneco · '+(value.title||'对话');$('title').textContent=value.title||'对话';
 const content=JSON.stringify(value.messages||[]);if($('messages').dataset.content!==content){const bottom=$('messages').scrollHeight-$('messages').scrollTop-$('messages').clientHeight<60;$('messages').replaceChildren(...(value.messages||[]).map(message=>{const article=document.createElement('article');article.dataset.role=message.role||'assistant';const label=document.createElement('small');label.textContent=message.role==='user'?'你':'回复';article.append(label);const content=document.createElement('div');if(message.role==='assistant')updateChatMessage(content,messageText(message));else content.textContent=messageText(message);if(message.documents?.length)renderDocumentCards(article,message.documents);for(const image of message.images||[]){const img=document.createElement('img');img.src=image.dataURL||image.url;img.alt=image.name||'附件图片';img.style.maxWidth='180px';article.append(img);}article.append(content);for(const icon of article.querySelectorAll('wa-icon[src]')){const file=icon.getAttribute('src').split('/').pop();icon.src=new URL('../../assets/icons/'+file,import.meta.url).href;}return article;}));if(!(value.messages||[]).length){const empty=document.createElement('div');empty.className='app-empty-state';const title=document.createElement('h2');title.textContent='还没有消息';const note=document.createElement('p');note.textContent='在下方输入，继续这段对话。';empty.append(title,note);$('messages').append(empty);}$('messages').dataset.content=content;if(bottom)$('messages').scrollTop=$('messages').scrollHeight;}
 const draft=typeof value.draft==='string'?value.draft:value.draft?.text||'';
 if(!dirty || draft===$('draft').value){$('draft').value=draft;dirty=false;pending=false;editRevision=value.revision;}
 else if(pending){pending=false;$('status').textContent='草稿有更新，保留你的输入；请在主窗口确认后继续。';controls();return;}
 $('status').textContent=value.error||value.status||(value.busy?'正在回复 · 与主窗口共享执行状态':'与主窗口共享同一对话');controls();
});
$('draft').addEventListener('input',()=>{if(!dirty)editRevision=snapshot?.revision;dirty=true;clearTimeout(timer);timer=setTimeout(()=>void action('updateDraft'),250);controls();});
$('send').addEventListener('click',()=>void action('send'));$('stop').addEventListener('click',()=>void action('stop'));$('focus').addEventListener('click',()=>void action('focus'));

const compositionGuard=mountCompositionGuard($('draft'));$('draft').addEventListener('keydown',event=>{if(shouldSend(event,preferences,api.platform)&&!compositionGuard.isComposing(event)){event.preventDefault();if(!$('send').disabled)void action('send');}});
