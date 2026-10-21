import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {MemoryStore,memoryScope} from './memory-store.mjs';
const belongs=(item,scope)=>item.owner===scope.owner&&(item.environmentId??null)===scope.environmentId;
const keyOf=scope=>JSON.stringify([scope.owner,scope.environmentId]);
const empty=()=>({version:2,items:[],jobs:[],settings:[],imports:[]});
const offline=error=>!error.status&&error.name!=='AbortError';

// The server owns revisions. The encrypted file is only a read cache + turn outbox.
export class SyncedMemoryStore extends MemoryStore{
 constructor({legacyFile,remote,...options}){super(options);this.legacyFile=legacyFile;this.remote=remote;this.scopes=new Map();this.outbox=[];this.legacy=empty();this.errors=new Map();this.workerId=randomUUID();this.clockOffset=0;}
 async load(){
  const legacy=new MemoryStore({file:this.legacyFile,encrypt:this.encrypt,decrypt:this.decrypt});await legacy.load();this.legacy={version:2,items:legacy.items,jobs:legacy.jobs,settings:legacy.settings,imports:[]};
  try{const raw=await readFile(this.file),cache=JSON.parse(this.decrypt?this.decrypt(raw):raw.toString());if(cache.format!=='kuneco-memory-cache-v1'||!Array.isArray(cache.scopes)||!Array.isArray(cache.outbox))throw Error('invalid cache');
   for(const record of cache.scopes){const scope=memoryScope(record.scope);this.validate(scope,record.payload);this.install(scope,record.payload,record.revision,record.syncedAt);}
   for(const job of cache.outbox){memoryScope(job);if(!job.id||!job.source?.turnId||typeof job.source.userText!=='string')throw Error('invalid outbox');}this.outbox=cache.outbox;
  }catch(error){if(error.code!=='ENOENT')throw Error('记忆缓存无法读取，原文件已保留');}
  this.ready=true;
 }
 validate(scope,payload){if(payload?.version!==2||!['items','jobs','settings'].every(k=>Array.isArray(payload[k])&&payload[k].every(item=>belongs(item,scope)))||!Array.isArray(payload.imports))throw Error('后端记忆数据范围或格式无效');}
 install(scope,payload,revision,syncedAt=new Date().toISOString()){
  this.validate(scope,payload);if(!Number.isSafeInteger(revision)||revision<0)throw Error('记忆版本无效');
  for(const field of ['items','jobs','settings'])this[field]=[...this[field].filter(item=>!belongs(item,scope)),...structuredClone(payload[field])];
  this.scopes.set(keyOf(scope),{scope,revision,payload:structuredClone(payload),syncedAt});
 }
 async cache(){await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});const text=JSON.stringify({format:'kuneco-memory-cache-v1',scopes:[...this.scopes.values()],outbox:this.outbox});await writeFile(this.file+'.tmp',this.encrypt?this.encrypt(text):text,{mode:0o600});await rename(this.file+'.tmp',this.file);}
 serial(work){const task=this.queue.then(work);this.queue=task.catch(()=>{});return task;}
 async readRemote(scope){let snapshot;try{snapshot=await this.remote(scope);}catch(error){this.errors.set(keyOf(scope),error.message);throw error;}if(Number.isFinite(snapshot.serverTime))this.clockOffset=snapshot.serverTime-Date.now();const payload=snapshot.payload??empty();this.validate(scope,payload);return {...snapshot,payload};}
 async writeRemote(scope,revision,payload){let result;try{result=await this.remote(scope,{revision,payload});}catch(error){if(error.status!==409)this.errors.set(keyOf(scope),error.message);throw error;}if(Number.isFinite(result.serverTime))this.clockOffset=result.serverTime-Date.now();return result;}
 async synchronize(scope){
  this.assertReady();const previous=this.scopes.get(keyOf(scope))?.revision;
  for(let attempt=0;attempt<5;attempt++){
   const snapshot=await this.readRemote(scope),payload=structuredClone(snapshot.payload);
   const old={version:2,...Object.fromEntries(['items','jobs','settings'].map(k=>[k,this.legacy[k].filter(i=>belongs(i,scope))]))};
   const hasLegacy=old.items.length||old.jobs.length||old.settings.length,importKey=createHash('sha256').update(JSON.stringify(old)).digest('hex');let changed=false;
   if(hasLegacy&&!payload.imports.includes(importKey)){
    for(const k of ['items','jobs'])for(const item of old[k])if(!payload[k].some(i=>i.id===item.id))payload[k].push(structuredClone(item));
    if(!payload.settings.length)payload.settings=structuredClone(old.settings);payload.imports.push(importKey);changed=true;
   }
   const queued=this.outbox.filter(j=>belongs(j,scope));
   for(const job of queued)if(!payload.jobs.some(j=>j.id===job.id)){payload.jobs.push({...structuredClone(job),status:payload.settings[0]?.automatic===false?'cancelled':'queued'});changed=true;}
   try{
    const result=changed?await this.writeRemote(scope,snapshot.revision,payload):snapshot;
    this.install(scope,payload,result.revision);this.outbox=this.outbox.filter(j=>!belongs(j,scope)||!payload.jobs.some(remote=>remote.id===j.id));this.errors.delete(keyOf(scope));await this.cache();
    if(previous!==result.revision)this.notify(scope);return;
   }catch(error){if(error.status!==409)throw error;}
  }throw Error('记忆正在被其他设备更新，请稍后重试');
 }
 sync(scope,{force=false}={}){scope=memoryScope(scope);return this.serial(async()=>{const cached=this.scopes.get(keyOf(scope));if(!force&&cached&&!this.errors.has(keyOf(scope))&&Date.now()-Date.parse(cached.syncedAt)<5000)return;try{await this.synchronize(scope);}catch(error){this.errors.set(keyOf(scope),error.message);throw error;}});}
 transaction(scope,operation){scope=memoryScope(scope);return this.serial(async()=>{
  try{for(let attempt=0;attempt<5;attempt++){
   await this.synchronize(scope);const state=structuredClone({items:this.items,jobs:this.jobs,settings:this.settings}),result=await operation(state),record=this.scopes.get(keyOf(scope));
   const payload={version:2,...Object.fromEntries(['items','jobs','settings'].map(k=>[k,state[k].filter(i=>belongs(i,scope))])),imports:record.payload.imports};
   try{const saved=await this.writeRemote(scope,record.revision,payload);this.install(scope,payload,saved.revision);this.errors.delete(keyOf(scope));await this.cache().catch(()=>{});this.notify(scope);return structuredClone(result);}catch(error){if(error.status!==409)throw error;}
  }throw Error('记忆正在被其他设备更新，请稍后重试');}catch(error){throw error;}
 });}
 status(scope){scope=memoryScope(scope);const result=super.status(scope),cached=this.scopes.get(keyOf(scope));
  for(const job of this.outbox.filter(j=>belongs(j,scope)))if(!result.jobs.some(j=>j.id===job.id))result.jobs.unshift({id:job.id,status:'queued',attempts:0,createdAt:job.createdAt,source:{chatId:job.source.chatId,turnId:job.source.turnId,engine:job.source.engine,at:job.source.at},localPending:true});
  return {...result,sync:{state:this.errors.has(keyOf(scope))?'offline':cached?'synced':'loading',message:this.errors.get(keyOf(scope))||'',syncedAt:cached?.syncedAt||null,pending:result.jobs.filter(j=>j.localPending).length}};
 }
 async enqueue(scope,source){
  scope=memoryScope(scope);if(!source?.turnId||typeof source.userText!=='string'||!source.userText.trim()||!['cc','codex','deepseek'].includes(source.engine))throw Error('无效的记忆来源');try{return await super.enqueue(scope,source);}catch(error){if(!offline(error))throw error;}
  if(!this.status(scope).automatic)return null;
  // super.enqueue validated this source before attempting its remote transaction.
  const normalized=structuredClone({...source,userText:source.userText.slice(0,12000),assistantText:String(source.assistantText||'').slice(0,6000),at:source.at||new Date().toISOString()}),id=createHash('sha256').update(JSON.stringify([scope,source.turnId])).digest('hex');
  return this.serial(async()=>{if(this.jobs.some(j=>j.id===id)||this.outbox.some(j=>j.id===id))return null;const job={id,...scope,source:normalized,status:'queued',attempts:0,createdAt:new Date().toISOString()};this.outbox.push(job);try{await this.cache();}catch(error){this.outbox=this.outbox.filter(j=>j!==job);throw error;}this.notify(scope);return id;});
 }
 pending(scope){scope=memoryScope(scope);return structuredClone(this.jobs.find(j=>belongs(j,scope)&&(j.status==='queued'||j.status==='running'&&j.leaseUntil<=this.now()))||null);}
 now(){return Date.now()+this.clockOffset;}
 async importLocal(scope,data){scope=memoryScope(scope);return this.serial(async()=>{const previous=this.legacy;this.legacy={...data,imports:[]};try{await this.synchronize(scope);}finally{this.legacy=previous;}this.notify(scope);});}
 async claim(scope,id){return this.transaction(scope,state=>{const job=state.jobs.find(j=>belongs(j,scope)&&j.id===id);if(!job||!(job.status==='queued'||job.status==='running'&&job.leaseUntil<=this.now()))return false;job.status='running';job.workerId=this.workerId;job.leaseUntil=this.now()+120000;job.attempts++;return true;});}
}
