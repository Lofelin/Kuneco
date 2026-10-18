import {createDraftStore,draftScopeKey} from './draft-store.mjs';
export function mountDraftPersistence({input,form,scope,composer,onReady,onError,store=createDraftStore()}){
 let current=null,loading=false,ready=Promise.resolve(),generation=0,writes=Promise.resolve();
 const active=new Set();
 const panel=document.createElement('section');panel.className='chat-draft-status';panel.setAttribute('aria-live','polite');panel.hidden=true;form.prepend(panel);
 const key=()=>draftScopeKey(scope());
 const fail=error=>{panel.hidden=false;panel.textContent='本机草稿保存失败，请勿关闭应用：'+error.message;onError?.(error.message);};
 const enqueue=task=>{const next=writes.catch(()=>{}).then(task);writes=next;void next.catch(fail);return next;};
 function capture(){if(loading||!current||current!==key())return;const target=current,payload=structuredClone(composer.payload(input.value));return enqueue(()=>store.save(target,payload));}
 async function refresh(){panel.replaceChildren();panel.hidden=true;}
 function sync(){const next=key();if(current===next)return ready;current=next;const revision=++generation;loading=Boolean(next);input.value='';composer.restore({images:[]});panel.replaceChildren();panel.hidden=true;
  ready=(async()=>{try{await writes.catch(()=>{});if(!next)return;const record=await store.read(next);if(revision!==generation||next!==key())return;input.value=record.draft.text||'';composer.restore(record.draft);await refresh();}catch(error){if(revision===generation)fail(error);throw error;}finally{if(revision===generation){loading=false;onReady?.();}}})();void ready.catch(()=>{});return ready;
 }
 input.addEventListener('input',capture);
 return {sync,capture,isCurrent:target=>target===current&&target===key(),get loading(){return loading||current!==key();},
  async prepare(id,payload){const target=key();await sync();await ready;await writes;if(!target||target!==key()||target!==current)throw Error('对话已变化');await enqueue(()=>store.prepare(target,id,payload));await refresh();return target;},
  async dispatch(target,id){await enqueue(()=>store.dispatch(target,id));active.add(id);if(target===current)await refresh();},
  async accepted(target,message){if(target!==current)return;const sent=typeof message==='string'?{text:message,images:[]}:message;const now=composer.payload(input.value);if(now.text.trim()!==sent.text||JSON.stringify(now.images)!==JSON.stringify(sent.images||[])||JSON.stringify(now.documents||[])!==JSON.stringify(sent.documents||[]))return;input.value='';composer.restore({images:[]});await capture();},
  settle(target,id,success){active.delete(id);if(!target)return Promise.resolve();return (success?enqueue(()=>store.remove(target,id)):Promise.resolve()).then(()=>target===current?refresh():undefined);},refresh};
}
