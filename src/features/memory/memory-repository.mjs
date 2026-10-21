import {buildMemoryHierarchy} from './memory-hierarchy.mjs';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {memoryScope} from './memory-store.mjs';
const same=(i,s)=>i.owner===s.owner&&(i.environmentId??null)===s.environmentId;
const key=s=>JSON.stringify([s.owner,s.environmentId]);

// Storage choice is local-only, so reading a local library never contacts memory APIs.
export class MemoryRepository{
 constructor({local,remote,file,legacyFile,encrypt,decrypt,retriever,notify=()=>{}}){Object.assign(this,{local,remote,file,legacyFile,encrypt,decrypt,retriever,notify});this.modes=new Map();this.modeQueue=Promise.resolve();}
 async load(){
  try{await readFile(this.local.file);}catch(error){if(error.code!=='ENOENT')throw error;try{const data=await readFile(this.legacyFile);await mkdir(path.dirname(this.local.file),{recursive:true,mode:0o700});await writeFile(this.local.file,data,{flag:'wx',mode:0o600});}catch(error){if(!['ENOENT','EEXIST'].includes(error.code))throw error;}}
  await this.local.load();await this.remote.load();
  // Upload is explicit. A scope with no local choice always stays on this device.
  this.remote.legacy={version:2,items:[],jobs:[],settings:[],imports:[]};
  try{const raw=await readFile(this.file),data=JSON.parse(this.decrypt?this.decrypt(raw):raw.toString());if(data.version!==1||!Array.isArray(data.choices))throw Error('invalid');for(const choice of data.choices){const scope=memoryScope(choice);if(!['local','remote'].includes(choice.storage))throw Error('invalid');this.modes.set(key(scope),choice);}}catch(error){if(error.code!=='ENOENT')throw Error('记忆存储设置无法读取，原文件已保留');}
 }
 mode(scope){scope=memoryScope(scope);return this.modes.get(key(scope))?.storage||'local';}
 storageMode(scope){return this.mode(scope);}
 store(scope){return this.mode(scope)==='remote'?this.remote:this.local;}
 get queue(){return Promise.all([this.local.queue,this.remote.queue,this.modeQueue]);}
 list(scope,options){return this.store(scope).list(scope,options);}
 detail(scope,id){return this.store(scope).detail(scope,id);}
 recall(scope,query,options){return this.store(scope).recall(scope,query,options);}
 hierarchy(scope){return buildMemoryHierarchy(this.store(scope).list(scope),{allProjects:true});}
 async recallAsync(scope,query,options={}){const store=this.store(scope),mode=this.mode(scope),preferences=store.status(scope);if(!options.forExtraction&&!preferences.recall)return [];if(!this.retriever)return store.recall(scope,query,options);const items=await this.retriever.recall({scope,mode,items:store.list(scope),query,options:{limit:preferences.limit,budget:preferences.budget,...options}});if(mode!==this.mode(scope))return [];const latest=new Map(store.list(scope).filter(i=>i.enabled&&i.status==='active').map(i=>[i.id,i]));return items.filter(i=>i.memberRefs?i.memberRefs.every(ref=>latest.get(ref.id)?.revision===ref.revision):latest.get(i.id)?.revision===i.revision);}
 async dedupCandidates(scope,proposal,job){const project=proposal.scope==='project'?job.source.project||null:null,items=this.store(scope).list(scope,{includeDeleted:true}).filter(i=>(i.project||null)===project&&i.status!=='resolved');const matching=items.filter(i=>i.key&&i.key===proposal.key);if(!this.retriever)return [...matching,...this.store(scope).recall(scope,proposal.content,{forExtraction:true,project,limit:5})].filter((i,n,a)=>a.findIndex(j=>j.id===i.id)===n).slice(0,5);const ranked=await this.retriever.rank({scope,mode:this.mode(scope),items,query:proposal.title+' '+proposal.content,options:{project,includeInactive:true,timeout:1500}});return [...matching,...ranked.map(i=>i.item)].filter((i,n,a)=>a.findIndex(j=>j.id===i.id)===n).slice(0,5);}
 status(scope){const store=this.store(scope);return {...store.status(scope),storage:this.mode(scope),retrieval:this.retriever?.status(scope,this.mode(scope)),layers:Object.fromEntries(Object.entries(this.hierarchy(scope)).map(([k,v])=>[k,v.length])),localCount:this.local.list(scope,{includeDeleted:true}).filter(i=>i.status!=='resolved').length,sync:store===this.local?{state:'local',message:'',pending:0}:store.status(scope).sync};}
 sync(scope,options){return this.mode(scope)==='remote'?this.remote.sync(scope,options):Promise.resolve();}
 change(scope,action,value){return this.store(scope).change(scope,action,value);}
 enqueue(scope,source){return this.store(scope).enqueue(scope,source);}
 pending(scope){return this.store(scope).pending(scope);}
 jobState(scope,...args){return this.store(scope).jobState(scope,...args);}
 apply(scope,...args){return this.store(scope).apply(scope,...args);}
 async claim(scope,id){const store=this.store(scope);if(store.claim)return store.claim(scope,id);await store.jobState(scope,id,'running');return true;}
 async setStorage(scope,storage){scope=memoryScope(scope);if(!['local','remote'].includes(storage))throw Error('无效的记忆存储位置');
  const task=this.modeQueue.then(async()=>{const previous=this.modes.get(key(scope));this.modes.set(key(scope),{...scope,storage});try{await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});const text=JSON.stringify({version:1,choices:[...this.modes.values()]});await writeFile(this.file+'.tmp',this.encrypt?this.encrypt(text):text,{mode:0o600});await rename(this.file+'.tmp',this.file);}catch(error){if(previous)this.modes.set(key(scope),previous);else this.modes.delete(key(scope));throw error;}this.notify(scope);});this.modeQueue=task.catch(()=>{});await task;
 }
 async uploadLocal(scope){if(this.mode(scope)!=='remote')throw Error('请先选择 云端同步');return this.remote.importLocal(scope,{version:2,...Object.fromEntries(['items','jobs','settings'].map(k=>[k,structuredClone(this.local[k].filter(i=>same(i,scope)))]))});}
}
