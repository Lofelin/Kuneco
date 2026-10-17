import path from 'node:path';
// Usage totals and context occupancy deliberately have separate meanings.
const number=value=>Number.isSafeInteger(value)&&value>=0?value:null;
export function usageDetails(engine,value){
 if(engine==='deepseek')return {input:number(value?.prompt_tokens),output:number(value?.completion_tokens),cacheRead:number(value?.prompt_cache_hit_tokens),contextTokens:number(value?.last_prompt_tokens),contextLimit:null,contextLabel:'最近请求输入（实测）'};
 if(engine==='codex'){const last=value?.context?.last;return {input:number(value?.input_tokens),output:number(value?.output_tokens),cacheRead:number(value?.cached_input_tokens),contextTokens:number(last?.inputTokens),contextLimit:number(value?.context?.modelContextWindow),contextLabel:'最近请求输入（运行时实测）'};}
 const rows=Object.values(value?.modelUsage||{});const sum=key=>rows.length&&rows.every(r=>number(r[key])!==null)?rows.reduce((n,r)=>n+r[key],0):null;
 return {input:sum('inputTokens'),output:sum('outputTokens'),cacheRead:sum('cacheReadInputTokens'),cacheWrite:sum('cacheCreationInputTokens'),contextTokens:null,contextLimit:null,contextLabel:'运行时未提供当前上下文'};
}
export function recordArtifacts(item,activity){
 if(activity?.status!=='completed')return;
 for(const raw of activity.changes||[]){const change={...raw,path:typeof raw.path==='string'&&!path.isAbsolute(raw.path)&&item.project?path.resolve(item.project,raw.path):raw.path};if(typeof change.path!=='string'||!change.path)continue;
  const entries=item.artifacts||=[];const id=activity.id+':'+change.path;if(entries.some(x=>x.id===id))continue;
  entries.push({id,path:change.path,at:new Date().toISOString(),activityId:activity.id,provider:activity.provider,version:entries.filter(x=>x.path===change.path).length+1,...(typeof change.before==='string'&&typeof change.after==='string'?{before:change.before,after:change.after}:{}),...(change.diff?{diff:change.diff}:{}),...(change.unavailable?{unavailable:change.unavailable}:{})});
 }
}
export function insightView(item,views=[]){
 for(const message of views.find(v=>v.id===item.id)?.messages||[])for(const activity of message.reasoning?.activities||[])recordArtifacts(item,activity);
 const seenMaintenance=new Set();const records=(item.tokenUsage||[]).filter(r=>{if(r.purpose!=='compaction')return true;const key=r.at+':'+r.totalTokens;if(seenMaintenance.has(key))return false;seenMaintenance.add(key);return true;});item.tokenUsage=records;return {chatId:item.id,engine:item.engine,model:item.model,artifacts:item.artifacts||[],usage:records.filter(r=>r.purpose!=='compaction').at(-1)||null,totalTokens:records.length?records.reduce((n,r)=>n+(r.totalTokens||0),0):null,compression:item.compression||null};
}
