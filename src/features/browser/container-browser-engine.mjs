import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {resourcePrefix} from '../environments/docker-environments.mjs';

const ROLE='kuneco-browser';
export function browserContainerArguments({prefix,image,gatewayIP,timezone,locale,spec,instance,hostname=prefix+'-browser',seccomp=path.resolve('docker/browser/seccomp.json')}){
 if(!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(gatewayIP) || gatewayIP.split('.').some(x=>Number(x)>255))throw new Error('浏览器网关地址无效');
 try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw new Error('浏览器时区无效');}
 if(!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale))throw new Error('浏览器语言无效');
 return ['run','-d','--name',prefix+'-browser','--label','app='+ROLE,'--label','io.kuneco.environment='+prefix,'--label','io.kuneco.browser.spec='+spec,...(instance?['--label','io.kuneco.browser.instance='+instance]:[]),
 '--hostname',hostname,'--network',prefix+'-private','--dns','127.0.0.1','--read-only','--cap-drop','ALL','--cap-add','NET_ADMIN','--cap-add','SETUID','--cap-add','SETGID','--cap-add','CHOWN',
 '--security-opt','no-new-privileges','--security-opt','seccomp='+seccomp,'--pids-limit','256','--memory','1536m','--cpus','2','--shm-size','256m',
 '--tmpfs','/tmp:rw,nosuid,nodev,size=512m','--mount',`type=volume,src=${prefix}-browser-home,dst=/home/browser`,
 '--mount',`type=volume,src=${prefix}-worker-work,dst=/workspace`,
 '-e','KUNECO_GATEWAY_IP='+gatewayIP,'-e','TZ='+timezone,'-e','LANG='+locale.replace('-','_')+'.UTF-8','-e','KUNECO_BROWSER_LOCALE='+locale,image];
}
export async function ensureContainerBrowserImage(manager){
  const files=await Promise.all(['Dockerfile','entrypoint.sh','cdp-bridge.mjs','seccomp.json','network-transport.mjs'].map(file=>readFile(path.join(manager.sourceRoot,'docker/browser',file))));
  const revision=createHash('sha256').update(Buffer.concat(files)).digest('hex').slice(0,16),image='kuneco-browser:'+revision;
  try{await manager.command(['image','inspect',image]);}catch{await manager.command(['build','-t',image,'-f','docker/browser/Dockerfile','.'],{timeout:900000,maxBuffer:1024*1024});}
 return image;
}
export class ContainerBrowserEngine extends EventEmitter {
 constructor(manager,{owner,environmentId,gatewayIP,token,timezone='UTC',locale='en-US',assertCurrent=()=>{},allowRequest=async()=>false}){
  super();Object.assign(this,{manager,owner,environmentId,gatewayIP,token,timezone,locale,assertCurrent,allowRequest});
  this.instance=randomUUID();this.prefix=resourcePrefix(owner,environmentId);this.name=this.prefix+'-browser';this.pending=new Map();this.sequence=0;this.buffer=Buffer.alloc(0);this.configured=new Map();this.parentSessions=new Map();this.autoPageSessions=new Map();this.managedTargets=new Set();this.targetSessions=new Map();this.targetTimers=new Map();this.authenticationRequests=new Set();this.stopped=false;
 }
 async start(){
  if(this.child)return this;
  this.assertCurrent();if(!this.token)throw new Error('浏览器网络未就绪，禁止启动浏览器');
  const image=await ensureContainerBrowserImage(this.manager);
  this.assertCurrent();
  let existing;try{existing=JSON.parse(await this.manager.command(['inspect',this.name]))[0];}catch{}
  const hostname=existing?.Config?.Hostname || this.prefix+'-browser';
  const spec=createHash('sha256').update(JSON.stringify({version:3,image,hostname,gatewayIP:this.gatewayIP,timezone:this.timezone,locale:this.locale})).digest('hex');
  const args=browserContainerArguments({...this,prefix:this.prefix,image,spec,hostname,seccomp:path.join(this.manager.sourceRoot,'docker/browser/seccomp.json')});
  const volume=this.prefix+'-browser-home';
  const consumers=(await this.manager.command(['ps','-a','--filter','volume='+volume,'--format','{{.Names}}'])).split('\n').filter(Boolean);
  if(consumers.some(name=>name!==this.name))throw new Error('浏览器存储正被其他容器引用，已停止升级');
  this.assertCurrent();
  if(existing){
   const labels=existing.Config?.Labels || {},networks=Object.keys(existing.NetworkSettings?.Networks || {}),mounts=existing.Mounts || [];
   if(labels.app!==ROLE || labels['io.kuneco.environment']!==this.prefix || networks.some(n=>n!==this.prefix+'-private') || mounts.some(m=>m.Type!=='tmpfs' && !(m.Type==='volume'&&((m.Name===this.prefix+'-browser-home'&&m.Destination==='/home/browser')||(m.Name===this.prefix+'-worker-work'&&m.Destination==='/workspace')))))throw new Error('浏览器容器归属或隔离配置不匹配，已停止操作');
   // Never attach a second CDP process to a profile already owned by another process.
   await this.manager.command(['stop','-t','5',this.name]);this.assertCurrent();
   await this.manager.command(['rm',this.name]);existing=null;this.assertCurrent();
  }
  let volumeInfo;
  try{volumeInfo=JSON.parse(await this.manager.command(['volume','inspect',volume]))[0];}catch{}
  if(volumeInfo && (volumeInfo.Labels?.app!==ROLE || volumeInfo.Labels?.['io.kuneco.environment']!==this.prefix))throw new Error('浏览器存储归属不匹配，已停止操作');
  if(!volumeInfo)await this.manager.command(['volume','create','--label','app='+ROLE,'--label','io.kuneco.environment='+this.prefix,volume]);
  const workspace=JSON.parse(await this.manager.command(['volume','inspect',this.prefix+'-worker-work']))[0];
  if(!workspace || workspace.Name!==this.prefix+'-worker-work')throw Error('当前环境工作区不可用');
  this.assertCurrent();await this.manager.command(existing?['start',this.name]:args);this.assertCurrent();
  let ready=false;for(let i=0;i<50;i++){
   try{await this.manager.command(['exec',this.name,'test','-f','/tmp/kuneco-browser-ready']);ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,100));this.assertCurrent();}
  }
  if(!ready)throw new Error('容器浏览器网络保护未就绪');
  const binary=await this.manager.binary('docker');this.assertCurrent();
  this.child=spawn(binary,['--host',this.manager.endpoint,'exec','-i','--user','1000:1000',this.name,'node','/opt/kuneco/cdp-bridge.mjs'],{cwd:this.manager.sourceRoot,stdio:['pipe','pipe','pipe'],env:{...process.env,DOCKER_HOST:'',DOCKER_CONTEXT:this.manager.context}});
  this.child.stdin.on('error',()=>{});this.child.stdout.on('data',chunk=>this.receive(chunk));this.child.stderr.resume();
  this.child.once('error',()=>this.finish());this.child.once('close',()=>this.finish());
  await this.command('Browser.getVersion');
  // Pause every newly created target before any website code can execute.
  await this.command('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'page'},{type:'worker'},{type:'shared_worker'},{type:'service_worker'},{exclude:true}]});
  await this.verifySandbox();this.assertCurrent();return this;
 }
 async verifySandbox(){
  const {targetId}=await this.command('Target.createTarget',{url:'about:blank'});
  try{const {sessionId}=await this.command('Target.attachToTarget',{targetId,flatten:true});await this.command('Page.navigate',{url:'chrome://sandbox'},sessionId);
   for(let i=0;i<30;i++){const {result}=await this.command('Runtime.evaluate',{expression:'document.body?.innerText || ""',returnByValue:true},sessionId);const status=result?.value||'';if(/PID namespaces\s+Yes/.test(status)&&/Network namespaces\s+Yes/.test(status)&&/Seccomp-BPF sandbox\s+Yes/.test(status)&&/adequately sandboxed/.test(status)){this.sandboxVerified=true;return;}await new Promise(resolve=>setTimeout(resolve,100));this.assertCurrent();}
   throw Error('Chromium sandbox 未通过核验，已禁止启动浏览器');
  }finally{await this.command('Target.closeTarget',{targetId}).catch(()=>{});}
 }
 receive(chunk){
  this.buffer=Buffer.concat([this.buffer,chunk]);
  if(this.buffer.length>64*1024*1024){void this.close();return;}
  let end;while((end=this.buffer.indexOf(0))>=0){
   const raw=this.buffer.subarray(0,end);this.buffer=this.buffer.subarray(end+1);let message;try{message=JSON.parse(raw.toString());}catch{continue;}
   if(message.id){const item=this.pending.get(message.id);if(!item)continue;this.pending.delete(message.id);clearTimeout(item.timer);if(message.error)item.reject(new Error('容器浏览器操作失败：'+message.error.message));else item.resolve(message.result || {});continue;}
   if(message.method==='Target.attachedToTarget'){void this.handleAttached(message).catch(()=>this.closeUnsafeTarget(message.params.targetInfo.targetId));continue;}
   if(message.method==='Target.detachedFromTarget'){this.parentSessions.delete(message.params.sessionId);this.configured.delete(message.params.sessionId);}
   if(message.method==='Fetch.authRequired'){
    const challenge=message.params.authChallenge;
    const key=(message.sessionId || '')+':'+message.params.requestId;
    const expected=challenge?.source==='Proxy' && challenge?.origin===`http://${this.gatewayIP}:8080` && !this.authenticationRequests.has(key);
    this.authenticationRequests.add(key);
    void this.command('Fetch.continueWithAuth',{requestId:message.params.requestId,authChallengeResponse:expected?{response:'ProvideCredentials',username:'workspace',password:this.token}:{response:'CancelAuth'}},message.sessionId).catch(()=>{});continue;
   }
   if(message.method==='Fetch.requestPaused'){void this.handlePaused(message);continue;}
   this.emit('event',{method:message.method,params:message.params || {},sessionId:message.sessionId});
  }
 }
 async handlePaused(message){
  let allowed=false;try{this.assertCurrent();allowed=await this.allowRequest(message.params.request?.url,this.policySession(message.sessionId),message.params.request);this.assertCurrent();}catch{}
  await this.command(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId:message.params.requestId,...(allowed?{}:{errorReason:'BlockedByClient'})},message.sessionId).catch(()=>{});
 }
 async command(method,params={},sessionId){
  if(method!=='Browser.close')this.assertCurrent();if(!this.child || this.stopped || (method==='Browser.close'&&sessionId))throw new Error('容器浏览器未连接');
  const id=++this.sequence;
  const result=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('容器浏览器操作超时'));},30000);
   this.pending.set(id,{resolve,reject,timer});
   this.child.stdin.write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(new Error('容器浏览器连接已关闭'));}});
  });
  if(method==='Target.createTarget' && result.targetId)this.managedTargets.add(result.targetId);
  if(method==='Target.attachToTarget' && result.sessionId){
   if(!this.managedTargets.has(params.targetId))throw new Error('禁止接管未授权的浏览器目标');
   this.targetSessions.set(params.targetId,result.sessionId);
   await this.configureSession(result.sessionId);
   await this.command('Runtime.runIfWaitingForDebugger',{},result.sessionId);
   for(const automatic of this.autoPageSessions.get(params.targetId)||[]){if(automatic!==result.sessionId){this.parentSessions.set(automatic,result.sessionId);await this.command('Runtime.runIfWaitingForDebugger',{},automatic);}}
  }
  return result;
 }
 policySession(sessionId){
  const visited=new Set();while(this.parentSessions.has(sessionId)&&!visited.has(sessionId)){visited.add(sessionId);sessionId=this.parentSessions.get(sessionId);}return sessionId;
 }
 async closeUnsafeTarget(targetId){
  clearTimeout(this.targetTimers.get(targetId));this.targetTimers.delete(targetId);
  try{await this.command('Target.closeTarget',{targetId});}catch{
   // Worker targets cannot always be closed through Target.closeTarget. They
   // have never been resumed, so retaining that debugger pause fails closed
   // without terminating unrelated, correctly protected page targets.
   this.emit('event',{method:'Kuneco.targetBlocked',params:{targetId},sessionId:this.targetSessions.get(targetId)});
  }
 }
 async handleAttached({params,sessionId:parentSession}){
  const {sessionId,targetInfo}=params,{targetId,type}=targetInfo;
  if(type==='page'){
   // Only targets explicitly created by the application may be resumed. Native
   // window.open / target=_blank pages remain paused and are closed; the UI
   // may independently create a permitted replacement tab from Page.windowOpen.
   if(parentSession){await this.closeUnsafeTarget(targetId);return;}
   const automatic=this.autoPageSessions.get(targetId)||new Set();automatic.add(sessionId);this.autoPageSessions.set(targetId,automatic);
   const manual=this.targetSessions.get(targetId);if(manual){await this.configured.get(manual);this.parentSessions.set(sessionId,manual);await this.command('Runtime.runIfWaitingForDebugger',{},sessionId);return;}
   if(!this.targetTimers.has(targetId)){
    const timer=setTimeout(()=>{this.targetTimers.delete(targetId);if(!this.managedTargets.has(targetId))void this.closeUnsafeTarget(targetId);},3000);timer.unref?.();this.targetTimers.set(targetId,timer);
   }
   return;
  }
  if(!['iframe','worker','shared_worker','service_worker'].includes(type) || (type==='iframe'&&(!parentSession||!this.configured.has(parentSession)))){await this.closeUnsafeTarget(targetId);return;}
  this.targetSessions.set(targetId,sessionId);if(parentSession)this.parentSessions.set(sessionId,parentSession);
  try{
   await this.configureSession(sessionId,{worker:type!=='iframe'});
   await this.command('Runtime.runIfWaitingForDebugger',{},sessionId);
  }catch{await this.closeUnsafeTarget(targetId);}
 }
 configureSession(sessionId,{worker=false}={}){
  if(this.configured.has(sessionId))return this.configured.get(sessionId);
  const pending=(async()=>{
   // Unsupported interception fails closed: do not resume the worker/iframe.
   try{await this.command('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}],handleAuthRequests:true},sessionId);}catch(error){
    if(!worker)throw error;
    // Worker CDP omits Fetch on some Chromium builds. Permit computation only
    // after Network has installed an explicit deny-all URL policy.
    await this.command('Network.enable',{},sessionId);
    await this.command('Network.setBlockedURLs',{urls:['*']},sessionId);
   }
   if(!worker){
    await this.command('Emulation.setTimezoneOverride',{timezoneId:this.timezone},sessionId);
    await this.command('Emulation.setLocaleOverride',{locale:this.locale},sessionId);
    }
   const {userAgent}=await this.command('Browser.getVersion');
   await this.command('Network.setUserAgentOverride',{userAgent,acceptLanguage:this.locale+',en',platform:'Linux'},sessionId);
   // Workers inherit the container's TZ and Chromium --lang; unlike page
   // targets they do not expose Emulation. Recursively pause their children.
   await this.command('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{}]},sessionId);
  })();this.configured.set(sessionId,pending);return pending;
 }
 finish(){
  if(this.stopped)return;this.stopped=true;
  for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('容器浏览器连接已关闭'));}this.pending.clear();this.authenticationRequests.clear();for(const timer of this.targetTimers.values())clearTimeout(timer);this.targetTimers.clear();this.parentSessions.clear();this.autoPageSessions.clear();this.configured.clear();this.token='';this.emit('closed');
 }
 async close(){
  if(this.closing)return this.closing;
  this.closing=(async()=>{
   // Chromium must flush persistent cookies and remove its profile singleton
   // before the container is stopped. Scope changes may invalidate requests,
   // but this private, instance-owned pipe must still be allowed to shut down.
   if(this.child && !this.stopped){
    let timer;const exited=new Promise(resolve=>this.child.once('close',resolve));
    void this.command('Browser.close').catch(()=>{});
    await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);clearTimeout(timer);
   }
   this.child?.stdin.end();if(!this.stopped)this.child?.kill('SIGTERM');this.finish();
   // Only this exact account/environment resource can be stopped.
   try{const item=JSON.parse(await this.manager.command(['inspect',this.name]))[0];if(item?.Config?.Labels?.app===ROLE && item.Config.Labels['io.kuneco.environment']===this.prefix && item.Config.Labels['io.kuneco.browser.instance']===this.instance)await this.manager.command(['stop','-t','5',this.name]);}catch{}
   await this.transport?.close();
  })();return this.closing;
 }
}
