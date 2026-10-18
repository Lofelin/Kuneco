// Cloud object decoding can reinsert image fields in a different key order.
// Compare JSON data structurally while retaining message/image array order.
function equal(a,b){
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>equal(value,b[index]));
 const left=Object.keys(a).filter(key=>a[key]!==undefined),right=Object.keys(b).filter(key=>b[key]!==undefined);
 return left.length===right.length&&left.every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key]));
}
export class ChatSyncConflict extends Error{constructor(){super('对话存在无法自动合并的更新，已保留本机内容，云端未被覆盖');this.code='CHAT_SYNC_CONFLICT';}}
export function mergeChatPayload(base,local,remote){
 function merge(b,l,r,key=''){
  if(equal(l,r)||equal(b,r))return l;
  if(equal(b,l))return r;
  if(key==='activeAISessionId')return l;
  if(['lastViewedAt','updatedAt'].includes(key) && typeof l==='string' && typeof r==='string')return l>r?l:r;
  if(Array.isArray(l)&&Array.isArray(r)){
   if(['sessions','views'].includes(key)){
    const bm=new Map((b||[]).map(v=>[v.id,v])),lm=new Map(l.map(v=>[v.id,v])),rm=new Map(r.map(v=>[v.id,v]));
    return [...new Set([...lm.keys(),...rm.keys()])].map(id=>{if(bm.has(id)&&lm.has(id)&&!rm.has(id))throw new ChatSyncConflict();return merge(bm.get(id),lm.get(id),rm.get(id));}).filter(v=>v!==undefined);
   }
   if(key==='messages'){
    const prefix=(a,c)=>a.length<=c.length && a.every((v,i)=>equal(v,c[i]));
    if(Array.isArray(b) && (!prefix(b,l)||!prefix(b,r)))throw new ChatSyncConflict();
    if(prefix(l,r))return r;if(prefix(r,l))return l;
   }
  }
  if(l&&r&&typeof l==='object'&&typeof r==='object'&&!Array.isArray(l)&&!Array.isArray(r)){
   const out={};for(const k of new Set([...Object.keys(l),...Object.keys(r)])){const value=merge(b?.[k],l[k],r[k],k);if(value!==undefined)out[k]=value;}return out;
  }
  throw new ChatSyncConflict();
 }
 for(const key of ['sessions','views'])for(const item of base?.[key] || [])if(local?.[key]?.some(value=>value.id===item.id) && !remote?.[key]?.some(value=>value.id===item.id))throw new ChatSyncConflict();
 return merge(base,local,remote);
}
export async function saveChatSnapshot({client,owner,revision,payload,base,isCurrent}){
 try{return {...await client.saveChats({revision,payload},owner),payload};}
 catch(error){
  if(error.status!==409)throw error;
  const remote=await client.chats();if(!isCurrent())throw new Error('对话账号已变化');
  const merged=mergeChatPayload(base,payload,remote.payload);
  if(equal(merged,remote.payload))return {revision:remote.revision,payload:merged};
  try{return {...await client.saveChats({revision:remote.revision,payload:merged},owner),payload:merged};}
  catch(retry){if(retry.status===409)throw new ChatSyncConflict();throw retry;}
 }
}
