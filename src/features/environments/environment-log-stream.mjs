import {spawn} from 'node:child_process';
import path from 'node:path';
import {parseLogLines,readEnvironmentLogs,environmentLogSince} from './environment-logs.mjs';

// One Docker follow process replays the tail and streams new bytes without a snapshot/follow gap.
export function subscribeEnvironmentLogs({docker,owner,id,prefix,send,valid=()=>true,launch=spawn,journal}){
 let stopped=false,timer,pending=[],sequence=0;
 const children=new Set();
 const active=()=>!stopped&&valid();
 const publish=data=>{if(active())send(data.entries?{...data,entries:data.entries.map(entry=>({...entry,sequence:++sequence}))}:data);};
 const stopEvents=journal?.subscribe(owner,id,entries=>publish({entries}),()=>publish({notice:"应用事件历史读取失败，新增事件仍会继续显示。"}));
 const flush=()=>{clearTimeout(timer);timer=null;if(pending.length)publish({entries:pending.splice(0)});};
 const enqueue=(text,source)=>{if(!active())return;for(const entry of parseLogLines(text,source))pending.push(entry);if(!timer)timer=setTimeout(flush,50);};
 const stop=()=>{if(stopped)return;stopped=true;stopEvents?.();clearTimeout(timer);pending=[];for(const child of children){child.kill();const force=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},1000);force.unref?.();child.once('close',()=>clearTimeout(force));}children.clear();};
 const ready=(async()=>{
  const metadata=await readEnvironmentLogs(docker,owner,id,prefix,{history:false});
  if(!active())return;
  if(journal&&id===null)metadata.notice="";publish({metadata});
  if(id===null){publish({state:journal?'streaming':'unavailable'});return;}
  const {item}=await docker.get(owner,id),endpoint=item.external?.endpoint||docker.endpoint;
  const binary=await docker.binary('docker');
  const since=environmentLogSince(journal?.policy?.());
  if(!active())return;
  const sources=item.external?[['Container',item.external.id]]:[['Worker container',prefix+'-worker'],['Proxy gateway',prefix+'-gateway']];
  let remaining=sources.length;
  publish({state:'streaming'});
  for(const [source,name] of sources){
   if(!active())return;
   const child=launch(binary,['--host',endpoint,'logs','--follow','--timestamps',...since,name],{cwd:docker.sourceRoot,env:{...process.env,DOCKER_HOST:'',DOCKER_CONTEXT:docker.context,PATH:path.join(docker.sourceRoot,'vendor','container-engine','bin')+':'+(process.env.PATH||'/usr/bin:/bin')},stdio:['ignore','pipe','pipe']});
   children.add(child);
   for(const stream of [child.stdout,child.stderr]){
    let partial='';
    stream.setEncoding('utf8');
    stream.on('data',chunk=>{if(!active())return;partial+=chunk;const end=partial.lastIndexOf('\n');if(end>=0){enqueue(partial.slice(0,end),source);partial=partial.slice(end+1);}if(partial.length>1024*1024){enqueue(partial.slice(0,1024*1024)+' … [log line truncated]',source);partial='';}});
    stream.on('end',()=>{if(partial)enqueue(partial,source);partial='';});
   }
   child.on('error',()=>publish({notice:source+'日志订阅失败，请重新打开日志。'}));
   child.once('close',code=>{children.delete(child);flush();if(code)publish({notice:source+'日志订阅已中断，请重新打开日志。'});if(--remaining===0)publish({state:journal?'streaming':'ended',...(journal?{notice:'容器输出流已结束，应用事件仍在接收。'}:{})});});
  }
 })().catch(()=>{publish({notice:journal?'容器输出订阅失败，应用事件仍在接收。':'日志订阅失败，请重新打开日志。',state:journal?'streaming':'ended'});if(!journal)stop();});
 return {stop,ready};
}
