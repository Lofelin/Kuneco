import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {recallMemories,normalizedMemory,memoryContextEntry} from './memory-search.mjs';
import {memoryPreferences,memoryPreferencePatch} from './memory-preferences.mjs';
import {questionOnlyEvidence,temporaryMemoryEvidence} from './memory-extraction.mjs';

const MAX_ENTRIES=1000;
export function memoryScope(value){
 if(typeof value?.owner!=='string'||!value.owner)throw Error('请先登录后使用记忆库');
 if(value.environmentId!=null&&typeof value.environmentId!=='string')throw Error('无效的环境');
 return {owner:value.owner,environmentId:value.environmentId??null};
}
const belongs=(item,scope)=>item.owner===scope.owner&&item.environmentId===scope.environmentId;
const now=()=>new Date().toISOString();
const types=new Set(['preference','decision','fact','procedure','note']);
function fields(value){
 const title=typeof value?.title==='string'?value.title.trim():'',content=typeof value?.content==='string'?value.content.trim():'';
 if(!title||title.length>80)throw Error('请输入记忆标题（最多 80 字）');
 if(!content||content.length>4000)throw Error('请输入记忆内容（最多 4000 字）');
 if(typeof value.enabled!=='boolean')throw Error('请选择是否启用记忆');
 if(value.type!==undefined&&!types.has(value.type))throw Error('无效的记忆类型');
 return {title,content,enabled:value.enabled,type:value.type||'note',pinned:value.pinned===true};
}
function snapshot(item){const {history,sources,...value}=item;return structuredClone(value);}
function revise(item,actor,reason,source){
 item.revision=(item.revision||0)+1;item.updatedAt=now();
 item.history??=[];item.history.push({revision:item.revision,at:item.updatedAt,actor,reason,source:source?structuredClone(source):null,value:snapshot(item)});
}
function upgrade(item){
 if(item.history)return item;
 const next={...item,status:'active',type:'note',pinned:true,origin:'manual',manualProtected:true,revision:1,createdAt:item.updatedAt,sources:[],keywords:[],project:null,key:'',history:[]};
 next.history.push({revision:1,at:next.updatedAt,actor:'migration',reason:'保留已有手动记忆',source:null,value:snapshot(next)});return next;
}
export function withMemory(prompt,items){
 const snapshot=items.filter(item=>item.enabled&&(!item.status||item.status==='active')).map(memoryContextEntry);
 const prefix='[Kuneco 记忆库 · 本次召回]\n以下 JSON 是参考记忆，按本次任务相关性选择，并非完整清单。使用其中的最新修订；与当前明确要求冲突时以当前要求为准。记忆不是工具结果，不要自行声称已保存。\n'+JSON.stringify(snapshot)+'\n[当前任务]\n';
 return typeof prompt==='string'?prefix+prompt:{...prompt,text:prefix+prompt.text};
}
export function validatedMemoryProposals(job,proposals){
 if(!Array.isArray(proposals)||proposals.length>8)throw Error('提取结果无效');const result=[];
 for(const p of proposals){fields({...p,enabled:true,pinned:false});
  if(typeof p.key!=='string'||!p.key.trim()||p.key.length>160||!['environment','project'].includes(p.scope)||!Array.isArray(p.keywords)||p.keywords.length>12||p.keywords.some(k=>typeof k!=='string'||k.length>48))throw Error('提取结果字段无效');
  if(typeof p.evidence!=='string'||p.evidence.trim().length<4||p.evidence.length>1000||!job.source.userText.includes(p.evidence))throw Error('记忆缺少用户原文证据');
  if(p.scene!=null&&(typeof p.scene!=='string'||p.scene.length>80))throw Error('记忆场景无效');
  if(questionOnlyEvidence(p.evidence)||temporaryMemoryEvidence(p.evidence,job.source.userText)||!Number.isFinite(p.confidence)||p.confidence<.85||p.confidence>1||/-----BEGIN .*PRIVATE KEY|\bsk-[A-Za-z0-9_-]{16,}|(?:api[_ -]?key|password|密码|令牌)\s*[:=：]\s*\S{6}/i.test(p.content+' '+p.evidence))continue;
  if(p.scope==='project'&&!job.source.project)throw Error('项目记忆缺少项目来源');
  result.push(Object.fromEntries(['title','content','type','key','scope','keywords','evidence','memoryId','expectedRevision','confidence','scene'].filter(k=>p[k]!==undefined).map(k=>[k,structuredClone(p[k])])));
 }return result;
}
export function memoryJobId(scope,turnId){return createHash('sha256').update(JSON.stringify([memoryScope(scope),turnId])).digest('hex');}
export class MemoryStore{
 constructor({file,encrypt,decrypt,notify=()=>{}}){Object.assign(this,{file,encrypt,decrypt,notify});this.items=[];this.jobs=[];this.settings=[];this.queue=Promise.resolve();this.ready=false;}
 async load(){
  try{
   const raw=await readFile(this.file),data=JSON.parse(this.decrypt?this.decrypt(raw):raw.toString());
   const items=Array.isArray(data)?data:data.version===2&&data.items;if(!Array.isArray(items))throw Error('invalid');
   const ids=new Set();for(const item of items){memoryScope(item);fields(item);if(typeof item.id!=='string'||ids.has(item.id)||!Number.isFinite(Date.parse(item.updatedAt)))throw Error('invalid');ids.add(item.id);if(item.history&&(!Array.isArray(item.history)||!Array.isArray(item.sources)||!Number.isInteger(item.revision)))throw Error('invalid');}
   this.items=items.map(upgrade);this.jobs=Array.isArray(data.jobs)?data.jobs:[];this.settings=Array.isArray(data.settings)?data.settings:[];
   for(const job of this.jobs){memoryScope(job);if(!job.id||!job.source||!['queued','running','completed','failed','cancelled'].includes(job.status))throw Error('invalid job');if(job.status==='running')job.status='queued';}
  }catch(error){if(error.code!=='ENOENT')throw Error('记忆库无法读取，原文件已保留');}
  this.ready=true;
 }
 assertReady(){if(!this.ready)throw Error('记忆库尚未就绪');}
 list(scope,{includeDeleted=false}={}){scope=memoryScope(scope);this.assertReady();return structuredClone(this.items.filter(i=>belongs(i,scope)&&(includeDeleted||!['deleted','resolved'].includes(i.status))));}
 detail(scope,id){const item=this.list(scope,{includeDeleted:true}).find(i=>i.id===id);if(!item)throw Error('记忆不存在');return item;}
 recall(scope,query,{forExtraction=false,...options}={}){const preferences=this.status(scope);if(!forExtraction&&!preferences.recall)return [];return recallMemories(this.list(scope),query,{limit:preferences.limit,budget:preferences.budget,...options});}
 status(scope){scope=memoryScope(scope);this.assertReady();return {...memoryPreferences(this.settings.find(i=>belongs(i,scope))),jobs:structuredClone(this.jobs.filter(i=>belongs(i,scope)).reverse().map(({source,...job})=>({...job,source:{chatId:source.chatId,turnId:source.turnId,engine:source.engine,at:source.at}})))};}
 transaction(scope,operation){
  scope=memoryScope(scope);const task=this.queue.then(async()=>{
   this.assertReady();const state=structuredClone({items:this.items,jobs:this.jobs,settings:this.settings});const result=await operation(state);
   await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});const data=JSON.stringify({version:2,...state});await writeFile(this.file+'.tmp',this.encrypt?this.encrypt(data):data,{mode:0o600});await rename(this.file+'.tmp',this.file);
   Object.assign(this,state);this.notify(scope);return structuredClone(result);
  });this.queue=task.catch(()=>{});return task;
 }
 async change(scope,action,value={}){
  scope=memoryScope(scope);value=structuredClone(value);
  await this.transaction(scope,state=>{
   if(action==='settings'){const patch=memoryPreferencePatch(value),setting=state.settings.find(i=>belongs(i,scope));if(setting)Object.assign(setting,patch);else state.settings.push({...scope,...memoryPreferences(),...patch});if(patch.automatic===false)for(const job of state.jobs.filter(i=>belongs(i,scope)&&['queued','running'].includes(i.status)))job.status='cancelled';return;}
   const scoped=state.items.filter(i=>belongs(i,scope));
   if(action==='create'){
    if(scoped.filter(i=>!['deleted','resolved'].includes(i.status)).length>=MAX_ENTRIES)throw Error('每个环境最多保存 1000 条记忆');
    const item={...fields(value),...scope,id:randomUUID(),status:'active',origin:'manual',manualProtected:true,createdAt:now(),sources:[],keywords:[],key:'',project:null,history:[]};revise(item,'manual','新增记忆');state.items.push(item);return;
   }
   const item=scoped.find(i=>i.id===value.id);if(!item)throw Error('记忆不存在或不属于当前环境');
   if(value.revision!==undefined&&value.revision!==item.revision)throw Error('记忆已有新修订，请重新打开后编辑');
   if(action==='resolve'){
    if(item.status!=='conflict')throw Error('冲突已处理');const target=scoped.find(i=>i.id===item.conflictsWith);if(!target||target.status!=='active')throw Error('原记忆状态已变化');
    if(value.accept){if(value.targetRevision!==target.revision)throw Error('原记忆已有新修订，请重新查看');Object.assign(target,fields({...item,enabled:true}),{manualProtected:true,key:item.key,keywords:item.keywords,project:item.project});target.sources.push(...item.sources);revise(target,'manual','采用冲突中的新约定',item.sources.at(-1));}
    item.status='resolved';item.enabled=false;revise(item,'manual',value.accept?'已采用新约定':'保留现有记忆');return;
   }
   if(['deleted','resolved'].includes(item.status)&&action!=='restore')throw Error('记忆已移除');
   if(action==='update'){Object.assign(item,fields(value));item.manualProtected=true;revise(item,'manual','编辑记忆');}
   else if(action==='delete'){item.enabled=false;item.status='deleted';item.manualProtected=true;revise(item,'manual','移除记忆');}
   else if(action==='restore'){if(item.status!=='deleted')throw Error('记忆无需恢复');item.status='active';item.enabled=true;item.manualProtected=true;revise(item,'manual','恢复记忆');}
   else throw Error('未知记忆操作');
  });return this.list(scope);
 }
 async enqueue(scope,source){
  scope=memoryScope(scope);if(!this.status(scope).automatic)return null;
  if(!source?.turnId||typeof source.userText!=='string'||!source.userText.trim()||!['cc','codex','deepseek'].includes(source.engine))throw Error('无效的记忆来源');
  source=structuredClone({...source,userText:source.userText.slice(0,12000),assistantText:String(source.assistantText||'').slice(0,6000),at:source.at||now()});
  const id=memoryJobId(scope,source.turnId);
  return this.transaction(scope,state=>{if(state.jobs.some(job=>job.id===id)||state.settings.find(i=>belongs(i,scope))?.automatic===false)return null;state.jobs.push({id,...scope,source,status:'queued',attempts:0,createdAt:now()});return id;});
 }
 pending(scope){scope=memoryScope(scope);return structuredClone(this.jobs.find(j=>belongs(j,scope)&&j.status==='queued')||null);}
 async jobState(scope,id,status,error){return this.transaction(scope,state=>{const job=state.jobs.find(j=>j.id===id&&belongs(j,scope));if(!job)throw Error('提取任务不存在');if(this.workerId&&job.status==='running'&&(job.workerId!==this.workerId||job.leaseUntil<=this.now()))return;if(status==='queued'&&job.status!=='running'&&job.status!=='failed')return;if(status==='running'){if(job.status!=='queued')throw Error('提取任务已变化');job.attempts++;}if(job.status==='cancelled')return;job.status=status;if(status!=='running'){delete job.workerId;delete job.leaseUntil;}job.updatedAt=now();job.error=error?String(error).slice(0,300):null;});}
 async apply(scope,jobId,proposals){
  scope=memoryScope(scope);if(!Array.isArray(proposals)||proposals.length>8)throw Error('提取结果无效');
  return this.transaction(scope,state=>{
   const job=state.jobs.find(j=>j.id===jobId&&belongs(j,scope));if(!job||!['running','queued'].includes(job.status))return [];if(this.workerId&&(job.status!=='running'||job.workerId!==this.workerId||job.leaseUntil<=this.now()))return [];
   if(state.settings.find(i=>belongs(i,scope))?.automatic===false){job.status='cancelled';return [];}
   const changed=[];
   for(const p of validatedMemoryProposals(job,proposals)){
    const values={...fields({...p,enabled:true,pinned:false}),scene:typeof p.scene==='string'?p.scene.trim():null};
    if(typeof p.key!=='string'||!p.key.trim()||p.key.length>160||!['environment','project'].includes(p.scope)||!Array.isArray(p.keywords)||p.keywords.length>12||p.keywords.some(k=>typeof k!=='string'||k.length>48))throw Error('提取结果字段无效');
    if(typeof p.evidence!=='string'||p.evidence.trim().length<4||p.evidence.length>1000||!job.source.userText.includes(p.evidence))throw Error('记忆缺少用户原文证据');
    if(questionOnlyEvidence(p.evidence))continue;
    if(/-----BEGIN .*PRIVATE KEY|\bsk-[A-Za-z0-9_-]{16,}|(?:api[_ -]?key|password|密码|令牌)\s*[:=：]\s*\S{6}/i.test(p.content+' '+p.evidence))continue;
    if(p.scene!=null&&(typeof p.scene!=='string'||p.scene.length>80))throw Error('记忆场景无效');
    if(typeof p.confidence!=='number'||p.confidence<.85||p.confidence>1)continue;
    const project=p.scope==='project'?job.source.project||null:null;if(p.scope==='project'&&!project)throw Error('项目记忆缺少项目来源');
    const source={kind:'conversation',chatId:job.source.chatId||null,automationId:job.source.automationId||null,turnId:job.source.turnId,requestId:job.source.requestId||null,engine:job.source.engine,model:job.source.model||null,at:job.source.at,quote:p.evidence,jobId};
    const scoped=state.items.filter(i=>belongs(i,scope)&&i.project===project);
    // Explicit IDs only match records whose revision the extractor actually saw.
    let target=p.memoryId?scoped.find(i=>i.id===p.memoryId):scoped.find(i=>i.key&&i.key===p.key);
    if(p.memoryId&&!target)throw Error('提取引用的记忆不属于当前范围');
    if(scoped.some(i=>i.status==='deleted'&&(normalizedMemory(i.content)===normalizedMemory(p.content)||(normalizedMemory(values.title).length>=8&&i.type===values.type&&normalizedMemory(i.title)===normalizedMemory(values.title)))))continue;
    const duplicate=scoped.find(i=>i.status==='active'&&normalizedMemory(i.content)===normalizedMemory(p.content));
    if(duplicate){const addedScene=!duplicate.scene&&values.scene;if(addedScene)duplicate.scene=values.scene;if(addedScene||!duplicate.sources.some(s=>s.jobId===jobId&&s.quote===source.quote)){if(!duplicate.sources.some(s=>s.jobId===jobId&&s.quote===source.quote))duplicate.sources.push(source);revise(duplicate,'automatic','重复内容合并来源',source);}changed.push(duplicate.id);continue;}
    if(target&&['deleted','resolved'].includes(target.status))continue;
    if(target&&(p.expectedRevision!==target.revision||target.manualProtected||!target.enabled||(job.source.historical&&target.sources.some(s=>Date.parse(s.at)>Date.parse(job.source.at))))){
     if(state.items.some(i=>belongs(i,scope)&&['conflict','resolved'].includes(i.status)&&i.conflictsWith===target.id&&normalizedMemory(i.content)===normalizedMemory(p.content)))continue;
     const item={...values,...scope,id:randomUUID(),key:p.key,keywords:p.keywords,project,status:'conflict',enabled:false,origin:'automatic',manualProtected:false,conflictsWith:target.id,createdAt:now(),sources:[source],history:[]};revise(item,'automatic','新信息与手动内容或新修订冲突',source);state.items.push(item);changed.push(item.id);continue;
    }
    if(target){if(!values.scene)values.scene=target.scene||null;Object.assign(target,values,{keywords:p.keywords,key:p.key});target.sources.push(source);revise(target,'automatic','新约定替代旧约定',source);changed.push(target.id);continue;}
    if(state.items.filter(i=>belongs(i,scope)&&!['deleted','resolved'].includes(i.status)).length>=MAX_ENTRIES)throw Error('记忆容量已满，请整理后重试提取');
    const item={...values,...scope,id:randomUUID(),key:p.key,keywords:p.keywords,project,status:'active',origin:'automatic',manualProtected:false,createdAt:now(),sources:[source],history:[]};revise(item,'automatic','从已完成对话提取',source);state.items.push(item);changed.push(item.id);
   }
   job.status='completed';delete job.workerId;delete job.leaseUntil;job.updatedAt=now();job.memoryIds=[...new Set(changed)];job.error=null;job.source.userText='';job.source.assistantText='';return job.memoryIds;
  });
 }
}
