import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {validateProxy} from './proxy.mjs';
const providers=new Set(['iproyal','sufe','custom']);
export function profileEgressIdentity(config,scope){return config.profileId?createHash('sha256').update(JSON.stringify(['proxy-profile',scope.owner,scope.environment||null,config.profileId])).digest('hex'):null;}
export class ProxyProfiles {
 constructor({directory,encrypt,decrypt}){Object.assign(this,{directory,encrypt,decrypt});this.writes=new Map();}
 key(scope){if(typeof scope.owner!=='string'||!scope.owner)throw new Error('请先登录账号');return createHash('sha256').update(JSON.stringify([scope.owner,scope.environment||null])).digest('hex');}
 async list(scope,current={}){
  const key=this.key(scope);let data;
  try{data=JSON.parse(await this.decrypt(await readFile(path.join(this.directory,key+'.bin'))));}
  catch(error){if(error.code!=='ENOENT')throw new Error('代理配置列表无法解密，请保留原文件并恢复系统凭据');data={version:1,scope:{owner:scope.owner,environment:scope.environment||null},profiles:[]};}
  if(data.version!==1||data.scope?.owner!==scope.owner||(data.scope.environment||null)!==(scope.environment||null)||!Array.isArray(data.profiles)||data.profiles.length>50)throw new Error('代理配置列表范围或格式无效');
  const activeId=current.host?(current.profileId||'legacy'):null;
  if(activeId&&!data.profiles.some(p=>p.id===activeId))data.profiles.unshift({id:activeId,name:'现有代理',provider:'custom',config:validateProxy(current)});
  return {...data,activeId};
 }
 async get(scope,current,id){const state=await this.list(scope,current);const profile=state.profiles.find(p=>p.id===id);if(!profile)throw new Error('配置不存在或不属于当前账号与环境');return {...profile,config:validateProxy(profile.config)};}
 async resolve(scope,current,config,id){
  if(!config?.useSavedNode&&!config?.useSavedPassword)return config;
  const source=id?(await this.get(scope,current,id)).config:current;
  if(config.useSavedNode){if(!source.node||config.nodeId!==source.nodeId)throw new Error('订阅节点已变化，请重新导入');return {...source,profileInfo:config.profileInfo};}
  if(['protocol','host','port','username'].some(k=>String(config[k]||'')!==String(source[k]||'')))throw new Error('代理已变更，请重新输入密码');
  return {...config,password:source.password||''};
 }
 async save(scope,current,{id,name,provider,config},assertCurrent=()=>{}){
  const key=this.key(scope),previous=this.writes.get(key)||Promise.resolve();
  const operation=previous.catch(()=>{}).then(async()=>{
   assertCurrent();const data=await this.list(scope,current);assertCurrent();
   if(typeof name!=='string'||!name.trim()||name.trim().length>80||/[\x00-\x1f]/.test(name))throw new Error('配置名称需为 1～80 个字符');
   if(!providers.has(provider))throw new Error('请选择有效代理商');
   const existing=id&&data.profiles.find(p=>p.id===id);if(id&&!existing)throw new Error('配置不存在或已切换环境');
   if(!existing&&data.profiles.length>=50)throw new Error('每个环境最多保存 50 条代理配置');
   const profileId=existing?.id||randomUUID();
   const validated=validateProxy({...config,profileId:profileId==='legacy'?undefined:profileId});
   const profile={id:profileId,name:name.trim(),provider,config:validated};
   if(existing)data.profiles[data.profiles.indexOf(existing)]=profile;else data.profiles.push(profile);
   const stored={version:1,scope:data.scope,profiles:data.profiles};
   const bytes=await this.encrypt(JSON.stringify(stored));assertCurrent();
   await mkdir(this.directory,{recursive:true,mode:0o700});const file=path.join(this.directory,key+'.bin'),temp=file+'.'+randomUUID()+'.tmp';
   try{await writeFile(temp,bytes,{mode:0o600});assertCurrent();await rename(temp,file);assertCurrent();}finally{await rm(temp,{force:true});}
   return profile;
  });this.writes.set(key,operation);try{return await operation;}finally{if(this.writes.get(key)===operation)this.writes.delete(key);}
 }
}
