// Local-only data. A durable outbox receipt is written before any runtime IPC.
export function draftScopeKey({owner,environmentId=null,chatId}){
 if(typeof owner!=='string'||!owner||typeof chatId!=='string'||!chatId)return null;
 return JSON.stringify([owner,environmentId,chatId]);
}
export function createDraftStore(indexedDB=globalThis.indexedDB){
 let database;
 const open=()=>database ||= new Promise((resolve,reject)=>{const request=indexedDB.open('kuneco-chat-drafts',1);request.onupgradeneeded=()=>request.result.createObjectStore('conversations');request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();database=null;};resolve(request.result);};request.onerror=()=>{database=null;reject(request.error);};});
 async function transaction(key,change){
  if(!key)throw Error('请先选择已登录账号的对话');const db=await open();
  return new Promise((resolve,reject)=>{const tx=db.transaction('conversations',change?'readwrite':'readonly'),store=tx.objectStore('conversations');let result;const get=store.get(key);
   get.onsuccess=()=>{try{result=get.result||{draft:{text:'',images:[],thinking:'enabled'},outbox:[]};if(change){change(result);store.put(result,key);}}catch(error){tx.abort();reject(error);}};
   tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||Error('草稿保存失败'));tx.onabort=()=>reject(tx.error||Error('草稿保存已中断'));
  });
 }
 return {read:key=>transaction(key),save:(key,draft)=>transaction(key,r=>{r.draft=structuredClone(draft);}),
  prepare:(key,id,payload)=>transaction(key,r=>{r.outbox.push({id,payload:structuredClone(payload),status:'pending',at:new Date().toISOString()});}),
  dispatch:(key,id)=>transaction(key,r=>{const item=r.outbox.find(v=>v.id===id);if(!item)throw Error('待发送记录不存在');item.status='unknown';}),
  remove:(key,id)=>transaction(key,r=>{r.outbox=r.outbox.filter(v=>v.id!==id);})};
}
