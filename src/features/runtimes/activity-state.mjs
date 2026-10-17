const terminal=new Set(['completed','failed','stopped','interrupted']);
export function mergeRuntimeActivity(activities,update,now=Date.now()){
 if(!update?.id)return activities;
 const next=[...activities],index=next.findIndex(item=>item.id===update.id),previous=index<0?null:next[index];
 const defined=Object.fromEntries(Object.entries(update).filter(([,value])=>value!==undefined));
 const item={...previous,...defined};
 // Late argument snapshots and progress notifications must not revive a settled call.
 if(previous && terminal.has(previous.status)){item.status=previous.status;item.durationMs=previous.durationMs;item.endedAt=previous.endedAt;}
 if(!previous && !terminal.has(item.status))item.startedAt=now;
 if(terminal.has(item.status) && !previous?.endedAt){item.endedAt=now;if(update.durationMs===undefined && Number.isFinite(item.startedAt))item.durationMs=Math.max(item.durationMs || 0,now-item.startedAt);}
 if(index<0)next.push(item);else next[index]=item;
 return next;
}
