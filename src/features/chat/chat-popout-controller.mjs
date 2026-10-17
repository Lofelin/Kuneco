import {createDraftStore,draftScopeKey} from './draft-store.mjs';
// The parent is the only writer. Popouts never read storage or call a runtime.
export function mountChatPopoutController({api,scope,list,activeDraft,setActiveDraft,messages,running,send,stop,focus,report}){
 const opened=new Map(),store=createDraftStore();let queue=Promise.resolve(),syncing=false;
 const same=s=>s.owner===scope().owner && s.environmentId===scope().environmentId;
 async function draft(s){return s.chatId===scope().chatId?activeDraft(): (await store.read(draftScopeKey(s))).draft;}
 async function publish(entry,error){if(error)entry.error=error;if(!same(entry.scope))return;const value=await draft(entry.scope);if(!same(entry.scope))return;const signature=JSON.stringify(value);if(signature!==entry.signature){entry.signature=signature;entry.revision++;}const item=list().find(v=>v.id===entry.scope.chatId);await api.chatPopout('sync',{scope:entry.scope,title:item?.title,messages:messages(entry.scope.chatId),draft:value.text||'',busy:running(entry.scope.chatId),revision:entry.revision,error:entry.error,status:(value.images?.length||value.documents?.length)?'已附 '+(value.images?.length||0)+' 张图片、'+(value.documents?.length||0)+' 份文档；在主窗口管理附件':undefined});}
 async function sync(){if(syncing)return;syncing=true;try{await api.chatPopout('closeInvalid');for(const [id,entry] of opened){if(!same(entry.scope)){opened.delete(id);continue;}await publish(entry);}}catch{}finally{syncing=false;}}
 async function handle(data){const entry=opened.get(data.scope?.chatId);if(!entry||!same(data.scope)||draftScopeKey(entry.scope)!==draftScopeKey(data.scope))return;
  try{entry.error=null;const before=draftScopeKey(scope());const value=await draft(entry.scope);if(!same(entry.scope)||before!==draftScopeKey(scope()))throw Error('对话已切换，未覆盖草稿，请重试');if(data.revision!==entry.revision||JSON.stringify(value)!==entry.signature)throw Error('草稿已在另一窗口更新，未覆盖；请核对后再发送');
   if(data.action==='stop')await stop(entry.scope.chatId);
   else if(data.action==='focus')await focus(entry.scope.chatId);
   else {const payload={...value,text:data.text};if(entry.scope.chatId===scope().chatId)await setActiveDraft(payload);else await store.save(draftScopeKey(entry.scope),payload);if(!same(entry.scope))return;
    if(data.action==='send'){if(running(entry.scope.chatId))throw Error('此对话正在回复，请勿重复发送');await send(entry.scope,payload,store);}
   }
   await publish(entry);
  }catch(error){await publish(entry,error.message);report?.(error);}
 }
 api.onEvent(event=>{if(event.type==='chatPopoutAction'){queue=queue.catch(()=>{}).then(()=>handle(event.data));}});
 const timer=setInterval(()=>void sync(),500);window.addEventListener('beforeunload',()=>clearInterval(timer));
 return {async open(){const current={...scope()};if(!current.owner||!current.chatId)throw Error('请先选择对话');await api.chatPopout('open',current);const entry=opened.get(current.chatId)||{scope:current,revision:0};opened.set(current.chatId,entry);await publish(entry);},sync};
}
