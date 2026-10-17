import {codexActivity} from './runtime-activity.mjs';
import {createInterface} from 'node:readline';
import {directChatEnvironment,chatRuntimeEnvironment} from './chat-network.mjs';
import {proxyEnvironment} from './proxy.mjs';
import {createRestrictedCCSpawner} from './cc-network-guard.mjs';
import {readCodexModel} from './codex-runner.mjs';
export function codexStreamArguments(){return ['app-server','--listen','stdio://','-c','web_search="live"'];}
export async function runCodexStream({executable,project,prompt,images=[],sessionId,gateway,signal,canStart,onEvent,spawnProcess,model:chosenModel,useLocalModel=true}){
 if(signal?.aborted)throw new Error('请求已取消。');
 const env=chatRuntimeEnvironment(gateway.status?.mode==='direct'?directChatEnvironment(process.env):proxyEnvironment(process.env,gateway.url));
 delete env.OPENAI_BASE_URL;delete env.OPENAI_API_KEY;delete env.CODEX_API_KEY;
 const model=chosenModel || (useLocalModel?await readCodexModel():null);
 const spawnRestricted=spawnProcess || createRestrictedCCSpawner({port:gateway.port,canStart});
 const child=spawnRestricted({command:executable,args:codexStreamArguments(),cwd:project,env,signal});
 const lines=createInterface({input:child.stdout});const pending=new Map(),texts=new Map(),activities=new Map();let sequence=0,threadId,turnId,settled=false,startTimer;
 let resolveDone,rejectDone;const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});
 function finish(error){if(settled)return;settled=true;clearTimeout(startTimer);error?rejectDone(error):resolveDone();}
 function request(method,params){if(settled)return;const id=++sequence;pending.set(id,method);child.stdin.write(JSON.stringify({id,method,params})+'\n');}
 const fail=message=>finish(new Error(signal?.aborted?'请求已取消。':message || 'Codex 请求失败，请检查登录、模型与网络。'));
 const abort=()=>{if(threadId && turnId)request('turn/interrupt',{threadId,turnId});finish(new Error('请求已取消。'));child.kill('SIGTERM');};
 child.on('error',()=>fail('Codex CLI 无法启动，请检查安装。'));child.on('close',()=>{if(!settled)fail('Codex 连接已中断，请重试。');});child.stdin.on('error',()=>{if(!settled)fail('Codex 连接已中断。');});
 lines.on('line',line=>{
  let event;try{event=JSON.parse(line);}catch{return;}
  if(event.method && event.id!==undefined){
   let result;if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(event.method))result={decision:'acceptForSession'};
   else if(event.method==='item/permissions/requestApproval')result={permissions:event.params?.permissions || {},scope:'session'};
   child.stdin.write(JSON.stringify(result?{id:event.id,result}:{id:event.id,error:{code:-32601,message:'Client handler unavailable for '+event.method}})+'\n');return;
  }
  if(event.id!==undefined){
   const method=pending.get(event.id);pending.delete(event.id);if(!method)return;
   if(event.error){fail(event.error.message);return;}
   if(method==='initialize'){
    child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    request(sessionId?'thread/resume':'thread/start',{...(sessionId?{threadId:sessionId}:{}),cwd:project,model:model || undefined,modelProvider:'openai',approvalPolicy:'never',sandbox:'danger-full-access',baseInstructions:'',developerInstructions:''});
   }else if(method==='thread/start' || method==='thread/resume'){
    threadId=event.result?.thread?.id;if(!threadId){fail('Codex 未返回会话 ID。');return;}onEvent('session',threadId);
    request('turn/start',{threadId,input:[{type:'text',text:prompt},...images.map(image=>typeof image==='string'?{type:'localImage',path:image}:{type:'image',url:image.dataURL})],model:model || undefined,approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'}});
   }else if(method==='turn/start'){turnId=event.result?.turn?.id;clearTimeout(startTimer);}
   return;
  }
  const p=event.params || {};if(p.threadId && threadId && p.threadId!==threadId)return;
  if(['item/started','item/updated','item/completed'].includes(event.method) && p.item){const types={commandExecution:'command_execution',fileChange:'file_change',mcpToolCall:'mcp_tool_call',webSearch:'web_search',imageView:'image_view',imageGeneration:'image_generation',collabAgentToolCall:'collab_tool_call',agentMessage:'agent_message',userMessage:'user_message'};const item={...p.item,type:types[p.item.type] || p.item.type,aggregated_output:p.item.aggregatedOutput,exit_code:p.item.exitCode};const activity=codexActivity({type:({'item/started':'item.started','item/updated':'item.updated','item/completed':'item.completed'})[event.method],item});if(activity){activities.set(activity.id,activity);onEvent('activity',activity);}}
  if(['item/commandExecution/outputDelta','item/fileChange/outputDelta'].includes(event.method)){const activity=activities.get(p.itemId);if(activity){const next={...activity,detail:(typeof activity.detail==='string'?activity.detail:'')+(p.delta || '')};activities.set(next.id,next);onEvent('activity',next);}}
  if(event.method==='item/reasoning/summaryTextDelta' && p.delta)onEvent('process',{text:p.delta});
  if(event.method==='item/agentMessage/delta' && typeof p.delta==='string'){
   const key=p.itemId || 'message';texts.set(key,(texts.get(key)||'')+p.delta);onEvent('text',p.delta);
  }else if(event.method==='item/completed' && p.item?.type==='agentMessage'){
   const text=p.item.text || '',sent=texts.get(p.item.id)||'';
   if(text.startsWith(sent) && text.length>sent.length)onEvent('text',text.slice(sent.length));
   texts.set(p.item.id,text);onEvent('text','\n\n');
  }
  else if(event.method==='thread/tokenUsage/updated'){const usage=p.tokenUsage?.last || p.tokenUsage?.total;if(usage)onEvent('usage',{input_tokens:usage.inputTokens,output_tokens:usage.outputTokens,cached_input_tokens:usage.cachedInputTokens});}
  else if(event.method==='turn/completed'){if(p.turn?.status==='completed')finish();else fail(p.turn?.error?.message || 'Codex 回复未完成。');}
  else if(event.method==='error' && !p.willRetry)fail(p.error?.message);
 });
 signal?.addEventListener('abort',abort,{once:true});startTimer=setTimeout(()=>fail('Codex 启动超时，请重试。'),30000);
 request('initialize',{clientInfo:{name:'fixed_egress_workspace',version:'0.1.0'},capabilities:{experimentalApi:false}});
 try{await done;}finally{clearTimeout(startTimer);signal?.removeEventListener('abort',abort);lines.close();child.stdin.end();child.kill('SIGTERM');}
}
