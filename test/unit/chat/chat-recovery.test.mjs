import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {readFile,writeFile,rename,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {mergeChatPayload,saveChatSnapshot} from '../../../src/features/chat/chat-sync.mjs';
import {restoredChat} from '../../../src/features/chat/chat-selection.mjs';
const source=await readFile(new URL('../../../src/app/main.mjs',import.meta.url),'utf8');
const code=source.slice(source.indexOf('const aiSessions=new Map()'),source.indexOf('async function saveEnginePreference'));
const initial={activeAISessionId:'a',sessions:[{id:'a',engine:'cc',project:'',title:'A',environmentId:null}],views:[{id:'a',messages:[{role:'user',text:'original'}]}]};
const clone=value=>structuredClone(value);
function harness(dir,server,key){
 const events=[];
 const storage={isEncryptionAvailable:()=>true,encryptString(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]);},decryptString(buffer){const cipher=createDecipheriv('aes-256-gcm',key,buffer.subarray(0,12));cipher.setAuthTag(buffer.subarray(-16));return Buffer.concat([cipher.update(buffer.subarray(12,-16)),cipher.final()]).toString();}};
 const client={user:{id:'owner'},async chats(){if(!server.online)throw new Error('offline');return clone(server.saved);},async saveChats(value,owner){assert.equal(owner,'owner');if(!server.online)throw new Error('offline');if(value.revision!==server.saved.revision)throw Object.assign(new Error('version conflict'),{status:409});server.saved={revision:value.revision+1,payload:clone(value.payload)};return {revision:server.saved.revision};}};
 const context=vm.createContext({structuredClone,JSON,Map,Date,Promise,Buffer,path,createHash,readFile,writeFile,rename,safeStorage:storage,account:client,app:{getPath:()=>dir},mergeChatPayload,saveChatSnapshot,restoredChat,emit:(type,data)=>events.push({type,data}),runs:new Map(),abortRun:()=>{},setTimeout,clearTimeout,activeContainerId:null,selectedEngine:'cc',codexModel:null,project:'',sessionId:undefined,codexSessionId:undefined});
 vm.runInContext(code,context);
 return {events,context,run:script=>vm.runInContext(script,context),async flush(){await vm.runInContext('sessionSave.catch(()=>{})',context);},seed(value,base=value,revision=1){context.seed=clone(value);context.baseline=clone(base);context.rev=revision;vm.runInContext("chatOwner='owner';chatReady=true;chatRevision=rev;chatBase=baseline;chatViews=seed.views;activeAISessionId='a';for(const item of seed.sessions)aiSessions.set(item.id,item)",context);}};
}
test('offline save survives offline restart, retains baseline, and merges cloud changes after reconnect',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dingtu-chat-recovery-')),key=randomBytes(32),server={online:false,saved:{revision:1,payload:clone(initial)}};
 try{
  const first=harness(dir,server,key);first.seed(initial);first.run("chatViews[0].messages.push({role:'assistant',text:'unsynced-local'})");await assert.rejects(first.run('persistAISessions()'),/offline/);
  const cache=await readFile(first.run("chatCacheFile('owner')"));assert.equal(cache.includes(Buffer.from('unsynced-local')),false);
  const restarted=harness(dir,server,key);await restarted.run('loadAccountChats(false)');await restarted.flush();
  assert.equal(restarted.run('chatViews[0].messages[1].text'),'unsynced-local');assert.equal(restarted.run('chatBase.views[0].messages.length'),1);assert.equal(restarted.run('chatDirty'),true);
  server.saved.revision=2;server.saved.payload.sessions.push({id:'b',engine:'cc',project:'',title:'remote'});server.saved.payload.views.push({id:'b',messages:[{role:'user',text:'cloud-new'}]});server.online=true;
  await restarted.run('persistAISessions()');assert.equal(server.saved.payload.views.find(v=>v.id==='a').messages[1].text,'unsynced-local');assert.equal(server.saved.payload.views.find(v=>v.id==='b').messages[0].text,'cloud-new');assert.equal(restarted.run('chatDirty'),false);assert.ok(restarted.events.some(event=>event.type==='chatSyncRecovered'));
  const final=harness(dir,server,key);await final.run('loadAccountChats(false)');await final.flush();assert.equal(final.run('chatViews.find(v=>v.id==="a").messages[1].text'),'unsynced-local');assert.equal(final.run('chatViews.length'),2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('restart with incompatible cloud messages preserves encrypted local data and never overwrites cloud',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dingtu-chat-conflict-')),key=randomBytes(32),server={online:false,saved:{revision:1,payload:clone(initial)}};
 try{const first=harness(dir,server,key);first.seed(initial);first.run("chatViews[0].messages.push({role:'assistant',text:'local-branch'})");await assert.rejects(first.run('persistAISessions()'));
  server.online=true;server.saved.revision=2;server.saved.payload.views[0].messages.push({role:'assistant',text:'cloud-branch'});
  const second=harness(dir,server,key);await second.run('loadAccountChats(false)');await second.flush();assert.equal(second.run('chatViews[0].messages[1].text'),'local-branch');assert.equal(server.saved.payload.views[0].messages[1].text,'cloud-branch');assert.equal(second.run('chatDirty'),true);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('repeated failed view saves notify once; recovery permits a new failure notice',async()=>{
 const renderer=await readFile(new URL('../../../src/app/renderer.js',import.meta.url),'utf8');
 const notices=[],status={textContent:''};
 const context=vm.createContext({chatEnvironmentID:null,chatOwnerID:'owner',dockerEnvironmentState:{activeId:null},chatViewData:()=>[],toast:text=>notices.push(text),$:()=>status,api:{saveChats:async()=>{throw new Error('offline');}}});
 vm.runInContext(renderer.slice(renderer.indexOf("let lastChatSyncNotice='';"),renderer.indexOf('function saveChatView()')),context);
 for(let i=0;i<5;i++){vm.runInContext('persistChatViews()',context);await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(notices.length,1);assert.match(status.textContent,/对话保存失败.*请勿关闭应用/);
 const recovery=renderer.match(/if\(type==='chatSyncRecovered'[^\n]+/)[0];
 context.type='chatSyncRecovered';context.data={owner:'other'};vm.runInContext(recovery,context);
 vm.runInContext('persistChatViews()',context);await new Promise(resolve=>setImmediate(resolve));assert.equal(notices.length,1);
 context.data={owner:'owner'};vm.runInContext(recovery,context);assert.equal(status.textContent,'对话已保存到当前账号');
 vm.runInContext('persistChatViews()',context);await new Promise(resolve=>setImmediate(resolve));assert.equal(notices.length,2);
});

test('switch/logout preserve pending cache by owner and stale queued saves cannot cross accounts',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dingtu-account-chats-')),key=randomBytes(32),server={online:false,saved:{revision:1,payload:clone(initial)}};
 try{
  const h=harness(dir,server,key);h.seed(initial);h.run("chatViews[0].messages.push({role:'user',text:'A-pending'})");
  await h.run('prepareChatAccountChange()');const fileA=h.run("chatCacheFile('owner')"),cachedA=await readFile(fileA);
  h.run("account.user={id:'B'};account.chats=async()=>({revision:1,payload:{sessions:[{id:'b',engine:'cc',project:'',title:'B'}],views:[{id:'b',messages:[{role:'user',text:'B-only'}]}]}});account.saveChats=async(value,owner)=>{if(owner!=='B')throw new Error('cross-account write');return {revision:value.revision+1};}");
  await h.run('loadAccountChats(false)');await h.flush();assert.equal(h.run('chatViews[0].messages[0].text'),'B-only');assert.deepEqual(await readFile(fileA),cachedA);assert.notEqual(h.run("chatCacheFile('B')"),fileA);
  let release;h.context.blocker=new Promise(resolve=>release=resolve);h.run('sessionSave=blocker;persistAISessions()');h.run("account.user=null;chatGeneration++;chatOwner=null;chatReady=false;aiSessions.clear();chatViews=[]");release();await h.flush();assert.deepEqual(await readFile(fileA),cachedA);
  h.run("account.user={id:'owner'};account.chats=async()=>{throw new Error('offline')};account.saveChats=async()=>{throw new Error('offline')}");await h.run('loadAccountChats(false)');await h.flush();assert.equal(h.run('chatViews[0].messages[1].text'),'A-pending');assert.equal(h.run('chatViews.some(v=>v.id==="b")'),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('late old-account GET cannot restore chats or dirty state into new account',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dingtu-late-chat-')),key=randomBytes(32),server={online:true,saved:{revision:1,payload:clone(initial)}};
 try{const h=harness(dir,server,key);let resolve;h.context.late=new Promise(done=>resolve=done);h.run("account.chats=()=>late");const loading=h.run('loadAccountChats(false)');await new Promise(done=>setImmediate(done));h.run("account.user={id:'B'};chatGeneration++;chatOwner='B';chatViews=[{id:'b',messages:[]}];chatDirty=false");resolve({revision:99,payload:initial});await loading;assert.equal(h.run('chatOwner'),'B');assert.equal(h.run('chatViews[0].id'),'b');assert.equal(h.run('chatDirty'),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('old renderer save success/error cannot change new account status or notifications',async()=>{
 const renderer=await readFile(new URL('../../../src/app/renderer.js',import.meta.url),'utf8'),notices=[],status={textContent:'B-status'};let resolve,reject;
 const context=vm.createContext({chatEnvironmentID:null,chatOwnerID:'A',dockerEnvironmentState:{activeId:null},chatViewData:()=>[],toast:text=>notices.push(text),$:()=>status,api:{saveChats:()=>new Promise((ok,no)=>{resolve=ok;reject=no;})}});
 vm.runInContext(renderer.slice(renderer.indexOf("let lastChatSyncNotice='';"),renderer.indexOf('function saveChatView()')),context);
 vm.runInContext('persistChatViews();chatOwnerID="B"',context);reject(new Error('A offline'));await new Promise(done=>setImmediate(done));assert.equal(status.textContent,'B-status');assert.equal(notices.length,0);
 vm.runInContext('chatOwnerID="A";persistChatViews();chatOwnerID=null',context);resolve({saved:true});await new Promise(done=>setImmediate(done));assert.equal(status.textContent,'B-status');assert.equal(notices.length,0);
});
