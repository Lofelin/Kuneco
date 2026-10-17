import {compactHistory,restoreHistory,historyHash,shouldAutoCompact} from './history-compaction.mjs';
import {BoundedRequests} from '../proxy/request-admission.mjs';
import {RequestLifecycle} from '../proxy/request-lifecycle.mjs';
// Installed inside the current container; credentials and histories stay in its home volume.
import {createDeepSeekTools} from './deepseek-tools.mjs';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import {mkdir,readFile,writeFile,rename,chmod} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';

// Preserve only protocol metadata; response bodies may contain credentials or prompts.
export function deepSeekHTTPError(status,headers={},now=Date.now()){
 const message=({400:'DeepSeek 请求参数或上下文超限，请检查模型与图片',401:'API Key 无效',402:'DeepSeek 账户余额不足',403:'DeepSeek 请求权限不足',429:'DeepSeek 请求过于频繁',503:'DeepSeek 服务暂时不可用'})[status] || 'DeepSeek 请求失败（HTTP '+status+'）';
 const kind=({400:'invalid-request',401:'authentication',402:'balance',403:'permission',429:'rate-limit',503:'unavailable'})[status] || 'http-error';
 const raw=headers['retry-after'];let retryAt=null;
 if(typeof raw==='string' && raw.trim()){
  const text=raw.trim(),value=/^\d+$/.test(text)?now+Number(text)*1000:/^[A-Za-z]{3,9}(?:,| )/.test(text)?Date.parse(text):NaN;
  if(Number.isFinite(value)&&value>=0&&value<=8640000000000000)retryAt=Math.max(now,value);
 }
 return Object.assign(new Error(message),{recovery:{provider:'deepseek',kind,httpStatus:status,retryAt,automaticRetry:false,executionUnknown:false,manualRetry:[429,503].includes(status)}});
}

export async function readDeepSeekStream(response,onText=()=>{},onReasoning=()=>{}){
 let buffer='',answer='',reasoning='',usage,done=false,total=0,finish;const calls=new Map();
 const frame=value=>{
  const data=value.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
  if(!data || done)return;if(data==='[DONE]'){done=true;return;}
  const event=JSON.parse(data);if(event.error)throw new Error('DeepSeek 流式响应失败');
  const choice=event.choices?.[0],delta=choice?.delta;
  if(typeof delta?.reasoning_content==='string'){reasoning+=delta.reasoning_content;onReasoning(delta.reasoning_content);}
  if(typeof delta?.content==='string'){answer+=delta.content;onText(delta.content);}
  for(const part of delta?.tool_calls || []){if(!Number.isInteger(part.index)||part.index<0||part.index>63)throw new Error('工具调用索引无效');const call=calls.get(part.index)||{id:'',type:'function',function:{name:'',arguments:''}};if(part.id)call.id=part.id;if(part.type)call.type=part.type;if(part.function?.name)call.function.name+=part.function.name;if(part.function?.arguments)call.function.arguments+=part.function.arguments;calls.set(part.index,call);}
  if(choice?.finish_reason)finish=choice.finish_reason;if(event.usage)usage=event.usage;
 };
 response.setEncoding('utf8');for await(const chunk of response){total+=chunk.length;if(total>16_000_000)throw new Error('响应过大');buffer+=chunk;buffer=buffer.replace(/\r\n/g,'\n');let end;while((end=buffer.indexOf('\n\n'))!==-1){frame(buffer.slice(0,end));buffer=buffer.slice(end+2);if(done)break;}if(done)break;}
 if(!done&&buffer.trim())frame(buffer);if(!done)throw new Error('DeepSeek 响应中断');
 if(finish && !['stop','length','tool_calls'].includes(finish))throw new Error(({content_filter:'回复被内容过滤',insufficient_system_resource:'服务资源不足，请稍后重试',aborted:'服务中断了回复',tool_calls:'当前对话未启用工具执行'})[finish] || 'DeepSeek 回复未完成');
 if(calls.size && finish!=='tool_calls')throw new Error('工具调用参数未完整结束，未执行');
 if(finish==='tool_calls' && (!calls.size || [...calls.values()].some(c=>!c.id||c.type!=='function'||!c.function.name)))throw new Error('工具调用不完整，未执行');
 return {choices:[{message:{content:answer,reasoning_content:reasoning,...(calls.size?{tool_calls:[...calls.entries()].sort((a,b)=>a[0]-b[0]).map(([,v])=>v)}:{})},finish_reason:finish}],usage};
}

export function normalizeDeepSeekInput(value){
 const input=typeof value==='string'?{text:value}:value;
 if(!input || typeof input.text!=='string' || input.text.length>50000)throw new Error('请输入有效内容（不超过 50000 字符）');
 const images=input.images || [];if(!Array.isArray(images) || images.length>600)throw new Error('单次最多发送 600 张图片');
 let total=0;const normalized=images.map(image=>{
  if(typeof image?.url==='string'){let url;try{url=new URL(image.url);}catch{throw new Error('图片链接无效');}if(!['http:','https:'].includes(url.protocol) || image.url.length>8192 || url.username || url.password)throw new Error('图片链接无效');return {url:image.url,detail:image.detail || 'auto'};}
  const match=/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image?.dataURL || '');if(!match)throw new Error('图片仅支持 PNG、JPEG、GIF、WebP');
  const bytes=Buffer.from(match[2],'base64');if(bytes.length>64*1024*1024)throw new Error('单张图片不能超过 64 MiB');
  const valid=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='jpeg'?bytes[0]===255 && bytes[1]===216 && bytes[2]===255:match[1]==='gif'?/^GIF8[79]a/.test(bytes.subarray(0,6).toString()):bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP';if(!valid)throw new Error('图片内容与格式不符');total+=bytes.length;
  return {dataURL:image.dataURL,name:String(image.name || 'image.'+match[1]).slice(0,120),detail:['auto','low','high','original'].includes(image.detail)?image.detail:'auto'};
 });
 if(total>200*1024*1024)throw new Error('单次图片总大小不能超过 200 MiB');if(!input.text.trim() && !normalized.length)throw new Error('请输入消息或添加图片');
 const thinking=input.thinking || 'enabled';if(!['enabled','disabled'].includes(thinking))throw new Error('思考模式无效');return {text:input.text,images:normalized,thinking};
}

// This module runs inside one account/environment worker process. Scope also
// includes the gateway credential, API credential and explicit routing mode.
let requestPool;
export function closeDeepSeekConnections(){
 const old=requestPool;requestPool=null;
 if(old){old.closed=true;old.admission.close();for(const life of old.lifecycles)life.abort(Object.assign(new Error('请求作用域已关闭'),{name:'AbortError'}));old.lifecycles.clear();old.agent.destroy();for(const pending of old.pending)pending.destroy();}
}
export async function requestDeepSeek(proxyURL,key,route,body,{installation=false,direct:chatDirect=false,onText,onReasoning,rawBody,contentType,signal,timeouts}={}){
  const direct=chatDirect || installation && route==='/models' && body===undefined;
  let proxy;if(!direct){try{proxy=new URL(proxyURL);}catch{throw new Error('请先连接当前环境的代理');}}
  if(!direct && proxy.protocol!=='http:')throw new Error('DeepSeek 需要当前环境的 HTTP 代理网关');
  const scope=JSON.stringify([proxyURL,key,direct]);
  if(requestPool?.scope!==scope)closeDeepSeekConnections();
  const fresh=!requestPool;
  if(fresh)requestPool={scope,agent:new https.Agent({keepAlive:true,maxSockets:4,maxFreeSockets:2,timeout:30000,maxCachedSessions:0}),pending:new Set(),lifecycles:new Set(),admission:new BoundedRequests(),closed:false};
  const pool=requestPool,agent=pool.agent;
  if(fresh && !direct)agent.createConnection=(_options,done)=>{
   const connectionLife=_options.requestLifecycle;connectionLife?.advance('connect');
   let completed=false;const callback=(error,socket)=>{if(completed)return;completed=true;if(pool.closed){socket?.destroy();error=new Error('代理作用域已变化');}done(error,socket);};
   const headers={Host:'api.deepseek.com:443'};
   if(proxy.username)headers['Proxy-Authorization']='Basic '+Buffer.from(decodeURIComponent(proxy.username)+':'+decodeURIComponent(proxy.password)).toString('base64');
   const tunnel=http.request({hostname:proxy.hostname,port:proxy.port || 80,method:'CONNECT',path:'api.deepseek.com:443',headers,signal:connectionLife?.signal});
   pool.pending.add(tunnel);tunnel.once('close',()=>pool.pending.delete(tunnel));
   tunnel.once('error',()=>callback(new Error('代理连接失败')));
   tunnel.once('socket',socket=>{if(socket.connecting)socket.once('connect',()=>connectionLife?.advance('tunnel'));else connectionLife?.advance('tunnel');});
   tunnel.once('connect',(response,socket,head)=>{
    if(response.statusCode!==200){socket.destroy();callback(new Error('代理拒绝连接'));return;}
    if(head.length)socket.unshift(head);
    connectionLife?.advance('tls');
    const secure=tls.connect({socket,servername:'api.deepseek.com',rejectUnauthorized:true});
    pool.pending.add(secure);secure.once('close',()=>pool.pending.delete(secure));
    secure.once('close',()=>callback(new Error('DeepSeek TLS 连接已关闭')));
    const abort=()=>secure.destroy(connectionLife.signal.reason);connectionLife?.signal.addEventListener('abort',abort,{once:true});secure.once('close',()=>connectionLife?.signal.removeEventListener('abort',abort));if(connectionLife?.signal.aborted)abort();secure.once('error',()=>callback(new Error('DeepSeek TLS 连接失败')));
    secure.once('secureConnect',()=>{secure.setTimeout(0);pool.pending.delete(secure);callback(null,secure);});
   });tunnel.end();
  };
  const life=new RequestLifecycle({signal,stream:Boolean(body?.stream),timeouts:{headers:120000,body:120000,...timeouts}});
  pool.lifecycles.add(life);
  let release;
  try{
   release=await pool.admission.acquire(life.signal,timeouts?.queue ?? 15000);life.signal.throwIfAborted();
   const payload=rawBody || (body?JSON.stringify(body):null);
   return await new Promise((resolve,reject)=>{
  life.rejectOnAbort(reject);
  const request=https.request({requestLifecycle:life,signal:life.signal,hostname:'api.deepseek.com',port:443,path:route,method:route.startsWith('/files/') && body===null?'DELETE':payload?'POST':'GET',agent,headers:{Authorization:'Bearer '+key,'Content-Type':contentType || 'application/json',...(payload?{'Content-Length':Buffer.byteLength(payload)}:{})}},response=>{
   if(response.statusCode===200 && body?.stream){readDeepSeekStream(response,onText,onReasoning).then(resolve,reject).catch(()=>{});return;}
   let data='';response.setEncoding('utf8');response.on('data',chunk=>{data+=chunk;if(data.length>4_000_000)request.destroy(new Error('响应过大'));});
   response.on('error',()=>{reject(new Error('DeepSeek 响应中断'));});
   response.on('end',()=>{if(response.statusCode!==200){reject(deepSeekHTTPError(response.statusCode,response.headers));return;}try{resolve(JSON.parse(data));}catch{reject(new Error('DeepSeek 响应无效'));}});
  });life.bind(request,{customConnection:!direct});pool.pending.add(request);request.once('close',()=>{pool.pending.delete(request);pool.lifecycles.delete(life);});request.once('error',()=>{reject(life.signal.aborted?life.signal.reason:new Error(direct?'DeepSeek API Key 校验失败，请检查网络连接':'DeepSeek 请求中断，请检查代理连接'));});request.end(payload);
 });
  }finally{release?.();life.finish();pool.lifecycles.delete(life);}
}
export async function configureDeepSeek(directory,input,request){
 if(typeof input.apiKey!=='string' || !/^[\x21-\x7e]{8,512}$/.test(input.apiKey))throw new Error('请输入有效的 API Key');
 const result=await request('/models');
 const models=(result.data || []).filter(item=>typeof item.id==='string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(item.id)).map(item=>({model:item.id,name:typeof item.name==='string'?item.name:item.id}));
 if(!models.length)throw new Error('此 API Key 没有可用模型');
 const model=input.model || models[0].model;if(!models.some(item=>item.model===model))throw new Error('当前账号不支持所选模型');
 await mkdir(directory,{recursive:true,mode:0o700});const file=path.join(directory,'credentials.json'),temporary=file+'.tmp';
 await writeFile(temporary,JSON.stringify({apiKey:input.apiKey,model,models}),{mode:0o600});await chmod(temporary,0o600);await rename(temporary,file);
 return {model,models};
}
export async function runDeepSeekCLI(command,input,{directory=path.join(homedir(),'.config','dingtu-deepseek'),request=requestDeepSeek,onText=()=>{},onReasoning=()=>{},onActivity=()=>{},onCompaction=()=>{},onUsage=()=>{},signal}={}){
 if(command==='configure-install')return configureDeepSeek(directory,input,(route)=>request(undefined,input.apiKey,route,undefined,{installation:true}));
 if(command==='configure')return configureDeepSeek(directory,input,(route,body)=>request(process.env.HTTP_PROXY,input.apiKey,route,body));
 const config=JSON.parse(await readFile(path.join(directory,'credentials.json'),'utf8'));
 if(command==='info')return {id:'deepseek',name:'DeepSeek',version:'API · '+config.model,model:config.model,models:config.models};
 if(command==='auth')return {state:config.apiKey?'signed-in':'signed-out',method:'API Key'};
 if(['compact','restore'].includes(command)){
  if(!/^[a-f0-9-]{36}$/.test(input.sessionId))throw new Error('会话无效');
  const file=path.join(directory,input.sessionId+'.json');
  if(command==='restore')return restoreHistory(file,input.record,signal);
  const model=input.model||config.model;if(!config.models.some(m=>m.model===model))throw new Error('模型不可用');
  let compactUsage;const compactResult=await compactHistory({file,signal,summarize:async prompt=>{const result=await request(process.env.HTTP_PROXY,config.apiKey,'/chat/completions',{model,messages:[{role:'user',content:prompt}],stream:true,stream_options:{include_usage:true},thinking:{type:'disabled'}},{direct:input.networkMode==='direct',signal,onText:()=>{},onReasoning:()=>{}});const choice=result.choices?.[0];if(choice?.finish_reason!=='stop')throw new Error('摘要未完整返回，未修改原始上下文');compactUsage=result.usage;return choice.message?.content;}});return {...compactResult,usage:compactUsage};
 }
 if(command!=='chat')throw new Error('未知 DeepSeek 操作');
 if(!/^[a-f0-9-]{36}$/.test(input.sessionId))throw new Error('会话或消息无效');
 const message=normalizeDeepSeekInput(typeof input.prompt==='string'?{text:input.prompt,images:input.images,thinking:input.thinking}:input.prompt);
 const model=input.model || config.model;if(!config.models.some(item=>item.model===model))throw new Error('请选择此账号可用的模型');
 const file=path.join(directory,input.sessionId+'.json');let history=[];try{history=JSON.parse(await readFile(file,'utf8'));if(!Array.isArray(history))throw new Error();}catch(error){if(error.code!=='ENOENT')throw new Error('对话历史损坏，未覆盖原记录，请新建对话');}
 if(input.history!==undefined){if(!Array.isArray(input.history)||input.history.some(m=>!['user','assistant'].includes(m.role)||!(typeof m.content==='string'||Array.isArray(m.content))))throw new Error('回退历史无效');history=input.history;}
 let contextLimit=null;try{const catalog=await request(process.env.HTTP_PROXY,config.apiKey,'/models',undefined,{direct:input.networkMode==='direct',signal});const capacity=catalog.data?.find(m=>m.id===model)?.context_window;if(Number.isSafeInteger(capacity)&&capacity>0)contextLimit=capacity;}catch(error){if(signal?.aborted)throw error;}
 const contextFile=file+'.context.json';let contextState=null;try{const saved=JSON.parse(await readFile(contextFile,'utf8'));if(input.history===undefined&&saved.model===model&&saved.historyHash===historyHash(JSON.stringify(history)))contextState=saved;}catch{}
 const autoCompact=async state=>{
  if(!shouldAutoCompact({...state,contextLimit}))return false;
  const candidate=JSON.parse(await readFile(file,'utf8'));if(candidate.filter(m=>m.role==='user').length<3)return false;
  const id='compact-'+Date.now()+'-'+Math.random().toString(36).slice(2),startedAt=Date.now();let compactUsage;
  const activity={id,type:'context_compaction',provider:'deepseek',toolName:'自动上下文压缩',icon:'file-text',title:'自动压缩上下文',startedAt,input:{promptTokens:state.promptTokens,completionTokens:state.completionTokens,contextLimit,threshold:.8}};
  onActivity({...activity,status:'in_progress'});
  try{const record=await compactHistory({file,signal,requireReduction:true,summarize:async prompt=>{
   const result=await request(process.env.HTTP_PROXY,config.apiKey,'/chat/completions',{model,messages:[{role:'user',content:prompt}],max_tokens:4096,stream:true,stream_options:{include_usage:true},thinking:{type:'disabled'}},{direct:input.networkMode==='direct',signal,onText:()=>{},onReasoning:()=>{}});
   compactUsage=result.usage;const choice=result.choices?.[0];if(choice?.finish_reason!=='stop')throw new Error('摘要未完整返回，未修改原始上下文');return choice.message?.content;
  }});const receipt={...record,automatic:true,usage:compactUsage,contextLimit,triggerTokens:state.promptTokens+Math.max(0,state.completionTokens||0)};onCompaction(receipt);onActivity({...activity,status:'completed',durationMs:Date.now()-startedAt,output:{beforeBytes:record.beforeBytes,afterBytes:record.afterBytes,backup:record.backup,message:'已保留原始备份及最近两轮；聊天记录不删除'}});return true;
  }catch(error){onCompaction({automatic:true,status:signal?.aborted?'stopped':'failed',at:new Date().toISOString(),usage:compactUsage,contextLimit,error:error.message});onActivity({...activity,status:signal?.aborted?'stopped':'failed',durationMs:Date.now()-startedAt,error:error.message,output:'自动压缩未完成，未自动重试；原始记录保留'});throw Object.assign(new Error('自动上下文压缩未完成：'+error.message),error.recovery?{recovery:{...error.recovery,executionUnknown:true,manualRetry:false}}:{});}
 };
 if(contextState&&await autoCompact(contextState))history=JSON.parse(await readFile(file,'utf8'));
 const content=message.images.length?[...(message.text.trim()?[{type:'text',text:message.text}]:[]),...message.images.map(image=>({type:'image_url',image_url:{url:image.dataURL || image.url,detail:image.detail}}))]:message.text;
 // Old text-only history has no reasoning field. Interrupted tool calls receive an explicit
 // unknown-result response; they are never silently re-executed after a crash or stop.
 const repaired=[];for(let i=0;i<history.length;i++){const m=history[i];repaired.push(m.role==='assistant'?{...m,reasoning_content:m.reasoning_content||''}:m);if(m.tool_calls){const ids=new Set();for(let j=i+1;j<history.length&&history[j].role==='tool';j++)ids.add(history[j].tool_call_id);for(const c of m.tool_calls)if(!ids.has(c.id))repaired.push({role:'tool',tool_call_id:c.id,content:JSON.stringify({error:'上次调用中断，结果未确认。不要自动重试有副作用的操作。'})});}}
 const messages=[...repaired,{role:'user',content}];
 const allImages=messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(p=>p.type==='image_url'):[]);
 if(allImages.length && !['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp'].includes(model))throw new Error('图片对话请使用 deepseek-flash 模型');
 const totalImageBytes=allImages.reduce((total,p)=>total+(p.image_url.url.startsWith('data:')?Buffer.from(p.image_url.url.split(',')[1],'base64').length:0),0);if(totalImageBytes>200*1024*1024)throw new Error('对话图片总大小超过 200 MiB，请新建对话');
 if(allImages.length>600)throw new Error('对话图片累计超过 600 张，请新建对话');
 const options={direct:input.networkMode==='direct',onText,onReasoning,signal};
 const tools=input.project===undefined?null:await createDeepSeekTools({cwd:input.project,signal,onActivity});
 const body={model,messages,stream:true,stream_options:{include_usage:true},thinking:{type:message.thinking},...(tools?{tools:tools.definitions,tool_choice:'auto'}:{})};
 let executedTools=0;const uploaded=[],imageReferences=new Map();
 try{
  // Keep original image data in environment-local history; remote file references are temporary.
  if(totalImageBytes>64*1024*1024 || Buffer.byteLength(JSON.stringify(body))>48*1024*1024 || allImages.some(p=>p.image_url.url.startsWith('data:') && Buffer.from(p.image_url.url.split(',')[1],'base64').length>32*1024*1024)){
   body.messages=JSON.parse(JSON.stringify(messages));
   for(const m of body.messages)if(Array.isArray(m.content))for(let i=0;i<m.content.length;i++){
    const part=m.content[i];if(part.type!=='image_url' || !part.image_url.url.startsWith('data:'))continue;
    const [head,data]=part.image_url.url.split(','),mime=head.slice(5).split(';')[0],boundary='dingtu-'+Date.now()+'-'+i;
    const rawBody=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nuser_data\r\n--'+boundary+'\r\nContent-Disposition: form-data; name="expires_after[anchor]"\r\n\r\ncreated_at\r\n--'+boundary+'\r\nContent-Disposition: form-data; name="expires_after[seconds]"\r\n\r\n3600\r\n--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="image"\r\nContent-Type: '+mime+'\r\n\r\n'),Buffer.from(data,'base64'),Buffer.from('\r\n--'+boundary+'--\r\n')]);
    const result=await request(process.env.HTTP_PROXY,config.apiKey,'/files',undefined,{...options,onText:undefined,onReasoning:undefined,rawBody,contentType:'multipart/form-data; boundary='+boundary});
    if(!/^file-api-[a-zA-Z0-9_-]+$/.test(result.id || ''))throw new Error('DeepSeek 图片上传失败');uploaded.push(result.id);imageReferences.set(part.image_url.url,{type:'file',file_id:result.id});m.content[i]={type:'file',file_id:result.id};
   }
  }
  if(Buffer.byteLength(JSON.stringify(body))>48*1024*1024)throw new Error('对话请求超过 48 MiB，请新建对话');
  const checkpoint=async()=>{const temporary=file+'.tmp';await writeFile(temporary,JSON.stringify(messages),{mode:0o600});await rename(temporary,file);};
  const usage={context_limit:contextLimit,prompt_tokens:0,completion_tokens:0,total_tokens:0,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:0};let answer='',count=0;
  const manageContext=async actual=>{
   const state={model,historyHash:historyHash(JSON.stringify(messages)),promptTokens:actual?.prompt_tokens,completionTokens:actual?.completion_tokens};
   await writeFile(contextFile,JSON.stringify(state),{mode:0o600});
   if(await autoCompact(state)){const next=JSON.parse(await readFile(file,'utf8'));messages.splice(0,messages.length,...next);body.messages=imageReferences.size?messages.map(m=>({...m,...(Array.isArray(m.content)?{content:m.content.map(p=>p.type==='image_url'&&imageReferences.has(p.image_url.url)?imageReferences.get(p.image_url.url):p)}:{})})):messages;usage.context_compacted=true;}
  };
  for(let round=0;round<24;round++){
   signal?.throwIfAborted();if(Buffer.byteLength(JSON.stringify(body))>48*1024*1024)throw new Error('工具上下文超过 48 MiB，请新建对话');
   const result=await request(process.env.HTTP_PROXY,config.apiKey,'/chat/completions',{...body,messages:[...body.messages]},options);
   for(const key of ['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens']){const n=result.usage?.[key];usage[key]=usage[key]!==null&&Number.isSafeInteger(n)&&n>=0?usage[key]+n:null;}
   usage.context_compacted=false;usage.last_prompt_tokens=result.usage?.prompt_tokens;usage.last_completion_tokens=result.usage?.completion_tokens;onUsage({...usage});
   const choice=result.choices?.[0],reply=choice?.message;if(!reply)throw new Error('DeepSeek 未返回有效回复');
   const calls=reply.tool_calls||[];
   if(calls.length && (!tools||choice.finish_reason!=='tool_calls'))throw new Error('工具调用未完整结束，未执行');
   if(calls.length){
    if(count+calls.length>64)throw new Error('本轮工具调用超过 64 次，已停止');
    const ids=new Set(messages.flatMap(m=>m.tool_calls?.map(c=>c.id)||[]));
    for(const c of calls){if(typeof c.id!=='string'||!c.id||ids.has(c.id)||c.type!=='function'||typeof c.function?.name!=='string'||typeof c.function?.arguments!=='string')throw new Error('工具调用格式或 ID 无效，未执行');ids.add(c.id);}
   }else if(typeof reply.content!=='string'||!reply.content)throw new Error('DeepSeek 未返回有效回复');
   const assistant={role:'assistant',content:reply.content||'',reasoning_content:reply.reasoning_content||'',...(calls.length?{tool_calls:calls}:{})};
   messages.push(assistant);if(body.messages!==messages)body.messages.push(assistant);answer+=assistant.content;
   if(!calls.length){await checkpoint();await manageContext(result.usage);return {text:answer,usage,finishReason:choice.finish_reason};}
   await checkpoint(); // Persist intent before executing; a restart must not repeat an unknown operation.
   for(const call of calls){signal?.throwIfAborted();count++;executedTools++;const result=await tools.execute(call);const response={role:'tool',tool_call_id:call.id,content:result};messages.push(response);if(body.messages!==messages)body.messages.push(response);await checkpoint();signal?.throwIfAborted();}
   await manageContext(result.usage);
  }
  throw new Error('工具执行达到 24 轮上限，已停止；已完成的操作不会自动重试');
 }catch(error){if(error.recovery&&executedTools>0)error.recovery={...error.recovery,executionUnknown:true,manualRetry:false};throw error;}finally{for(const id of uploaded)await request(process.env.HTTP_PROXY,config.apiKey,'/files/'+id,null,{direct:options.direct}).catch(()=>{});}

}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 const controller=new AbortController();const stop=()=>controller.abort(new Error('请求已取消'));process.on('SIGTERM',stop);process.on('SIGINT',stop);
 try{let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>300*1024*1024)throw new Error('输入过大');}const value=await runDeepSeekCLI(process.argv[2],text?JSON.parse(text):{},{signal:controller.signal,onUsage:usage=>console.log(JSON.stringify({type:'usage',usage})),onCompaction:record=>console.log(JSON.stringify({type:'compaction',record})),onActivity:activity=>console.log(JSON.stringify({type:'activity',activity})),onText:text=>console.log(JSON.stringify({type:'delta',text})),onReasoning:text=>console.log(JSON.stringify({type:'reasoning',text}))});console.log(JSON.stringify(process.argv[2]==='chat'?{type:'done',usage:value.usage,finishReason:value.finishReason}:value));}
 catch(error){if(process.argv[2]==='chat'&&error.recovery)console.log(JSON.stringify({type:'error',message:error.message,recovery:error.recovery}));console.error(error.code==='ENOENT'?'尚未配置 DeepSeek API Key':error.message);process.exitCode=1;}
 finally{closeDeepSeekConnections();}
}
