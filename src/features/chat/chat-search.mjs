// Search DOM text without rewriting Markdown, tool results, or persisted messages.
const EXCLUDED='app-button,wa-icon,script,style,.message-actions,.bubble-label,.message-editor,.chat-code-toolbar';
export function findChatMatches(chat,query){
 const term=String(query || '').trim();if(!term)return [];
 const expression=new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
 const matches=[];
 for(const block of chat.querySelectorAll('.bubble')){
  const walker=chat.ownerDocument.createTreeWalker(block,4);const parts=[];let text='',node;
  while((node=walker.nextNode())){
   if(node.parentElement?.closest(EXCLUDED))continue;
   parts.push({node,start:text.length,end:text.length+node.data.length});text+=node.data;
  }
  for(const match of text.matchAll(expression)){
   const start=match.index,end=start+match[0].length;
   if(matches.length>=10000){matches.truncated=true;return matches;}
   const first=parts.find(part=>part.end>start),last=parts.find(part=>part.end>=end);
   if(!first || !last)continue;
   const range=chat.ownerDocument.createRange();range.setStart(first.node,start-first.start);range.setEnd(last.node,end-last.start);
   matches.push({range,block});
  }
 }
 return matches;
}

export function mountChatSearch({chat,host=chat?.parentElement?.querySelector('.session-header'),getScope=()=>''}={}){
 if(!chat || !host)throw new Error('Chat search needs chat and header elements');
 const doc=chat.ownerDocument,win=doc.defaultView,page=chat.closest('.page') || chat.parentElement;
 const createButton=(label,icon)=>{const el=doc.createElement('app-button');el.setAttribute('type','button');el.setAttribute('appearance','plain');el.setAttribute('icon-only','');el.className='icon-button';el.setAttribute('aria-label',label);el.title=label;const image=doc.createElement('wa-icon');image.setAttribute('src',`assets/icons/${icon}.svg`);image.setAttribute('aria-hidden','true');el.append(image);return el;};
 const trigger=createButton('搜索当前对话（⌘/Ctrl+F）','search');trigger.id='chatSearchTrigger';trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','chatSearchBar');host.insertBefore(trigger,host.querySelector('#sessionInfoMenu'));
 const bar=doc.createElement('div');bar.id='chatSearchBar';bar.className='chat-search-bar';bar.hidden=true;bar.setAttribute('role','search');bar.setAttribute('aria-label','搜索当前对话');
 const input=doc.createElement('wa-input');input.setAttribute('size','s');input.setAttribute('placeholder','搜索当前对话');input.setAttribute('aria-label','搜索内容');input.setAttribute('clearable','');
 const count=doc.createElement('span');count.className='chat-search-count';count.setAttribute('role','status');count.setAttribute('aria-live','polite');
 const previous=createButton('上一个匹配','chevron-up'),next=createButton('下一个匹配','chevron-down'),closeButton=createButton('关闭搜索','x');bar.append(input,count,previous,next,closeButton);host.after(bar);
 let scope=getScope(),matches=[],index=-1,timer,activeElement=null;const expanded=new Set();
 const highlights=win.CSS?.highlights;
 const clearHighlights=()=>{highlights?.delete('kuneco-chat-search');highlights?.delete('kuneco-chat-search-active');activeElement?.classList.remove('chat-search-current');activeElement=null;};
 const restoreFolds=()=>{for(const details of expanded)details.open=false;expanded.clear();};
 const renderCount=()=>{count.textContent=matches.length?`${index+1} / ${matches.length}${matches.truncated?'+':''}`:String(input.value || '').trim()?'无匹配':'输入关键词';previous.disabled=next.disabled=matches.length===0;};
 const showMatch=(position,{scroll=true}={})=>{
  clearHighlights();if(!matches.length){index=-1;renderCount();return;}
  index=(position+matches.length)%matches.length;const hit=matches[index];
  if(highlights && win.Highlight){const all=new win.Highlight();for(const match of matches)all.add(match.range);highlights.set('kuneco-chat-search',all);highlights.set('kuneco-chat-search-active',new win.Highlight(hit.range));}
  for(const node of [hit.range.startContainer,hit.range.endContainer]){let ancestor=node.parentElement;
   while(ancestor && ancestor!==chat){if(ancestor.tagName==='DETAILS' && !ancestor.open){expanded.add(ancestor);ancestor.open=true;}ancestor=ancestor.parentElement;}
  }
  activeElement=hit.range.startContainer.parentElement;activeElement?.classList.add('chat-search-current');
  if(scroll)activeElement?.scrollIntoView?.({block:'center',behavior:'instant'});renderCount();
 };
 const close=({focus=true}={})=>{clearTimeout(timer);bar.hidden=true;trigger.setAttribute('aria-expanded','false');clearHighlights();restoreFolds();matches=[];index=-1;input.value='';renderCount();if(focus)trigger.focus();};
 const refresh=()=>{clearTimeout(timer);if(getScope()!==scope){scope=getScope();close({focus:false});return;}if(bar.hidden)return;const previousRange=matches[index]?.range;matches=findChatMatches(chat,input.value);const retained=matches.findIndex(hit=>previousRange && hit.range.startContainer===previousRange.startContainer && hit.range.startOffset===previousRange.startOffset);showMatch(retained<0?0:retained,{scroll:false});};
 const open=()=>{if(getScope()!==scope){scope=getScope();close({focus:false});}bar.hidden=false;trigger.setAttribute('aria-expanded','true');refresh();input.focus();input.select?.();};
 const search=()=>{restoreFolds();refresh();if(matches.length)showMatch(0);};
 trigger.addEventListener('click',open);closeButton.addEventListener('click',()=>close());previous.addEventListener('click',()=>showMatch(index-1));next.addEventListener('click',()=>showMatch(index+1));input.addEventListener('input',search);input.addEventListener('wa-clear',()=>{input.value='';search();});
 const keydown=event=>{if(page.hidden || page.classList.contains('hidden') || !page.isConnected)return;if((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase()==='f'){event.preventDefault();open();}else if(!bar.hidden && bar.contains(event.target)){if(event.key==='Escape'){event.preventDefault();close();}else if(event.key==='Enter'){event.preventDefault();showMatch(index+(event.shiftKey?-1:1));}}};
 // A manual fold choice takes precedence over temporary search expansion.
 const manualFold=event=>{const summary=event.target.closest?.('summary');if(summary && chat.contains(summary))expanded.delete(summary.parentElement);};
 doc.addEventListener('keydown',keydown);chat.addEventListener('click',manualFold);
 const observer=new win.MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(refresh,120);});observer.observe(chat,{childList:true,subtree:true,characterData:true});
 renderCount();
 return {open,close,refresh,reset(){scope=getScope();close({focus:false});},destroy(){close({focus:false});observer.disconnect();doc.removeEventListener('keydown',keydown);chat.removeEventListener('click',manualFold);bar.remove();trigger.remove();}};
}
