// Keep controls separate from message text so persistence and copying never include them.
export function mountMessageActions(block,{text,createdAt,onEdit,onCopy,canEdit=()=>true}){
 const doc=block.ownerDocument,bar=doc.createElement('div');bar.className='message-actions';
 if(createdAt && Number.isFinite(Date.parse(createdAt))){const time=doc.createElement('time');time.dateTime=createdAt;time.textContent=new Date(createdAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}).toLowerCase();time.title=new Date(createdAt).toLocaleString();bar.append(time);}
 for(const [label,icon,callback] of [['复制消息','copy',()=>onCopy(typeof text==='function'?text():text)],...(onEdit?[['编辑消息','pencil',()=>{if(canEdit())onEdit();}]]:[])]){
  const button=doc.createElement('app-button');button.type='button';button.className='icon-button message-action'+(icon==='pencil'?' message-edit-action':'');button.setAttribute('appearance','plain');button.setAttribute('aria-label',label);button.title=label;
  const image=doc.createElement('wa-icon');image.setAttribute('src','assets/icons/'+icon+'.svg');button.append(image);button.onclick=callback;bar.append(button);
 }
 block.append(bar);return bar;
}

export function openMessageEditor(block,{text,onSend,onCancel=()=>{}}){
 if(block.querySelector('.message-editor'))return;
 const doc=block.ownerDocument,editor=doc.createElement('div');editor.className='message-editor';
 const input=doc.createElement('wa-textarea');input.value=text;input.setAttribute('aria-label','编辑消息内容');input.setAttribute('resize','auto');input.rows=2;
 const actions=doc.createElement('div');actions.className='message-editor-actions';
 const error=doc.createElement('div');error.className='message-editor-error';error.setAttribute('role','alert');
 const make=(label,icon)=>{const button=doc.createElement('app-button');button.type='button';button.className='content-action';const image=doc.createElement('wa-icon');image.setAttribute('slot','start');image.setAttribute('src','assets/icons/'+icon+'.svg');button.append(image,doc.createTextNode(label));return button;};
 const cancel=make('取消','x'),send=make('发送','check');send.variant='primary';send.classList.add('primary');
 const close=()=>{editor.remove();block.classList.remove('editing-message');};
 cancel.onclick=()=>{close();onCancel();};
 send.onclick=async()=>{error.textContent='';send.loading=true;send.disabled=cancel.disabled=input.disabled=true;try{await onSend(input.value);close();}catch(e){error.textContent=e.message;}finally{send.loading=false;send.disabled=cancel.disabled=input.disabled=false;}};
 input.addEventListener('keydown',event=>{if(event.key==='Escape'&&!input.disabled){event.preventDefault();cancel.click();}});
 actions.append(cancel,send);editor.append(input,error,actions);block.append(editor);block.classList.add('editing-message');Promise.resolve(input.updateComplete).then(()=>{if(!editor.isConnected)return;input.focus();doc.defaultView.requestAnimationFrame?.(()=>editor.scrollIntoView?.({block:'nearest'}));});return editor;
}
