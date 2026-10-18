// A genuine stdio app-server fixture. It never talks to renderer globals or IPC.
// The desktop suite calls this from its local Codex turn/start branch.
const fs=require('node:fs');
const path=require('node:path');
module.exports=function handleChatRegression({message,cwd,threadId,emit}){
 const text=message.params?.input?.filter(item=>item.type==='text').map(item=>item.text).join('\n')||'';
 const id=/KUNECO_CHAT_REGRESSION:([a-z0-9-]+)/.exec(text)?.[1];
 if(!id)return false;
 const directory=path.join(cwd,'.chat-regression');
 fs.mkdirSync(directory,{recursive:true});
 const receipt=path.join(directory,id+'.receipt.json'),control=path.join(directory,id+'.control.json');
 const turnId='regression-'+id,record={id,turnId,threadId,input:message.params.input,sequence:0,startedAt:Date.now()};
 const save=()=>{const temporary=receipt+'.tmp';fs.writeFileSync(temporary,JSON.stringify(record));fs.renameSync(temporary,receipt);};
 emit({id:message.id,result:{turn:{id:turnId}}});save();
 const timer=setInterval(()=>{
  let next;try{next=JSON.parse(fs.readFileSync(control,'utf8'));}catch{return;}
  if(next.sequence<=record.sequence)return;
  for(const event of next.events||[])emit({method:event.method,params:{threadId,...event.params}});
  record.sequence=next.sequence;save();
  if(next.finish){clearInterval(timer);emit({method:'turn/completed',params:{threadId,turn:{id:turnId,status:next.failure?'failed':'completed',...(next.failure?{error:{message:next.failure}}:{})}}});}
 },20);
 process.once('SIGTERM',()=>{record.interrupted=true;save();clearInterval(timer);process.exit(0);});
 return true;
};
