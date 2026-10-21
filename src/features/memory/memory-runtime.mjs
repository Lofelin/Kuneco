import {memoryDirectorySpawner} from './memory-process.mjs';
import {createInterface} from 'node:readline';
import {memoryExtractionSchema} from './memory-extraction.mjs';
import {runDeepSeek} from '../runtimes/deepseek-runner.mjs';

export function memoryCodexArguments({directory,model}){
 return ['exec','--json','--sandbox','read-only','--skip-git-repo-check','--ephemeral','--ignore-user-config','--ignore-rules','-C',directory,
  '-c','web_search="disabled"','-c','features.shell_tool=false','-c','features.unified_exec=false','-c','features.apps=false','-c','features.memories=false',...['plugins','plugin_sharing','remote_plugin','enable_mcp_apps','browser_use','browser_use_external','browser_use_full_cdp_access','in_app_browser','computer_use','image_generation','multi_agent','multi_agent_v2','sleep_tool','code_mode','code_mode_only','chronicle','skill_mcp_dependency_install'].flatMap(name=>['-c','features.'+name+'=false']),'-c','mcp_servers={}',...(model?['--model',model]:[]),'-'];
}
export async function runMemoryExtraction({engine,model,prompt,directory,executable,spawnProcess,env,signal,query,schema=memoryExtractionSchema,prepareDirectory=false,onUsage=()=>{}}){
 if(signal?.aborted)throw Error('记忆提取已暂停');
 if(prepareDirectory)spawnProcess=memoryDirectorySpawner(spawnProcess,directory);
 if(engine==='cc'){
  const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  let text='',structured;
  try{for await(const message of query({prompt,options:{cwd:directory,pathToClaudeCodeExecutable:executable,spawnClaudeCodeProcess:spawnProcess,model:model||undefined,env,abortController:controller,tools:[],mcpServers:{},strictMcpConfig:true,plugins:[],settingSources:[],persistSession:false,maxTurns:2,systemPrompt:'只从用户提供的本轮文本提取长期记忆，返回JSON；不访问外部数据、不执行工具。',outputFormat:{type:'json_schema',schema},canUseTool:async()=>({behavior:'deny',message:'记忆提取禁止调用工具'})}})){
   if(message.type==='assistant')for(const c of message.message?.content||[])if(c.type==='text')text+=c.text;
   if(message.type==='result'){if(message.is_error)throw Error('Claude 记忆提取未完成');structured=message.structured_output;onUsage(message);}
   if(text.length>50000)throw Error('记忆提取输出超出限制');
  }return structured||text;}finally{signal?.removeEventListener('abort',abort);}
 }
 if(engine==='deepseek'){
  let text='';await runDeepSeek({operation:'extract-memory',spawnProcess,sessionId:undefined,model,prompt,project:directory,networkMode:env.KUNECO_MEMORY_NETWORK_MODE||'proxy',signal,onText:value=>{text+=value;if(text.length>50000)throw Error('记忆提取输出超出限制');},onUsage});return text;
 }
 if(engine!=='codex')throw Error('当前运行时不支持记忆提取');
 return new Promise((resolve,reject)=>{
  const child=spawnProcess({command:executable,args:memoryCodexArguments({directory,model}),cwd:directory,env,signal});child.stderr?.on('data',()=>{});const lines=createInterface({input:child.stdout});let text='',done=false,error=null,settled=false,total=0;
  const finish=(failure)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);lines.close();failure?reject(failure):resolve(text);};
  const abort=()=>{child.kill('SIGTERM');finish(Error('记忆提取已暂停'));};signal?.addEventListener('abort',abort,{once:true});
  lines.on('line',line=>{
   try{
    total+=line.length;if(total>300000)throw Error('记忆提取输出超出限制');const e=JSON.parse(line);
    if(['item.started','item.completed'].includes(e.type)&&e.item&&!['agent_message','reasoning','user_message'].includes(e.item.type))throw Error('记忆提取尝试调用工具，已中止');
    if(e.type==='item.completed'&&e.item?.type==='agent_message'&&e.item.phase!=='commentary')text+=e.item.text||'';
    if(e.type==='turn.completed'){done=true;if(e.usage)onUsage(e.usage);}
    if(['error','turn.failed'].includes(e.type))error=Error('Codex 记忆提取失败，请检查运行时或连接状态');
   }catch(failure){error=failure;child.kill('SIGTERM');}
  });
  child.once('error',()=>finish(Error('记忆提取运行时启动失败')));child.once('close',code=>finish(error||(!done||code!==0?Error('记忆提取未完整返回'):null)));child.stdin.on('error',()=>{});child.stdin.end(prompt);if(signal?.aborted)abort();
 });
}
