import {deduplicateMemoryBatch} from './memory-batch-dedup.mjs';
import {validatedMemoryProposals} from './memory-store.mjs';
import {extractionPrompt,extractionSchema,parseExtraction} from './memory-extraction.mjs';
const same=(a,b)=>a?.owner===b?.owner&&(a?.environmentId??null)===(b?.environmentId??null);
export class MemoryService{
 constructor({store,getScope,extract,judge,canRun=()=>true,notify=()=>{},onJobEvent=()=>{},interval=1000}){Object.assign(this,{store,getScope,extract,judge,canRun,notify,onJobEvent,interval});this.running=null;this.stopped=false;}
 start(){this.stopped=false;this.timer=setInterval(()=>void this.tick().catch(()=>{}),this.interval);this.timer.unref();}
 async recordTurn(scope,source){const id=await this.store.enqueue(scope,source);if(id){this.notify(scope);this.onJobEvent(scope,{id,engine:source.engine,status:'queued'});}return id;}
 async tick(){
  if(this.running||this.polling||this.stopped||!this.canRun())return;
  const scope=this.getScope();if(!scope?.owner)return;this.polling=true;try{await this.store.sync?.(scope);}catch{return;}finally{this.polling=false;}if(this.running||this.stopped||!same(scope,this.getScope())||!this.canRun()||!this.store.status(scope).automatic)return;
  const job=this.store.pending(scope);if(!job||!this.canRun(job))return;const storage=this.store.storageMode?.(scope),controller=new AbortController();let finish;this.running={controller,scope,id:job.id,finished:new Promise(resolve=>{finish=resolve;})};
  const valid=()=>!this.stopped&&same(scope,this.getScope())&&storage===this.store.storageMode?.(scope)&&this.canRun(job)&&this.store.status(scope).automatic;
  const guard=setInterval(()=>{if(!valid())controller.abort();},250);guard.unref();const timeout=setTimeout(()=>controller.abort('timeout'),90000);timeout.unref();
  try{
   if(this.store.claim){if(!await this.store.claim(scope,job.id))return;}else await this.store.jobState(scope,job.id,'running');this.onJobEvent(scope,{id:job.id,engine:job.source.engine,status:'running'});if(!valid())throw Error('提取作用域已变化');
   const related=this.store.recall(scope,job.source.userText,{project:job.source.project,limit:12,budget:14000,forExtraction:true});
   // Include tombstones by key as well: deleting a memory must not resurrect it on replay.
   const tombstones=this.store.list(scope,{includeDeleted:true}).filter(i=>i.status==='deleted').slice(-15);
   const raw=await this.extract({job,schema:extractionSchema(job),prompt:extractionPrompt(job,this.judge?[]:[...related,...tombstones]),signal:controller.signal,canStart:valid});
   if(controller.signal.aborted||!valid())throw Error('提取已暂停');
   let proposals=validatedMemoryProposals(job,parseExtraction(raw));
   if(this.judge&&proposals.length){this.onJobEvent(scope,{id:job.id,engine:job.source.engine,status:'running',phase:'dedup'});const pools=await Promise.all(proposals.map(p=>this.store.dedupCandidates?this.store.dedupCandidates(scope,p,job):Promise.resolve([...related,...tombstones])));proposals=await deduplicateMemoryBatch({proposals,pools,judge:(prompt,schema)=>this.judge({job,prompt,schema,signal:controller.signal,canStart:valid})});}
   if(controller.signal.aborted||!valid())throw Error('提取已暂停');
   const ids=await this.store.apply(scope,job.id,proposals);this.onJobEvent(scope,{id:job.id,engine:job.source.engine,status:this.store.status(scope).jobs.find(j=>j.id===job.id).status,count:ids.length});
  }catch(error){
   const interrupted=controller.signal.reason!=='timeout'&&(controller.signal.aborted||!same(scope,this.getScope())||!this.canRun(job)||this.stopped);
   await this.store.jobState(scope,job.id,interrupted?'queued':'failed',interrupted?null:(controller.signal.reason==='timeout'?'记忆提取超时，可单独重试提取。':error.message)).catch(()=>{});
   this.onJobEvent(scope,{id:job.id,engine:job.source.engine,status:this.store.status(scope).jobs.find(j=>j.id===job.id).status,error:this.store.status(scope).jobs.find(j=>j.id===job.id)?.error});
  }finally{clearInterval(guard);clearTimeout(timeout);this.running=null;this.notify(scope);finish();}
 }
 async retry(scope,id){const job=this.store.status(scope).jobs.find(j=>j.id===id);if(!job||job.status!=='failed')throw Error('只有失败的提取任务可以重试');await this.store.jobState(scope,id,'queued');this.notify(scope);}
 async stop(){this.stopped=true;clearInterval(this.timer);const running=this.running;running?.controller.abort();await running?.finished;await this.store.queue;}
}
