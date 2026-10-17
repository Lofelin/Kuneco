import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {learningQuestions} from './learning-library.mjs';
import {validateSchedule,nextRuns} from './automation-schedule.mjs';
export class LearningAutomations{
 constructor({file,context,execute,notify=()=>{}}){Object.assign(this,{file,context,execute,notify});this.items=[];this.running=new Map();this.saving=Promise.resolve();}
 async load(){try{this.items=JSON.parse(await readFile(this.file,'utf8'));if(!Array.isArray(this.items))throw new Error('invalid');for(const item of this.items){if(item.status==='running')item.status='interrupted';if(item.enabled)item.nextAt=nextRuns(item.schedule,Date.now(),1)[0] || null;}}catch(e){if(e.code!=='ENOENT')throw new Error('自动化记录无法读取，已停止调度');}this.timer=setInterval(()=>void this.tick().catch(()=>{}),15000);this.timer.unref();}
 list(){const c=this.context();return this.items.filter(i=>i.owner===c.owner && i.environmentId===c.environmentId).map(i=>structuredClone(i));}
 async save(){this.saving=this.saving.catch(()=>{}).then(async()=>{await writeFile(this.file+'.tmp',JSON.stringify(this.items),{mode:0o600});await rename(this.file+'.tmp',this.file);});await this.saving;this.notify();}
 async create(v){const c=this.context();if(!c.owner)throw new Error('请先登录');if(!['cc','codex'].includes(v.engine))throw new Error('请选择 Claude Code 或 Codex');if(!['zh','en'].includes(v.language))throw new Error('请选择对话语言');const name=String(v.name ?? '定时对话').trim();if(!name || name.length>60)throw new Error('请输入自动化名称（最多60字）');const schedule=validateSchedule(v.schedule);const item={id:randomUUID(),owner:c.owner,environmentId:c.environmentId,name,engine:v.engine,language:v.language,schedule,enabled:true,nextAt:nextRuns(schedule,Date.now(),1)[0],cursor:0,history:[],status:'scheduled',createdAt:new Date().toISOString()};this.items.push(item);await this.save();return item;}
 async change(id,action,value={}){const item=this.items.find(i=>i.id===id&&this.list().some(x=>x.id===id));if(!item)throw new Error('自动化不存在');if(action==='rename'){const name=String(value.name || '').trim();if(!name || name.length>60)throw new Error('请输入自动化名称（最多60字）');item.name=name;}else if(action==='delete'){this.running.get(id)?.abort();this.items=this.items.filter(i=>i!==item);}else if(action==='toggle'){item.enabled=!item.enabled;if(!item.enabled)this.running.get(id)?.abort();else item.nextAt=nextRuns(item.schedule,Date.now(),1)[0];}else throw new Error('无效操作');await this.save();}
 async tick(now=Date.now()){
  // One background request at a time; missed runs are skipped rather than replayed.
  if(this.running.size)return;
  const c=this.context();const item=this.items.find(i=>i.enabled&&i.owner===c.owner&&i.environmentId===c.environmentId&&i.nextAt<=now&&i.nextAt);
  if(!item)return;const controller=new AbortController();this.running.set(item.id,controller);item.status='running';item.nextAt=nextRuns(item.schedule,now,1)[0] || null;
  try{await this.save();const q=learningQuestions(item.language)[item.cursor];if(!q){item.enabled=false;item.status='done';return;}
   const result=await this.execute(item,q,controller);if(controller.signal.aborted)throw new Error('任务已暂停');item.sessionId=result.sessionId;item.cursor++;item.history.unshift({at:new Date().toISOString(),question:q.prompt,answer:result.text,status:'done',ip:result.ip});item.status='done';if(item.cursor>=learningQuestions(item.language).length)item.enabled=false;
  }catch(error){item.status='failed';item.history.unshift({at:new Date().toISOString(),status:'failed',error:error.message});}
  finally{item.history=item.history.slice(0,60);this.running.delete(item.id);await this.save();}
 }
 stop(){clearInterval(this.timer);for(const c of this.running.values())c.abort();}
}
