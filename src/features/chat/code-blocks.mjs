// Controls never enter the source <code> node, so copying remains byte-for-byte.
function languageOf(code){return [...code.classList].find(name=>name.startsWith('language-'))?.slice(9)||'text';}
const sourceStates=new WeakMap();
const newlineCount=source=>{let count=0,index=-1;while((index=source.indexOf('\n',index+1))!==-1)count++;return count;};
function updateLineNumbers(block){
 const state=sourceStates.get(block);if(!state||!block.classList.contains('show-line-numbers'))return;
 const count=state.newlines+(state.source.endsWith('\n')?0:1);
 if(state.numbered===count)return;
 block.querySelector('pre').dataset.lines=Array.from({length:count},(_,index)=>index+1).join('\n');state.numbered=count;
}
function updateSource(block,source){
 const code=block.querySelector('pre > code');
 const state=sourceStates.get(block);
 if(state?.source===source)return;
 const appended=state&&source.startsWith(state.source)?source.slice(state.source.length):null;
 if(code.textContent!==source){
  const status=block.querySelector('.chat-code-status');if(status){status.textContent='';status.removeAttribute('data-error');}
  const previous=code.textContent;
  if(code.childNodes.length===1 && code.firstChild.nodeType===3){if(appended!==null)code.firstChild.appendData(appended);else{let prefix=0;while(prefix<previous.length && prefix<source.length && previous[prefix]===source[prefix])prefix++;code.firstChild.replaceData(prefix,previous.length-prefix,source.slice(prefix));}}
  else code.textContent=source;
 }
 sourceStates.set(block,{source,newlines:appended!==null?state.newlines+newlineCount(appended):newlineCount(source),numbered:state?.numbered});
 updateLineNumbers(block);
}
function createBlock(pre,{writeClipboard}={}){
 const doc=pre.ownerDocument,code=pre.querySelector('code'),block=doc.createElement('section');block.className='chat-code-block';block.dataset.language=languageOf(code);
 const bar=doc.createElement('div');bar.className='chat-code-toolbar';
 const language=doc.createElement('span');language.className='chat-code-language';language.textContent=block.dataset.language;language.title=block.dataset.language;
 const status=doc.createElement('span');status.className='chat-code-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const button=(label,icon)=>{const control=doc.createElement('app-button');control.setAttribute('type','button');control.setAttribute('appearance','plain');control.className='content-action';const image=doc.createElement('wa-icon');image.setAttribute('slot','start');image.setAttribute('src',`assets/icons/${icon}.svg`);control.append(image,doc.createTextNode(label));return control;};
 const lines=button('行号','code');lines.setAttribute('aria-label','显示代码行号');lines.setAttribute('aria-pressed','false');
 lines.addEventListener('click',()=>{const enabled=block.classList.toggle('show-line-numbers');lines.setAttribute('aria-pressed',String(enabled));lines.setAttribute('aria-label',enabled?'隐藏代码行号':'显示代码行号');updateLineNumbers(block);});
 const copy=button('复制','copy');copy.setAttribute('aria-label','复制代码');
 copy.addEventListener('click',async()=>{copy.disabled=true;status.textContent='';try{const write=writeClipboard||((text)=>doc.defaultView.navigator.clipboard.writeText(text));await write(code.textContent);status.textContent='已复制';status.removeAttribute('data-error');}catch{status.textContent='复制失败，请重试';status.setAttribute('data-error','');}finally{copy.disabled=false;}});
 bar.append(language,status,lines,copy);block.append(bar,pre);updateSource(block,code.textContent);return block;
}
export function captureCodeSelection(root){
 const selection=root.ownerDocument.defaultView.getSelection?.();if(!selection?.rangeCount)return null;
 const code=selection.anchorNode?.parentElement?.closest('pre > code');if(!code||!root.contains(code)||!code.contains(selection.focusNode))return null;
 const offset=(node,end)=>{const range=root.ownerDocument.createRange();range.selectNodeContents(code);range.setEnd(node,end);return range.toString().length;};
 return {code,anchor:offset(selection.anchorNode,selection.anchorOffset),focus:offset(selection.focusNode,selection.focusOffset)};
}
export function restoreCodeSelection(saved){
 if(!saved?.code.isConnected)return;const node=saved.code.firstChild;if(node?.nodeType!==3)return;
 const selection=saved.code.ownerDocument.defaultView.getSelection?.();selection?.setBaseAndExtent(node,Math.min(saved.anchor,node.length),node,Math.min(saved.focus,node.length));
}
export function adoptCodeBlocks(root,{previous=[],writeClipboard}={}){
 const blocks=[];
 for(const [index,pre] of [...root.querySelectorAll('pre')].entries()){
  const code=pre.querySelector(':scope > code');if(!code)continue;
  const old=previous[index],source=code.textContent;
  // Reuse only matching source prefixes. A regenerated answer must not inherit stale feedback.
  const reusable=old?.dataset.language===languageOf(code)&&source.startsWith((sourceStates.get(old)?.source??old.querySelector('pre > code').textContent).replace(/\n$/,''));
  const marker=root.ownerDocument.createComment('code');pre.before(marker);
  const block=reusable?old:createBlock(pre,{writeClipboard});
  if(reusable){const scroller=block.querySelector('pre'),left=scroller.scrollLeft,top=scroller.scrollTop;updateSource(block,source);pre.replaceWith(block);scroller.scrollLeft=left;scroller.scrollTop=top;}
  marker.replaceWith(block);
  blocks.push(block);
 }
 return blocks;
}
