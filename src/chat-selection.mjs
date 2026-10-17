// Automatically restore only unarchived conversations in the owning environment.
export function restoredChat(sessions,{environmentId=null,activeId=null}={}){
 const candidates=sessions.filter(item=>!item.archived && (item.environmentId || null)===environmentId);
 const preferred=candidates.find(item=>item.id===activeId);
 const viewed=[...candidates].sort((a,b)=>(Date.parse(b.lastViewedAt)||0)-(Date.parse(a.lastViewedAt)||0) || Number(b.id===activeId)-Number(a.id===activeId));
 if(Date.parse(viewed[0]?.lastViewedAt))return viewed[0];
 return preferred || [...candidates].sort((a,b)=>(Date.parse(b.updatedAt || b.createdAt)||0)-(Date.parse(a.updatedAt || a.createdAt)||0))[0] || null;
}
