import {BrowserLibrary,validateSettings,migrateBrowserPermissionDefaults} from './browser-library.mjs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {readFile,copyFile,constants} from 'node:fs/promises';

export const ACCOUNT_BROWSER_SETTINGS=['webLinks','localLinks','showFullUrl','annotationScreenshots'];
const accountCollections=['bookmarks'],environmentCollections=['permissions','agentRules','extensions','tabs'];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const serial=new Map();
const copy=value=>structuredClone(value);
function project(data,kind){
 const settings=Object.fromEntries(Object.entries(data.settings).filter(([k])=>ACCOUNT_BROWSER_SETTINGS.includes(k)===(kind==='account')));
 const result={settings,...(kind==='environment'?{permissionDefaultsVersion:data.permissionDefaultsVersion||2}:{})};for(const k of kind==='account'?accountCollections:environmentCollections)result[k]=copy(data[k]);
 if(result.extensions)result.extensions=result.extensions.map(({id,name,enabled})=>({id,name,enabled}));
 return result;
}
function apply(data,payload,kind){
 if(!payload)return;validateSettings(payload.settings||{});
 const allowed=Object.keys(project(data,kind).settings);
 for(const [k,v] of Object.entries(payload.settings||{}))if(allowed.includes(k))data.settings[k]=copy(v);
 for(const k of kind==='account'?accountCollections:environmentCollections){
  if(!Array.isArray(payload[k]))continue;
  if(k==='extensions')data[k]=payload[k].map(item=>({...item,path:data[k].find(x=>x.id===item.id)?.path||'',available:Boolean(data[k].find(x=>x.id===item.id)?.path)}));
  else data[k]=copy(payload[k]);
 }
}
// Rebase only this operation's changed fields/IDs, preserving concurrent edits.
function rebase(latest,before,after){
 const result=copy(latest||before);
 result.settings||={};for(const [k,v] of Object.entries(after.settings))if(!equal(v,before.settings[k]))result.settings[k]=copy(v);
 for(const k of Object.keys(after).filter(k=>k!=='settings'&&k!=='permissionDefaultsVersion')){
  if(equal(before[k],after[k]))continue;
  if(k==='tabs'){result[k]=copy(after[k]);continue;}
  const old=new Map(before[k].map(x=>[x.id,x])),next=new Map(after[k].map(x=>[x.id,x]));
  result[k]=(result[k]||[]).filter(x=>!old.has(x.id)||next.has(x.id));
  for(const [id,v] of next)if(!equal(v,old.get(id))){const i=result[k].findIndex(x=>x.id===id);if(i<0)result[k].push(copy(v));else result[k][i]=copy(v);}
 }
 return result;
}

/** Shared data is remote-authoritative; offline reads use a private local cache.
 * Shared writes require an acknowledged revision; local-only writes remain usable. */
export class ScopedBrowserLibrary extends BrowserLibrary {
 constructor(options){super(options);this.remote=options.remote;this.last=new Map();this.status=new Map();}
 cacheFile(scope,kind){return path.join(this.directory,`scope-${createHash('sha256').update(JSON.stringify([scope.owner,kind,kind==='account'?null:scope.environmentId])).digest('hex')}.json`);}
 enqueue(scope,fn){const key=this.directory+'|'+scope.owner;const task=(serial.get(key)||Promise.resolve()).catch(()=>{}).then(fn);serial.set(key,task);return task.finally(()=>{if(serial.get(key)===task)serial.delete(key);});}
 async snapshot(scope,kind,seed){
  const route=kind==='account'?'account':'environment:'+(scope.environmentId||'local');
  let snapshot=await this.remote(scope,route);
  if(snapshot.payload===null){try{const result=await this.remote(scope,route,{revision:snapshot.revision,payload:seed});snapshot={...result,payload:seed};}catch(error){if(error.status!==409)throw error;snapshot=await this.remote(scope,route);}}
  if(kind==='environment')for(let attempt=0;attempt<3;attempt++){
   const payload=copy(snapshot.payload);if(!migrateBrowserPermissionDefaults(payload))break;
   try{snapshot={...await this.remote(scope,route,{revision:snapshot.revision,payload}),payload};break;}catch(error){if(error.status!==409||attempt===2)throw error;snapshot=await this.remote(scope,route);}
  }
  return snapshot;
 }
 async hydrate(scope,data,{fresh=false,strict=false}={}){
  for(const kind of ['account','environment']){
   // A local environment's paths and device permissions must never cross devices.
   if(kind==='environment'&&!scope.environmentId)continue;
   const file=this.cacheFile(scope,kind),timestamp=this.last.get(file)||0;
   try{
    if(fresh||Date.now()-timestamp>15000||(kind==='account'&&!data.accountScopeMigrated)){let snapshot=await this.snapshot(scope,kind,project(data,kind));
     if(kind==='account'&&!data.accountScopeMigrated){
      for(let attempt=0;attempt<3;attempt++){const bookmarks=[...(snapshot.payload.bookmarks||[])];for(const item of data.bookmarks)if(!bookmarks.some(x=>x.url===item.url))bookmarks.push(item);
       if(equal(bookmarks,snapshot.payload.bookmarks||[]))break;
       try{const payload={...snapshot.payload,bookmarks};snapshot={...await this.remote(scope,'account',{revision:snapshot.revision,payload}),payload};break;}catch(error){if(error.status!==409||attempt===2)throw error;snapshot=await this.snapshot(scope,kind,project(data,kind));}
      }
      data.accountScopeMigrated=true;
     }
     await this.write(file,snapshot);this.last.set(file,Date.now());}
    const snapshot=JSON.parse(await readFile(file,'utf8'));apply(data,snapshot.payload,kind);this.status.set(file,'synced');
   }catch(error){
    this.last.delete(file);this.status.set(file,'offline');if(strict)throw error;
    try{apply(data,JSON.parse(await readFile(file,'utf8')).payload,kind);}catch{}
   }
  }
  return data;
 }
 async get(scope){if(!this.remote)return super.get(scope);return this.enqueue(scope,async()=>{
  const data=await this.hydrate(scope,await this.read(this.file(scope)));
  if(data.accountScopeMigrated){await copyFile(this.file(scope),this.file(scope)+'.pre-scope',constants.COPYFILE_EXCL).catch(e=>{if(!['ENOENT','EEXIST'].includes(e.code))throw e;});await this.write(this.file(scope),data);}
  const result=await this.public(data);result.syncStatus=['account','environment'].some(k=>this.status.get(this.cacheFile(scope,k))==='offline')?'offline':'synced';return result;
 });}
 async mutate(scope,fn){if(!this.remote)return super.mutate(scope,fn);return this.enqueue(scope,async()=>{
  const data=await this.hydrate(scope,await this.read(this.file(scope)));await this.vault(data);
  const before=copy(data);await fn(data);
  for(const kind of ['account','environment']){
   if(kind==='environment'&&!scope.environmentId)continue;
   const old=project(before,kind),next=project(data,kind);if(equal(old,next))continue;
   const route=kind==='account'?'account':'environment:'+scope.environmentId;
   let saved=false;
   for(let attempt=0;attempt<3;attempt++){
    const latest=await this.snapshot(scope,kind,old),payload=rebase(latest.payload,old,next);
    try{const result=await this.remote(scope,route,{revision:latest.revision,payload});await this.write(this.cacheFile(scope,kind),{...result,payload});apply(data,payload,kind);this.last.set(this.cacheFile(scope,kind),Date.now());saved=true;break;}catch(error){if(error.status!==409)throw error;}
   }
   if(!saved)throw Error('设置已在其他设备更新，请重试');
  }
  // Account/environment migration never deletes the original local-only data.
  await copyFile(this.file(scope),this.file(scope)+'.pre-scope',constants.COPYFILE_EXCL).catch(e=>{if(!['ENOENT','EEXIST'].includes(e.code))throw e;});await this.write(this.file(scope),data);return this.public(data);
 });}
 async session(scope){if(!this.remote)return super.session(scope);return this.enqueue(scope,async()=>copy((await this.hydrate(scope,await this.read(this.file(scope)))).tabs));}
}
