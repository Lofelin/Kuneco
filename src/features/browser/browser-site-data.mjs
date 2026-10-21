import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {cookieDetails,expireCookie} from './browser-cookies.mjs';

export const cookieDomain=c=>String(c.domain).replace(/^\./,'').toLowerCase();
export function webOrigin(value){try{const url=new URL(value);return /^https?:$/.test(url.protocol)?url.origin:null;}catch{return null;}}
export class BrowserSiteData{
 constructor({storage,file}){this.storage=storage;this.file=file;this.origins=new Set();this.ready=this.load();this.writeQueue=Promise.resolve();}
 async load(){try{for(const value of JSON.parse(await readFile(this.file,'utf8')))if(webOrigin(value))this.origins.add(webOrigin(value));}catch(error){if(error.code!=='ENOENT')this.loadError=true;}}
 async record(value){const origin=webOrigin(value);if(!origin)return;await this.ready;if(this.origins.has(origin))return;this.origins.add(origin);clearTimeout(this.timer);this.timer=setTimeout(()=>void this.save().catch(()=>{this.loadError=true;}),500);this.timer.unref?.();}
 save(){const payload=JSON.stringify([...this.origins]);this.writeQueue=this.writeQueue.catch(()=>{}).then(async()=>{await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});await writeFile(this.file+'.tmp',payload,{mode:0o600});await rename(this.file+'.tmp',this.file);});return this.writeQueue;}
 async list(){
  await this.ready;const cookies=await this.storage.cookies.get({}),rows=new Map();
  const row=domain=>{if(!rows.has(domain))rows.set(domain,{domain,cookies:0,origins:[]});return rows.get(domain);};
  for(const origin of this.origins)row(new URL(origin).hostname).origins.push(origin);
  for(const cookie of cookies){const item=row(cookieDomain(cookie));item.cookies++;const origin=webOrigin(cookieDetails(cookie).url);if(origin&&!item.origins.includes(origin))item.origins.push(origin);}
  return {sites:[...rows.values()].sort((a,b)=>a.domain.localeCompare(b.domain)),cacheBytes:await this.storage.getCacheSize(),indexWarning:this.loadError?'部分站点记录读取失败，全部清理仍覆盖当前环境。':''};
 }
 async clear({kind,domain},sync){
  if(!['cache','site','all'].includes(kind))throw new Error('未知清理类型');
  await this.ready;
  if(kind==='cache'){await this.storage.clearCache();return;}
  const rows=await this.list(),site=rows.sites.find(item=>item.domain===domain);
  if(kind==='site'&&!site)throw new Error('站点已变化，请刷新列表');
  const matches=c=>kind==='all'||cookieDomain(c)===domain;
  await sync.clear(matches,async()=>{
   // Exclude cookies here: Chromium clearData cookies expands to the registrable domain.
   const dataTypes=['backgroundFetch','fileSystems','indexedDB','localStorage','serviceWorkers','webSQL','cache'];
   await this.storage.clearData({dataTypes,...(this.storage.container&&kind==='all'?{origins:rows.sites.flatMap(item=>item.origins)}:{}),...(kind==='site'?{origins:site.origins,originMatchingMode:'origin-in-all-contexts'}:{})});
   const cookies=await this.storage.cookies.get({});
   for(const cookie of cookies)if(matches(cookie))await expireCookie(this.storage,cookie);
   if(kind==='all'){await this.storage.clearAuthCache();this.origins.clear();}
   else for(const origin of site.origins)this.origins.delete(origin);
   await this.save();
  });
 }
}
