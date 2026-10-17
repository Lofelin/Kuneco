import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

// Account-scoped local history. Persist bounded, encrypted events, never form inputs.
export class ConnectionRecords {
 constructor({directory,encrypt,decrypt}){Object.assign(this,{directory,encrypt,decrypt});this.pending=new Map();}
 file(owner){if(!owner)throw new Error('请先登录');return path.join(this.directory,createHash('sha256').update(owner).digest('hex')+'.bin');}
 async read(owner){
  try{return JSON.parse(this.decrypt(await readFile(this.file(owner)))).slice(0,200);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 }
 async list(owner,environmentId){await this.pending.get(owner)?.catch(()=>{});const entries=await this.read(owner);return environmentId===undefined?entries:entries.filter(item=>Object.hasOwn(item,"environmentId") && item.environmentId===environmentId);}
 append(owner,message,environmentId=null){
  const operation=(this.pending.get(owner) || Promise.resolve()).catch(()=>{}).then(async()=>{
   const entries=await this.read(owner);
   const sanitized=String(message).replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s@]+@/gi,'$1***@').slice(0,600);
   if(entries[0]?.message===sanitized && entries[0]?.environmentId===environmentId)return entries;
   entries.unshift({time:new Date().toISOString(),message:sanitized,environmentId});entries.length=Math.min(entries.length,200);
   await mkdir(this.directory,{recursive:true,mode:0o700});const file=this.file(owner);
   await writeFile(file+'.tmp',this.encrypt(JSON.stringify(entries)),{mode:0o600});await rename(file+'.tmp',file);return entries;
  });
  this.pending.set(owner,operation);operation.finally(()=>{if(this.pending.get(owner)===operation)this.pending.delete(owner);}).catch(()=>{});return operation;
 }
}
