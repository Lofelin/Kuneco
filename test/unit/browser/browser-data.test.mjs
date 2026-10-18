import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {BrowserCookieSync,cookieKey} from '../../../src/features/browser/browser-cookies.mjs';
import {BrowserSiteData,cookieDomain} from '../../../src/features/browser/browser-site-data.mjs';
import {normalizeBrowserMode} from '../../../src/features/browser/browser-routing.mjs';

const cookie=(domain='one.test',value='local')=>({domain,name:'session',path:'/',value,secure:true,hostOnly:true,session:true});
function fixture(){
 const cookies=new EventEmitter(),jar=[cookie(),cookie('two.test')],calls=[];let remote=[cookie('one.test','cloud'),cookie('two.test','cloud')],fail=false;
 cookies.get=async()=>structuredClone(jar);cookies.flushStore=async()=>{};cookies.set=async details=>{calls.push('set');if(details.expirationDate===1)for(let i=jar.length-1;i>=0;i--)if(cookieDomain(jar[i])===(details.domain || new URL(details.url).hostname) && jar[i].name===details.name)jar.splice(i,1);};cookies.remove=async(url,name)=>{calls.push('remove');for(let i=jar.length-1;i>=0;i--)if(cookieDomain(jar[i])===new URL(url).hostname && jar[i].name===name)jar.splice(i,1);};
 const storage={cookies,getCacheSize:async()=>256,clearCache:async()=>{calls.push('cache');},clearAuthCache:async()=>calls.push('auth'),clearData:async options=>calls.push(options)};
 const states=[];const sync=new BrowserCookieSync({storage,valid:()=>true,onState:s=>states.push(s),request:async body=>{if(fail)throw Error('offline');if(body){calls.push('put');remote=structuredClone(body.payload);return {revision:2};}return {revision:1,payload:structuredClone(remote)};}});
 return {storage,sync,jar,calls,states,get remote(){return remote;},set remote(value){remote=value;},set fail(value){fail=value;}};
}
test('preserve automatic, proxy and direct selections; unknown modes stay protected',()=>{for(const mode of ['mixed','proxy','direct'])assert.equal(normalizeBrowserMode(mode),mode);for(const mode of [undefined,'bad'])assert.equal(normalizeBrowserMode(mode),'proxy');});
test('cloud clear failure preserves every local cookie, even when remote would remove them',async()=>{
 const f=fixture();f.sync.mode='account';f.remote=[];let requests=0;
 f.sync.request=async body=>{requests++;if(body)throw Error('offline');return {revision:1,payload:[]};};
 await assert.rejects(f.sync.clear(()=>true,async()=>{f.jar.length=0;}),/offline/);
 assert.equal(requests,2);assert.equal(f.jar.length,2);assert.deepEqual(f.calls,[]);assert.equal(f.sync.status().state,'error');
});
test('single site cloud clear preserves other sites and uploads pending unrelated changes',async()=>{
 const f=fixture();f.sync.mode='account';f.sync.dirty.set(cookieKey(cookie('two.test')),cookie('two.test','new'));
 await f.sync.clear(c=>cookieDomain(c)==='one.test',async()=>{f.calls.push('local');f.jar.shift();});
 assert.deepEqual(f.calls,['put','local']);assert.equal(f.remote.length,1);assert.equal(f.remote[0].value,'new');assert.equal(f.jar[0].domain,'two.test');assert.equal(f.sync.status().state,'synced');assert.ok(f.sync.status().lastSuccessAt);
});
test('sync reports loading then failure, preserves last success and recovers on retry',async()=>{
 const f=fixture();await f.sync.setMode('account');const success=f.sync.status().lastSuccessAt;f.fail=true;
 await assert.rejects(f.sync.sync());assert.equal(f.sync.status().lastSuccessAt,success);assert.equal(f.sync.status().state,'error');
 f.fail=false;await f.sync.sync();assert.equal(f.sync.status().state,'synced');assert.ok(f.states.some(s=>s.state==='syncing'));
});
test('mode switch waits for cleanup and cannot erase its pending work',async()=>{
 const f=fixture();f.sync.mode='account';let release;const gate=new Promise(r=>release=r);let entered;const start=new Promise(r=>entered=r);
 const clear=f.sync.clear(()=>true,async()=>{entered();await gate;});await start;
 const mode=f.sync.setMode('local');assert.equal(f.sync.mode,'account');release();await Promise.all([clear,mode]);assert.equal(f.sync.mode,'local');assert.deepEqual(f.remote,[]);
});
test('site index persists per file, single-site cleanup excludes cookies from broad Chromium clearData',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'kuneco-sites-'));const f=fixture();
 try{const sites=new BrowserSiteData({storage:f.storage,file:path.join(dir,'a.json')});await sites.record('https://one.test:8443/page?secret=not-stored');await sites.save();
  const restored=new BrowserSiteData({storage:f.storage,file:path.join(dir,'a.json')});const result=await restored.list();assert.equal(result.cacheBytes,256);assert.ok(result.sites[0].origins.includes('https://one.test:8443'));assert.equal(result.sites[0].cookies,1);
  await restored.clear({kind:'site',domain:'one.test'},f.sync);assert.equal(f.jar.length,1);const call=f.calls.find(c=>c?.dataTypes);assert.ok(!call.dataTypes.includes('cookies'));assert.ok(call.origins.includes('https://one.test:8443'));assert.ok(!call.origins.includes('https://two.test'));
  const isolated=new BrowserSiteData({storage:{...f.storage,cookies:{get:async()=>[]}},file:path.join(dir,'b.json')});assert.equal((await isolated.list()).sites.length,0);
  clearTimeout(sites.timer);clearTimeout(restored.timer);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('cache-only clearing keeps cookies and never contacts cloud',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'kuneco-sites-'));const f=fixture();f.sync.mode='account';f.fail=true;
 try{await new BrowserSiteData({storage:f.storage,file:path.join(dir,'a.json')}).clear({kind:'cache'},f.sync);assert.deepEqual(f.calls,['cache']);assert.equal(f.jar.length,2);}finally{await rm(dir,{recursive:true,force:true});}
});
