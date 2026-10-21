const same=(a,b)=>a?.owner===b?.owner&&(a?.environmentId??null)===(b?.environmentId??null);
export function memoryHistoryMessage(task){return '历史记忆提取'+(task.failed||task.cancelled?'已结束':'完成')+'：'+task.completed+' 轮成功'+(task.failed?'，'+task.failed+' 轮失败，可在记忆设置重试':'')+(task.cancelled?'，'+task.cancelled+' 轮取消':'')+'。';}
export function mountMemoryHistoryNotifications({api,getScope,show}){
 const shown=new Set();let refreshing=false;
 async function refresh(){if(refreshing||!getScope()?.owner)return;refreshing=true;const expected=getScope();try{const result=await api.memoryLibrary('list');if(!same(expected,getScope())||!same(expected,result.scope))return;for(const task of result.status.historyNotifications||[]){if(!same(expected,getScope()))break;if(!shown.has(task.id)){show(memoryHistoryMessage(task));shown.add(task.id);}await api.memoryLibrary('ackHistoryNotification',{scope:result.scope,id:task.id});}}catch{}finally{refreshing=false;}}
 api.onEvent(({type,data})=>{if(type==='memoryHistoryCompleted'&&same(data,getScope())||['account','dockerEnvironments'].includes(type))void refresh();});void refresh();return {refresh};
}
