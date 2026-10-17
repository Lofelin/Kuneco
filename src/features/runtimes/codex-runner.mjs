import {codexActivity} from './runtime-activity.mjs';
import {codexClientInfo} from '../../shared/app-identity.mjs';
import {directChatEnvironment,chatRuntimeEnvironment} from '../chat/chat-network.mjs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {createInterface} from 'node:readline';
import {createRestrictedCCSpawner} from './cc-network-guard.mjs';
import {proxyEnvironment} from '../proxy/proxy.mjs';
export async function readCodexModel() {
  try {const config=await readFile(path.join(process.env.CODEX_HOME || path.join(homedir(),'.codex'),'config.toml'),'utf8');const top=config.split(/^\s*\[/m)[0];const value=/^\s*model\s*=\s*["']([a-zA-Z0-9._:-]+)["']/m.exec(top)?.[1];return value || null;}catch{return null;}
}
export function codexArguments({project,sessionId,model,images=[],reasoningEffort}={}) {
  const args=['exec','--json','--dangerously-bypass-approvals-and-sandbox','--skip-git-repo-check','-C',project,'-c','web_search="live"'];
  if(model) args.push('--model',model);
  if(reasoningEffort!==undefined && reasoningEffort!==null){
    if(typeof reasoningEffort!=='string' || !/^[a-z][a-z0-9_]{0,31}$/.test(reasoningEffort))throw new Error('无效推理强度');
    args.push('-c','model_reasoning_effort='+JSON.stringify(reasoningEffort));
  }
  if(sessionId) args.push('resume',sessionId);
  for(const image of images)args.push('--image',image);
  args.push('-');return args;
}
export async function runCodex({executable,project,prompt,images=[],sessionId,gateway,signal,canStart,onEvent,spawnProcess,model:chosenModel,useLocalModel=true,reasoningEffort}) {
  const spawnRestricted=spawnProcess || createRestrictedCCSpawner({port:gateway.port,canStart});
  const env=chatRuntimeEnvironment(gateway.status?.mode==='direct'?directChatEnvironment(process.env):proxyEnvironment(process.env,gateway.url));
  // Use existing local Codex authentication, never inherit an alternate API origin.
  delete env.OPENAI_BASE_URL;delete env.OPENAI_API_KEY;delete env.CODEX_API_KEY;
  const model=chosenModel || (useLocalModel?await readCodexModel():null);
  const child=spawnRestricted({command:executable,args:codexArguments({project,sessionId,model,images,reasoningEffort}),cwd:project,env,signal});
  let completed=false, failed=false, lastError='Codex 执行失败，请检查本机登录、模型与代理。';
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{
    let event;try{event=JSON.parse(line);}catch{return;}
    const activity=codexActivity(event);if(activity)onEvent('activity',activity);
    if(event.type==='thread.started' && typeof event.thread_id==='string') onEvent('session',event.thread_id);
    if(event.type==='item.completed' && event.item?.type==='agent_message' && typeof event.item.text==='string') onEvent(event.item.phase==='commentary'?'process':'text',event.item.phase==='commentary'?{text:event.item.text}:event.item.text+'\n');
    if(event.type==='item.completed' && event.item?.type==='reasoning' && typeof event.item.text==='string')onEvent('process',{text:event.item.text});
    if(event.type==='error' || event.type==='turn.failed') {
      const message=String(event.error?.message || event.message || '');
      if(/401|unauthorized|invalid_api_key/i.test(message))lastError='Codex 认证被拒绝（401），请检查本机登录状态。';
      else if(/403|forbidden/i.test(message))lastError='Codex 服务拒绝访问（403），请检查账号权限及服务地区。';
      else if(/model.*(not found|does not exist|not supported|unavailable)|unsupported.*model/i.test(message))lastError='Codex 配置的模型不可用，请检查本机配置。';
      else if(/permission denied|operation not permitted|EPERM/i.test(message))lastError='Codex 网络连接被隔离规则阻止；不会回退直连。';
      else if(/429|quota|rate limit/i.test(message))lastError='Codex 额度不足或请求受到限流，请检查账号额度。';
      if(event.type==='turn.failed')failed=true;
    }
    if(event.type==='turn.completed'){completed=true;if(event.usage)onEvent('usage',event.usage);}
  });
  await new Promise((resolve,reject)=>{
    child.once('error',()=>reject(new Error(signal?.aborted?'请求已取消。':'Codex CLI 无法启动，请检查本机安装。')));
    child.once('close',code=>{lines.close();code===0 && completed && !failed?resolve():reject(new Error(signal?.aborted?'请求已取消。':lastError));});
    child.stdin.on('error',()=>{});child.stdin.end(prompt);
  });
}

export async function listCodexModels(executable,gateway,spawnProcess) {
  const child=(spawnProcess || createRestrictedCCSpawner({port:gateway?.port || 1}))({command:executable,args:['app-server','--listen','stdio://'],env:proxyEnvironment(process.env,gateway?.url || 'http://127.0.0.1:1'),cwd:process.cwd()});
  const lines=createInterface({input:child.stdout});let timer;
  try {return await new Promise((resolve,reject)=>{
    const models=new Map(),cursors=new Set();let requestId=1;
    const send=(method,params)=>child.stdin.write(JSON.stringify({id:++requestId,method,params})+'\n');
    timer=setTimeout(()=>reject(new Error('Model list timeout')),20000);child.on('error',reject);child.on('close',()=>reject(new Error('Model list closed')));child.stdin.on('error',reject);
    lines.on('line',line=>{
      let msg;try{msg=JSON.parse(line);}catch{return;}
      if(msg.id!==requestId)return;
      if(msg.error)return reject(new Error('Model list failed'));
      if(msg.id===1){child.stdin.write(JSON.stringify({method:'initialized'})+'\n');send('model/list',{includeHidden:false,limit:100});return;}
      if(!Array.isArray(msg.result?.data))return reject(new Error('Invalid model list'));
      for(const item of msg.result.data){
        const retirement=item.upgradeInfo?.retirementAt;
        if(typeof item.model!=='string' || item.hidden || retirement && Date.parse(retirement)<=Date.now())continue;
        const supportedReasoningEfforts=Array.isArray(item.supportedReasoningEfforts)?item.supportedReasoningEfforts.filter(level=>typeof level?.reasoningEffort==='string' && /^[a-z][a-z0-9_]{0,31}$/.test(level.reasoningEffort)).map(level=>({reasoningEffort:level.reasoningEffort,description:typeof level.description==='string'?level.description:''})):[];
        const defaultReasoningEffort=supportedReasoningEfforts.some(level=>level.reasoningEffort===item.defaultReasoningEffort)?item.defaultReasoningEffort:null;
        models.set(item.model,{model:item.model,name:item.displayName || item.model,isDefault:Boolean(item.isDefault),supportedReasoningEfforts,defaultReasoningEffort});
      }
      const cursor=msg.result.nextCursor;
      if(cursor){if(cursors.has(cursor))return reject(new Error('Repeated model list cursor'));cursors.add(cursor);send('model/list',{includeHidden:false,limit:100,cursor});}
      else resolve([...models.values()]);
    });
    child.stdin.write(JSON.stringify({id:1,method:'initialize',params:{clientInfo:codexClientInfo,capabilities:{experimentalApi:false}}})+'\n');
  });} finally {clearTimeout(timer);lines.close();child.stdin.end();child.kill('SIGTERM');}
}
