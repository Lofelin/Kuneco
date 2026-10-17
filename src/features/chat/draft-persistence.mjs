import {createDraftStore,draftScopeKey} from './draft-store.mjs';
export function mountDraftPersistence({input,form,scope,composer,onReady,onError,store=createDraftStore()}){
 let current=null,loading=false,ready=Promise.resolve(),generation=0,writes=Promise.resolve();
 const active=new Set();
 const panel=document.createElement('section');panel.className='chat-draft-status';panel.setAttribute('aria-live','polite');form.prepend(panel);
 const key=()=>draftScopeKey(scope());
 const fail=error=>{panel.textContent='本机草稿保存失败，请勿关闭应用：'+error.message;onError?.(error.message);};
 const enqueue=task=>{const next=writes.catch(()=>{}).then(task);writes=next;void next.catch(fail);return next;};
 function capture(){if(loading||!current||current!==key())return;const target=current,payload=structuredClone(composer.payload(input.value));return enqueue(()=>store.save(target,payload));}
 function button(label,icon,action,danger=false){const b=document.createElement('app-button');b.className='content-action';if(danger)b.variant='danger';const i=document.createElement('wa-icon');i.slot='start';i.src='assets/icons/'+icon+'.svg';b.append(i,document.createTextNode(label));b.onclick=()=>void action().catch(fail);return b;}
 async function refresh(){const target=current;if(!target)return;const record=await store.read(target);if(target!==current)return;panel.replaceChildren();
  for(const entry of record.outbox){const row=document.createElement('div'),label=document.createElement('span');label.textContent=active.has(entry.id)?'运行中 · 已保存恢复记录':entry.status==='pending'?'待发送 · 尚未提交运行时':'执行结果未知 · 请先核对聊天记录，不会自动重发';const excerpt=document.createElement('p');const payload=typeof entry.payload==='string'?{text:entry.payload,images:[]}:entry.payload;excerpt.textContent=(payload.text||'图片消息').slice(0,100)+(payload.images?.length?' · '+payload.images.length+' 张图片':'');
   row.append(label,excerpt,button('恢复到草稿','copy',async()=>{if(current!==target)return;if(input.value||composer.payload('').images?.length)throw Error('请先处理当前草稿，再恢复这条记录');input.value=payload.text||'';composer.restore(payload);await capture();}),button('移除记录','trash-2',async()=>{await enqueue(()=>store.remove(target,entry.id));await refresh();},true));for(const b of row.querySelectorAll('app-button'))b.disabled=active.has(entry.id);panel.append(row);
  }
 }
 function sync(){const next=key();if(current===next)return ready;current=next;const revision=++generation;loading=Boolean(next);input.value='';composer.restore({images:[]});panel.textContent=next?'正在恢复本机草稿…':'';
  ready=(async()=>{try{await writes.catch(()=>{});if(!next)return;const record=await store.read(next);if(revision!==generation||next!==key())return;input.value=record.draft.text||'';composer.restore(record.draft);await refresh();}catch(error){if(revision===generation)fail(error);throw error;}finally{if(revision===generation){loading=false;onReady?.();}}})();void ready.catch(()=>{});return ready;
 }
 input.addEventListener('input',capture);
 return {sync,capture,isCurrent:target=>target===current&&target===key(),get loading(){return loading||current!==key();},
  async prepare(id,payload){const target=key();await sync();await ready;await writes;if(!target||target!==key()||target!==current)throw Error('对话已变化');await enqueue(()=>store.prepare(target,id,payload));await refresh();return target;},
  async dispatch(target,id){await enqueue(()=>store.dispatch(target,id));active.add(id);if(target===current)await refresh();},
  async accepted(target,message){if(target!==current)return;const sent=typeof message==='string'?{text:message,images:[]}:message;const now=composer.payload(input.value);if(now.text.trim()!==sent.text||JSON.stringify(now.images)!==JSON.stringify(sent.images||[]))return;input.value='';composer.restore({images:[]});await capture();},
  settle(target,id,success){active.delete(id);if(!target)return Promise.resolve();return (success?enqueue(()=>store.remove(target,id)):Promise.resolve()).then(()=>target===current?refresh():undefined);},refresh};
}
