// Cookie values stay in the browser session and authenticated, encrypted account storage.
export const cookieKey=c=>JSON.stringify([c.domain,c.path,c.name]);
export function cookieDetails(c){
 const host=String(c.domain || '').replace(/^\./,'');
 if(!host || /[\s/\\?#@]/.test(host) || typeof c.name!=='string' || typeof c.value!=='string')throw new Error('Cookie 数据无效');
 return {url:(c.secure?'https://':'http://')+host+(c.path || '/'),name:c.name,value:c.value,path:c.path || '/',...(!c.hostOnly?{domain:c.domain}:{}),secure:Boolean(c.secure),httpOnly:Boolean(c.httpOnly),...(c.sameSite?{sameSite:c.sameSite}:{}),...(!c.session && Number.isFinite(c.expirationDate)?{expirationDate:c.expirationDate}:{})};
}
// URL/name removal also deletes same-name parent-domain cookies in Chromium.
export const expireCookie=(storage,c)=>storage.cookies.set({...cookieDetails(c),value:'',expirationDate:1});
export class BrowserCookieSync {
 constructor({storage,request,valid,onError=()=>{},onState=()=>{}}){Object.assign(this,{storage,request,valid,onError,onState});this.lastSuccessAt=null;this.error='';this.syncing=false;this.mode='local';this.dirty=new Map();this.started=false;this.applying=false;this.pending=null;
 this.listener=(_event,c,_cause,removed)=>{if(this.mode==='account' && !this.applying){this.dirty.set(cookieKey(c),removed?null:c);this.schedule();}};storage.cookies.on('changed',this.listener);}
 schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>this.sync().catch(this.onError),1000);this.timer.unref?.();}
 status(){return {state:this.mode==='local'?'local':this.syncing?'syncing':this.error?'error':this.lastSuccessAt?'synced':'idle',lastSuccessAt:this.lastSuccessAt,error:this.error,pendingChanges:this.dirty.size};}
 publish(){this.onState(this.status());}
 enqueue(task){
  const previous=this.pending;
  const job=(async()=>{await previous?.catch(()=>{});this.syncing=true;this.publish();try{const result=await task();this.error='';return result;}catch(error){this.error='Cookie 同步或清理失败，请检查连接后重试';throw error;}finally{this.syncing=false;this.publish();}})();
  this.pending=job;void job.finally(()=>{if(this.pending===job)this.pending=null;}).catch(()=>{});return job;
 }
 async setMode(mode){if(!['local','account'].includes(mode))throw new Error('Cookie 保存方式无效');return this.enqueue(async()=>{clearTimeout(this.timer);this.mode=mode;if(mode==='local'){this.dirty.clear();return;}await this.perform();});}
 sync(){if(this.pending)return this.pending;if(this.mode!=='account' || !this.valid())return Promise.resolve();return this.enqueue(()=>this.perform());}
 assertValid(){if(!this.valid())throw new Error('账号或环境已变化，请重新操作');}
 // Cloud first: failed cloud requests must never silently clear only the local copy.
 // The caller blocks page writes and account/environment changes for this operation.
 clear(matches,clearLocal){return this.enqueue(async()=>{
  clearTimeout(this.timer);this.assertValid();
  if(this.mode==='account'){
   const remote=await this.request();this.assertValid();
   const local=await this.storage.cookies.get({});this.assertValid();
   const rows=new Map((remote.payload===null?local:(remote.payload || [])).map(c=>[cookieKey(c),c]));
   const batch=new Map(this.dirty);for(const [key,c] of batch)c?rows.set(key,c):rows.delete(key);
   const payload=[...rows.values()].filter(c=>!matches(c));
   await this.request({revision:remote.revision,payload});this.assertValid();
   for(const [key,c] of batch)if(this.dirty.get(key)===c)this.dirty.delete(key);
  }
  for(const [key,c] of this.dirty)if(c && matches(c))this.dirty.delete(key);
  this.applying=true;
  try{await clearLocal();this.assertValid();await this.storage.cookies.flushStore();}
  finally{this.applying=false;}
  if(this.mode==='account')this.lastSuccessAt=new Date().toISOString();
 });}
 async perform(){
 if(this.mode!=='account' || !this.valid())return;
 const remote=await this.request();if(this.mode!=='account' || !this.valid())return;
 const initial=!this.started,local=await this.storage.cookies.get({});
 const rows=new Map((remote.payload || []).map(c=>[cookieKey(c),c]));
 // First activation restores the cloud; only initialize it from local when absent.
 if(initial && remote.payload===null)for(const c of local)rows.set(cookieKey(c),c);
 const batch=new Map(this.dirty);for(const [key,c] of batch)c?rows.set(key,c):rows.delete(key);
 const now=Date.now()/1000;for(const [key,c] of rows)if(!c.session && c.expirationDate<=now)rows.delete(key);
 if(this.mode!=='account' || !this.valid())return;
 if((initial && remote.payload===null) || batch.size){await this.request({revision:remote.revision,payload:[...rows.values()]});}
 if(this.mode!=='account' || !this.valid())return;
 for(const [key,c] of batch)if(this.dirty.get(key)===c)this.dirty.delete(key);
 // Changes that occurred during the request win locally and sync next time.
 for(const [key,c] of this.dirty)c?rows.set(key,c):rows.delete(key);
 this.applying=true;try{
 for(const c of local)if(!rows.has(cookieKey(c)))await expireCookie(this.storage,c);
 for(const c of rows.values())if(!local.some(old=>cookieKey(old)===cookieKey(c) && JSON.stringify(old)===JSON.stringify(c)))await this.storage.cookies.set(cookieDetails(c));
 await this.storage.cookies.flushStore();this.assertValid();this.started=true;this.lastSuccessAt=new Date().toISOString();
 }finally{this.applying=false;}
 }
}
