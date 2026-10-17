// Cookie values stay in the browser session and authenticated, encrypted account storage.
export const cookieKey=c=>JSON.stringify([c.domain,c.path,c.name]);
export function cookieDetails(c){
 const host=String(c.domain || '').replace(/^\./,'');
 if(!host || /[\s/\\?#@]/.test(host) || typeof c.name!=='string' || typeof c.value!=='string')throw new Error('Cookie 数据无效');
 return {url:(c.secure?'https://':'http://')+host+(c.path || '/'),name:c.name,value:c.value,path:c.path || '/',...(!c.hostOnly?{domain:c.domain}:{}),secure:Boolean(c.secure),httpOnly:Boolean(c.httpOnly),...(c.sameSite?{sameSite:c.sameSite}:{}),...(!c.session && Number.isFinite(c.expirationDate)?{expirationDate:c.expirationDate}:{})};
}
export class BrowserCookieSync {
 constructor({storage,request,valid,onError=()=>{}}){Object.assign(this,{storage,request,valid,onError});this.mode='local';this.dirty=new Map();this.started=false;this.applying=false;this.pending=null;
 this.listener=(_event,c,_cause,removed)=>{if(this.mode==='account' && !this.applying){this.dirty.set(cookieKey(c),removed?null:c);this.schedule();}};storage.cookies.on('changed',this.listener);}
 schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>this.sync().catch(this.onError),1000);this.timer.unref?.();}
 async setMode(mode){if(!['local','account'].includes(mode))throw new Error('Cookie 保存方式无效');this.mode=mode;clearTimeout(this.timer);if(mode==='local'){await this.pending?.catch(()=>{});this.dirty.clear();return;}await this.sync();}
 sync(){if(this.pending)return this.pending;this.pending=this.perform().finally(()=>{this.pending=null;});return this.pending;}
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
 for(const c of local)if(!rows.has(cookieKey(c)))await this.storage.cookies.remove(cookieDetails(c).url,c.name);
 for(const c of rows.values())if(!local.some(old=>cookieKey(old)===cookieKey(c) && JSON.stringify(old)===JSON.stringify(c)))await this.storage.cookies.set(cookieDetails(c));
 await this.storage.cookies.flushStore();this.started=true;
 }finally{this.applying=false;}
 }
}
