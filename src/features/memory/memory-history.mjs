import {createHash} from 'node:crypto';
// Use saved conversation text only; never replay a chat or inspect attachments.
export function historicalMemoryTurns(sessions,views,{environmentId=null,running=new Set()}={}){
 const result=[];
 for(const session of sessions){
  if((session.environmentId??null)!==environmentId||running.has(session.id)||!['cc','codex','deepseek'].includes(session.engine))continue;
  const view=views.find(v=>v.id===session.id);if(!view)continue;
  const messages=view.messages||[];
  for(let i=0;i<messages.length;i++){
   const user=messages[i];if(user.role!=='user'||!user.text?.trim())continue;
   let end=i+1;while(end<messages.length&&messages[end].role!=='user')end++;
   const turn=messages.slice(i+1,end),answers=turn.filter(m=>m.role==='assistant'&&m.text?.trim());
   if(!answers.length||turn.some(m=>m.role==='error')||answers.some(m=>m.reasoning?.phase&&m.reasoning.phase!=='completed'))continue;
   if(end===messages.length&&['running','failed','stopped'].includes(view.chatStatus))continue;
   const answer=answers.at(-1),turnId=answers.find(m=>m.fileChangeTurnId)?.fileChangeTurnId||'history:'+createHash('sha256').update(JSON.stringify([session.id,i,user.text,answers.map(m=>m.text)])).digest('hex');
   result.push({historical:true,turnId,chatId:session.id,engine:session.engine,model:session.model||null,project:session.project||null,networkMode:session.networkMode==='direct'?'direct':'proxy',userText:user.text,assistantText:answers.map(m=>m.text).join('\n'),at:user.createdAt||answer.createdAt||session.createdAt||new Date(0).toISOString()});
   i=end-1;
  }
 }
 return result.sort((a,b)=>String(a.at).localeCompare(String(b.at)));
}
export function unprocessedHistory(turns,jobs){const ids=new Set(jobs.map(j=>JSON.stringify([j.source.chatId,j.source.turnId])));return turns.filter(t=>!ids.has(JSON.stringify([t.chatId,t.turnId])));}
