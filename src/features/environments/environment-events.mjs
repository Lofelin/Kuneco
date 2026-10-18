import {normalizeEnvironmentPreferences} from '../../shared/environment-preferences.mjs';
import {mkdir,readFile,writeFile,rename,readdir,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {redactLog} from './environment-logs.mjs';

// Persist only diagnostic summaries, never operation arguments, prompts or credentials.
export class EnvironmentEvents {
 constructor({directory,encrypt,decrypt,getPreferences=()=>({})}){Object.assign(this,{directory,encrypt,decrypt,getPreferences});this.pending=new Map();this.listeners=new Map();this.states=new Map();}
 key(owner,id){return createHash('sha256').update(JSON.stringify([owner,id??null])).digest('hex');}
 policy(){return normalizeEnvironmentPreferences(this.getPreferences());}
 trim(rows,expire=this.policy().environmentLogAutoClean){const p=this.policy(),cutoff=Date.now()-p.environmentLogRetentionDays*86400000;return rows.filter(row=>!expire||Date.parse(row.time)>=cutoff);}
 async readKey(key){try{return JSON.parse(this.decrypt(await readFile(path.join(this.directory,key+'.bin'))));}catch(error){if(error.code==='ENOENT')return [];throw error;}}
 async read(owner,id){return this.trim(await this.readKey(this.key(owner,id)));}
 async writeKey(key,rows){await mkdir(this.directory,{recursive:true,mode:0o700});const file=path.join(this.directory,key+'.bin');if(!rows.length){await rm(file,{force:true});return;}await writeFile(file+'.tmp',this.encrypt(JSON.stringify(rows)),{mode:0o600});await rename(file+'.tmp',file);}
 enqueue(key,operation){const work=(this.pending.get(key)||Promise.resolve()).catch(()=>{}).then(operation);this.pending.set(key,work);work.finally(()=>{if(this.pending.get(key)===work)this.pending.delete(key);}).catch(()=>{});return work;}
 async cleanup({manual=false}={}){
  const files=await readdir(this.directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;});let removed=0;
  for(const file of files){if(!/^[a-f0-9]{64}\.bin$/.test(file))continue;const key=file.slice(0,-4);await this.enqueue(key,async()=>{const rows=await this.readKey(key),kept=this.trim(rows,manual||this.policy().environmentLogAutoClean);if(kept.length!==rows.length){await this.writeKey(key,kept);removed+=rows.length-kept.length;}});}
  return {removed};
 }
 startCleanup(){this.stopCleanup();void this.cleanup().catch(()=>{});this.cleanupTimer=setInterval(()=>{void this.cleanup().catch(()=>{});},3600000);this.cleanupTimer.unref?.();}
 stopCleanup(){clearInterval(this.cleanupTimer);}

 record(owner,id,{source,level='INFO',message,time,eventId},stateKey){
  if(!owner)return Promise.resolve();
  const key=this.key(owner,id),clean=redactLog(message).slice(0,2000);
  if(stateKey){const state=key+':'+stateKey;if(this.states.get(state)===clean)return Promise.resolve();this.states.set(state,clean);}
  const entry={eventId:eventId||randomUUID(),time:time||new Date().toISOString(),source,level,message:clean};
  const work=this.enqueue(key,async()=>{
   const history=await this.read(owner,id);if(history.some(row=>row.eventId===entry.eventId))return;
   const rows=this.trim([...history,entry]);
   await this.writeKey(key,rows);
   for(const send of this.listeners.get(key)||[])send(entry);
  });
  return work;
 }
 subscribe(owner,id,send,onError=()=>{}){
  const key=this.key(owner,id),seen=new Set();let stopped=false,loaded=false,buffer=[];
  const deliver=rows=>{const fresh=rows.filter(row=>!seen.has(row.eventId));for(const row of fresh)seen.add(row.eventId);if(!stopped&&fresh.length)send(fresh);};
  const listener=row=>{if(!loaded)buffer.push(row);else deliver([row]);};
  if(!this.listeners.has(key))this.listeners.set(key,new Set());this.listeners.get(key).add(listener);
  void this.read(owner,id).then(rows=>{if(stopped)return;deliver([...rows,...buffer]);buffer=[];loaded=true;},()=>{loaded=true;deliver(buffer);buffer=[];if(!stopped)onError();});
  return ()=>{stopped=true;buffer=[];this.listeners.get(key)?.delete(listener);if(!this.listeners.get(key)?.size)this.listeners.delete(key);};
 }
 async flush(){await Promise.allSettled([...this.pending.values()]);}
}
export function observeEnvironmentOperations(manager,journal,getScope){
 const operations={create:['Environment creation','Environment lifecycle','created'],attach:['Container attachment','Environment lifecycle','created'],createLocal:['Local environment creation','Environment lifecycle','local'],renameEnvironment:['Environment rename','Environment lifecycle'],activate:['Environment switch','Environment lifecycle'],start:['Environment start','Environment lifecycle'],stop:['Environment stop','Environment lifecycle'],deleteResources:['Environment resource deletion','Environment lifecycle'],installRuntime:['Runtime installation','Runtime'],removeRuntime:['Runtime removal','Runtime']};
 for(const [method,[label,source,mode]] of Object.entries(operations)){
  if(typeof manager[method]!=='function')continue;
  const original=manager[method];
  manager[method]=async function(owner,id,...args){
   const target=mode==='created'?getScope().id:mode==='local'?null:id;
   const suffix=source==='Runtime'&&['cc','codex','deepseek'].includes(args[0])?' · '+args[0]:'';
   const record=(env,level,message)=>journal.record(owner,env,{source,level,message}).catch(()=>{});
   await record(target,'INFO',label+' started'+suffix);
   try{const result=await original.call(this,owner,id,...args);await record(mode==='created'?result:target,'INFO',label+' completed'+suffix);return result;}
   catch(error){await record(target,'ERROR',label+' failed'+suffix+': '+redactLog(error.message));throw error;}
  };
 }
}
export function observeRuntimeLaunch(launch,{journal,owner,id,engine,signal}){
 const record=message=>{if(!signal?.aborted)void journal?.record(owner,id,{source:'Runtime',level:'ERROR',message}).catch(()=>{});};
 return options=>{
  try{
   const child=launch(options);
   child.once?.('error',error=>record(engine+' startup failed'+(typeof error.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?' · '+error.code:'')));
   child.once?.('close',(code)=>{if(Number.isInteger(code)&&code!==0)record(engine+' exited unexpectedly · exit code: '+code);});
   return child;
  }catch(error){record(engine+' startup failed; check runtime installation, authentication and environment connection.');throw error;}
 };
}
