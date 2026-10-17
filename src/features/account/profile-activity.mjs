const dayKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function activityTooltip(day,locale='zh-CN'){
 const language=locale==='en-US'?'en-US':'zh-CN';
 const date=new Intl.DateTimeFormat(language,{month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(day.date+'T12:00:00Z'));
 const usage=day.tokens===null?(language==='en-US'?'No Token data':'暂无 Token 数据'):new Intl.NumberFormat(language).format(day.tokens)+' Token';
 return date+' · '+usage;
}
export function profileActivity(sessions,today=new Date()){
 const end=new Date(today.getFullYear(),today.getMonth(),today.getDate());
 const start=new Date(end);start.setDate(start.getDate()-364-start.getDay());
 const counts=new Map();
 for(const session of sessions){const created=new Date(session.createdAt);if(Number.isNaN(created.getTime()) || created>end.getTime()+86400000-1)continue;const key=dayKey(created);counts.set(key,(counts.get(key)||0)+1);}
 const tokens=new Map();let totalTokens=null,peakTokens=null;
 for(const session of sessions)for(const usage of session.tokenUsage || []){
  const at=new Date(usage.at);
  if(Number.isNaN(at.getTime()) || at>end.getTime()+86400000-1 || !Number.isSafeInteger(usage.totalTokens) || usage.totalTokens<0)continue;
  totalTokens=(totalTokens ?? 0)+usage.totalTokens;peakTokens=Math.max(peakTokens ?? 0,usage.totalTokens);
  const key=dayKey(at);tokens.set(key,(tokens.get(key)||0)+usage.totalTokens);
 }
 const days=[];
 for(const cursor=new Date(start);cursor<=end;cursor.setDate(cursor.getDate()+1)){const date=dayKey(cursor),count=counts.get(date)||0;days.push({date,count,tokens:tokens.get(date) ?? null,level:count===0?0:count===1?1:count<=3?2:count<=6?3:4});}
 return {totalTokens,peakTokens,total:sessions.length,archived:sessions.filter(item=>item.archived).length,activeDays:counts.size,days};
}
