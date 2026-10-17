import {mountCompositionGuard} from './composition-guard.mjs';
export function contextTrigger(value,caret=value.length){const prefix=value.slice(0,caret),match=/(^|\s)([/@])([^\s/@]*)$/.exec(prefix);return match?{kind:match[2]==='/'?'skills':'files',query:match[3],start:prefix.length-match[2].length-match[3].length,end:caret}:null;}
export function mountContextPicker({input,host,load,getScope}){
 const compositionGuard=mountCompositionGuard(input);
 let version=0,timer,items=[],selected=-1,trigger=null,scope='',open=false;
 const native=()=>input.shadowRoot?.querySelector('textarea');
 const close=()=>{version++;clearTimeout(timer);open=false;host.hidden=true;items=[];selected=-1;input.setAttribute('aria-expanded','false');};
 const notice=text=>{const p=document.createElement('p');p.className='context-picker-notice';p.textContent=text;host.replaceChildren(p);};
 const choose=index=>{const item=items[index];if(!item?.enabled||scope!==getScope()||!trigger)return;const insertion=trigger.kind==='skills'?`使用技能「${item.name}」${item.path?`（技能文件：${item.path}）`:""} `:`引用当前环境文件路径「${item.path}」（尚未读取内容，请按需使用工具读取） `;const value=input.value;input.value=value.slice(0,trigger.start)+insertion+value.slice(trigger.end);const cursor=trigger.start+insertion.length;close();input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();native()?.setSelectionRange(cursor,cursor);};
 const highlight=()=>{host.querySelectorAll('[role=option]').forEach((node,i)=>node.setAttribute('aria-selected',String(i===selected)));host.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});};
 async function refresh(){
  const caret=native()?.selectionStart??input.value.length;trigger=contextTrigger(input.value,caret);if(!trigger||input.disabled){close();return;}
  const current=++version;scope=getScope();const requestedScope=scope;open=true;host.hidden=false;input.setAttribute('aria-expanded','true');items=[];selected=-1;notice('正在读取当前环境…');
  try{const result=await load({kind:trigger.kind,query:trigger.query});if(current!==version||requestedScope!==getScope())return;items=result.items;host.replaceChildren();
   const title=document.createElement('p');title.className='context-picker-notice';title.textContent=(trigger.kind==='skills'?'当前环境技能':'当前项目文件')+' · '+result.root;host.append(title);
   if(!items.length){const p=document.createElement('p');p.className='context-picker-notice';p.textContent='没有匹配项';host.append(p);}
   items.forEach((item,index)=>{const button=document.createElement('app-button');button.type='button';button.setAttribute('layout','custom');button.setAttribute('role','option');button.className='context-picker-item';button.disabled=!item.enabled;
    const icon=document.createElement('wa-icon');icon.slot='start';icon.src='assets/icons/'+(trigger.kind==='skills'?'book-open':'file-text')+'.svg';const name=document.createElement('span');name.textContent=item.name;const description=document.createElement('small');description.textContent=[item.reason||item.description,item.path].filter(Boolean).join(' · ');const copy=document.createElement('span');copy.className='context-picker-copy';copy.append(name,description);button.append(icon,copy);button.title=description.textContent;button.addEventListener('click',()=>choose(index));host.append(button);});
   for(const warning of result.warnings||[]){const p=document.createElement('p');p.className='context-picker-notice';p.textContent=warning;host.append(p);}selected=items.findIndex(i=>i.enabled);highlight();
  }catch(e){if(current===version)notice('读取失败：'+e.message+'。重新输入 / 或 @ 可重试。');}
 }
 input.setAttribute('aria-controls',host.id);input.setAttribute('aria-expanded','false');host.setAttribute('role','listbox');
 input.addEventListener('input',()=>{scope=getScope();clearTimeout(timer);version++;items=[];selected=-1;if(open)notice('正在读取当前环境…');timer=setTimeout(refresh,180);});
 input.addEventListener('keydown',event=>{if(!open||compositionGuard.isComposing(event))return;if(['ArrowDown','ArrowUp','Enter','Escape'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();if(event.key==='Escape'){close();return;}if(event.key==='Enter'){choose(selected);return;}const candidates=items.map((x,i)=>x.enabled?i:-1).filter(i=>i>=0);if(!candidates.length)return;const offset=event.key==='ArrowDown'?1:-1;selected=candidates[(candidates.indexOf(selected)+offset+candidates.length)%candidates.length];highlight();}},{capture:true});
 document.addEventListener('pointerdown',event=>{if(!event.composedPath().includes(input)&&!host.contains(event.target))close();});
 return {close,refresh,invalidate(){if(scope!==getScope())close();}};
}
