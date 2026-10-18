import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createBrowserFeatures} from '../../../src/features/browser/browser-features.mjs';

async function setup(t,extra={}){
 const directory=await mkdtemp(path.join(tmpdir(),'kuneco-browser-features-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let scope={owner:'account-a',environmentId:'environment-a'},url='https://example.com/page';const events=[];
 const storage=new EventEmitter();storage.extensions={loadExtension:async()=>({id:'extension',name:'Test'}),removeExtension(){},getExtension(){return null;}};storage.setPermissionCheckHandler=fn=>{storage.check=fn;};storage.setPermissionRequestHandler=fn=>{storage.request=fn;};
 const wc=new EventEmitter();wc.session=storage;wc.getURL=()=>url;wc.getTitle=()=> 'Page';wc.setZoomFactor=()=>{};wc.getZoomFactor=()=>1;
 const tab={id:'tab-a',wc,started:true,url,title:'Page'};
 const service=createBrowserFeatures({app:{getPath:name=>name==='userData'?directory:path.join(directory,'downloads')},safeStorage:{isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text),decryptString:bytes=>bytes.toString()},dialog:{showOpenDialog:async()=>({canceled:true})},shell:{openPath:async()=>'',openExternal:async()=>{},showItemInFolder(){}},getWindow:()=>null,getScope:()=>scope,getTabs:()=>[tab],getActive:()=>tab,openURL(){},emit:(kind,payload)=>events.push({kind,payload}),valid:()=>true,clearSites:async()=>{},...extra});
 t.after(()=>service.invalidate());await service.configured(storage,{...scope});
 return {service,storage,wc,tab,events,get scope(){return scope;},switchScope:()=>{scope={...scope,environmentId:'environment-b'};service.invalidate();},navigate:value=>{url=value;}};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('Expected async state did not settle');}

test('permission check rejects cross-origin frames and a changed environment',async t=>{
 const c=await setup(t);await c.service.operate('permission',{origin:'https://example.com',permission:'media-camera',value:'allow'});
 assert.equal(c.storage.check(c.wc,'media','https://example.com',{mediaTypes:['video']}),true);
 assert.equal(c.storage.check(c.wc,'media','https://other.example',{mediaTypes:['video']}),false);
 c.switchScope();assert.equal(c.storage.check(c.wc,'media','https://example.com',{mediaTypes:['video']}),false);
});

test('permission prompt cannot authorize a page after navigation',async t=>{
 const c=await setup(t);let answer; c.storage.request(c.wc,'notifications',value=>{answer=value;},{requestingUrl:'https://example.com'});
 await until(()=>c.events.some(event=>event.kind==='browserPrompt'));
 const prompt=c.events.find(event=>event.kind==='browserPrompt');c.navigate('https://other.example');c.service.answer({id:prompt.payload.id,allow:true});await until(()=>answer!==undefined);assert.equal(answer,false);
});

test('environment switch rejects pending permission and cancels the old download',async t=>{
 const c=await setup(t);let allowed;c.storage.request(c.wc,'notifications',value=>{allowed=value;},{requestingUrl:'https://example.com'});await until(()=>c.events.some(event=>event.kind==='browserPrompt'));
 const item=new EventEmitter();let canceled=0;Object.assign(item,{getURL:()=> 'https://example.com/file',getFilename:()=> 'file.txt',getSavePath:()=>'/tmp/file.txt',getReceivedBytes:()=>0,getTotalBytes:()=>10,isPaused:()=>false,setSaveDialogOptions(){},cancel(){canceled++;item.emit('done',{},'cancelled');}});
 c.storage.emit('will-download',{},item,c.wc);c.switchScope();await until(()=>allowed!==undefined);assert.equal(allowed,false);assert.equal(canceled,1);
 assert.deepEqual((await c.service.operate('get')).downloads,[]);
 const old=await c.service.library.get({owner:'account-a',environmentId:'environment-a'});assert.equal(old.downloads[0].state,'cancelled');
});

test('late history persistence never emits previous environment data',async t=>{
 const c=await setup(t);c.service.library.saveSession=async()=>null;c.service.attach(c.tab);let release;const value=await c.service.library.get(c.scope);c.service.library.history=()=>new Promise(resolve=>{release=()=>resolve({...value,history:[{url:'https://private.example'}]});});
 c.wc.emit('did-finish-load');assert.equal(typeof release,'function');c.switchScope();c.events.length=0;release();await turn();assert.equal(c.events.some(event=>event.kind==='browserLibrary'),false);
});

test('saved settings and metadata survive rereading and remain environment scoped',async t=>{
 const c=await setup(t);await c.service.operate('settings',{showFullUrl:false,askDownload:false});await c.service.operate('bookmark',{url:'https://example.com',title:'Example'});
 const first=await c.service.operate('get');assert.equal(first.settings.showFullUrl,false);assert.equal(first.bookmarks.length,1);
 c.switchScope();const second=await c.service.operate('get');assert.equal(second.settings.showFullUrl,true);assert.deepEqual(second.bookmarks,[]);
});

test('saving tabs in a new environment does not discard the previous environment pending save',async t=>{
 const c=await setup(t);const previous={...c.scope};c.service.saveTabs();c.switchScope();c.tab.url='https://second.example/';c.service.saveTabs();await new Promise(resolve=>setTimeout(resolve,350));
 assert.equal((await c.service.library.session(previous))[0]?.url,'https://example.com/page');
 assert.equal((await c.service.library.session(c.scope))[0]?.url,'https://second.example/');
});


test('container download defaults to Download and completes only after transfer',async t=>{
 let finish;const saved=[];const c=await setup(t,{containerDownloads:{directory:async()=>'/workspace/Download',save:async(...args)=>{saved.push(args);await new Promise(r=>finish=r);}}});
 assert.equal((await c.service.operate('get')).downloadDirectory,'/workspace/Download');await c.service.operate('settings',{askDownload:false});
 const item=new EventEmitter();let staging,resumed=false;Object.assign(item,{getURL:()=> 'https://example.com/file',getFilename:()=> 'file.txt',getSavePath:()=>staging,getReceivedBytes:()=>10,getTotalBytes:()=>10,isPaused:()=>false,setSavePath:p=>staging=p,pause(){},resume(){resumed=true;},cancel(){item.emit('done',{},'cancelled');}});
 c.storage.emit('will-download',{},item,c.wc);await until(()=>resumed);item.emit('done',{},'completed');await until(()=>saved.length===1);
 assert.equal(saved[0][0].environmentId,'environment-a');assert.match(saved[0][2],/^\/workspace\/Download\/file-[a-z0-9]+\.txt$/);assert.notEqual(staging,saved[0][2]);
 assert.equal((await c.service.library.get(c.scope)).downloads[0].state,'saving');finish();await new Promise(r=>setTimeout(r,30));const record=(await c.service.library.get(c.scope)).downloads[0];assert.equal(record.state,'completed');assert.equal(record.container,true);assert.equal(record.path,saved[0][2]);
});

test('container save path prompt accepts absolute paths and retains environment scope',async t=>{
 const c=await setup(t,{containerDownloads:{directory:async()=>'/workspace/Download'}});await c.service.operate('settings',{downloadPath:'/workspace/custom-downloads'});assert.equal((await c.service.operate('get')).settings.downloadPath,'/workspace/custom-downloads');const pending=c.service.operate('chooseDownloadPath');await until(()=>c.events.some(e=>e.kind==='browserPrompt'));const prompt=c.events.find(e=>e.kind==='browserPrompt').payload;
 assert.equal(prompt.pathValue,'/workspace/custom-downloads');assert.throws(()=>c.service.answer({id:prompt.id,allow:true,pathValue:'relative'}));c.service.answer({id:prompt.id,allow:true,pathValue:'/workspace/Download'});await pending;assert.equal((await c.service.operate('get')).settings.downloadPath,'/workspace/Download');c.switchScope();assert.equal((await c.service.operate('get')).settings.downloadPath,'');
});


test('annotation uses current checkbox choice and remembers it per environment',async t=>{
 const c=await setup(t);let captures=0;c.wc.executeJavaScript=async()=> 'selection';c.wc.capturePage=async()=>{captures++;return {toDataURL:()=> 'data:image/png;base64,fixture'};};
 await c.service.operate('settings',{annotationScreenshots:'never'});assert.ok((await c.service.operate('annotationCapture',{includeScreenshot:true})).image);assert.equal(captures,1);assert.equal((await c.service.operate('get')).settings.annotationScreenshots,'always');
 assert.equal((await c.service.operate('annotationCapture',{includeScreenshot:false})).image,null);assert.equal(captures,1);assert.equal((await c.service.operate('get')).settings.annotationScreenshots,'never');
 c.switchScope();assert.equal((await c.service.operate('get')).settings.annotationScreenshots,'ask');
});
