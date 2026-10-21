import {deviceName} from './device-name.mjs';
import {TaskCapacity} from './task-capacity.mjs';
import {accountMutation} from './account-mutation.mjs';
import {cleanupDirectTask,waitForTaskCleanup} from './direct-task-cleanup.mjs';
import {trackProxyTask} from './proxy-task-cleanup.mjs';
import {verifyExternalTaskCapabilities,externalTaskArguments,externalTaskCancellation} from './external-task.mjs';
import {SPEC_LABEL,reliabilityArguments,specHash,workerImage,ensureWorker,containerStatus,inspectContainer,ensurePrivateNetwork,ensureDirectNetwork,validateContainerNetworks,ATTEMPT_LABEL,removeAttemptContainer} from './container-reliability.mjs';
import {readGitInfo} from '../git/git-management.mjs';
import {gatewayImage} from './gateway-image.mjs';

import {ENVIRONMENT_ICONS,environmentIcon} from './environment-icons.mjs';
import http from 'node:http';
import {RUNTIME_INSTALL_COMMANDS,RUNTIME_CATALOG,CLI_RUNTIMES} from '../runtimes/runtime-install-config.mjs';
import {imageConfiguration,ImageDownloadProgress} from './container-image-config.mjs';
import {listExternalContainers,inspectExternal,claimExternal,releaseExternal} from './external-containers.mjs';
import {execFile,spawn} from 'node:child_process';
import {access,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';

const IMAGE='dingtu-runtime:3-clean',LEGACY_IMAGE='dingtu-runtime:1';
export function resourcePrefix(owner,id){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('无效环境');return 'dingtu-'+createHash('sha256').update(owner).digest('hex').slice(0,12)+'-'+id;}
export function workerArguments({name,network,gatewayIP,proxyURL,image=IMAGE,projectMounts=[],spec}){
 if(!/^\d+\.\d+\.\d+\.\d+$/.test(gatewayIP))throw new Error('容器网关地址无效');
 return ['run','-d',...reliabilityArguments,'--health-cmd','test -f /tmp/kuneco-worker-ready','--health-interval','30s','--health-timeout','3s','--health-retries','3','--name',name,'--label','app=dingtu',...(spec?['--label',SPEC_LABEL+'='+spec]:[]),'--network',network,'--dns','127.0.0.1','--read-only','--cap-drop','ALL','--cap-add','NET_ADMIN','--cap-add','SETUID','--cap-add','SETGID','--security-opt','no-new-privileges','--pids-limit','256','--memory','2g','--cpus','2','--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--mount',`type=volume,src=${name}-home,dst=/home/node`,'--mount',`type=volume,src=${name}-work,dst=/workspace`,...projectMounts.flatMap(m=>['--mount',`type=bind,src=${m.source},dst=${m.target}`]),'-e',`DINGTU_GATEWAY_IP=${gatewayIP}`,...['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY'].flatMap(key=>['-e',`${key}=${proxyURL}`]),'-e','NO_PROXY=localhost,127.0.0.1','-e','PATH=/home/node/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','--entrypoint','/opt/dingtu/worker.sh',image];
}
// Downloads run separately from the proxy-only worker. Only its home volume is shared.
export function runtimeInstallerArguments({name,prefix,image=IMAGE,args,input=false,network='bridge'}){
 return ['run','--rm',...reliabilityArguments,...(input?['-i']:[]),'--name',name,'--label','app=dingtu-installer','--network',network,'--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','2g','--cpus','2','--tmpfs','/tmp:rw,nosuid,nodev,size=512m','--mount',`type=volume,src=${prefix}-worker-home,dst=/home/node`,'-e','HOME=/home/node','-e','NPM_CONFIG_PREFIX=/home/node/.local','-e','NPM_CONFIG_CACHE=/home/node/.local/.npm-cache','-e','NPM_CONFIG_USERCONFIG=/dev/null','-e','PATH=/home/node/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',...['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'].flatMap(key=>['-e',key+'=']),'--entrypoint',args[0],image,...args.slice(1)];
}
// Direct tasks have their own network, PID and /tmp namespaces; never attach bridge to the proxy worker.
export function directTaskArguments({prefix,name,image,projectMounts=[],task,command,args=[]}){
 const run=runtimeInstallerArguments({name,prefix,image,input:true,network:prefix+'-direct-egress',args:['/usr/local/bin/node','/opt/dingtu/exec.mjs',task,command,...args]});
 run[run.indexOf('app=dingtu-installer')]='app=dingtu-direct';
 run.splice(run.indexOf('--entrypoint'),0,'--label','io.kuneco.environment='+prefix,'--workdir','/workspace','--mount',`type=volume,src=${prefix}-worker-work,dst=/workspace`,...projectMounts.flatMap(m=>['--mount',`type=bind,src=${m.source},dst=${m.target}`]),'-e','NO_PROXY=*','-e','no_proxy=*','-e','LANG=C.UTF-8','-e','LC_ALL=C.UTF-8');
 return run;
}
export class DockerEnvironments {
 constructor({directory,sourceRoot,encrypt,decrypt,defaultLocalEnabled=false,readDeviceName=deviceName}){Object.assign(this,{directory,sourceRoot,encrypt,decrypt,defaultLocalEnabled,readDeviceName});this.context='colima-dingtu';this.endpoint='unix://'+path.join(homedir(),'.colima','dingtu','docker.sock');this.busy=false;}
 async binary(name){for(const location of [path.join(process.resourcesPath||this.sourceRoot,'container-engine','bin',name),path.join(this.sourceRoot,'vendor','container-engine','bin',name),'/opt/homebrew/bin/'+name,'/usr/local/bin/'+name]){try{await access(location);return location;}catch{}}throw new Error('容器引擎组件未安装，请初始化容器引擎');}
 async command(args,{input,inputFile,timeout=30000,endpoint=this.endpoint,maxBuffer=4*1024*1024,combinedOutput=false}={}){
  const binary=await this.binary('docker');
  return new Promise((resolve,reject)=>{
   const child=execFile(binary,['--host',endpoint,...args],{cwd:this.sourceRoot,timeout,maxBuffer,env:{...process.env,DOCKER_HOST:'',DOCKER_CONTEXT:this.context,DOCKER_BUILDKIT:'0',PATH:path.join(this.sourceRoot,'vendor','container-engine','bin')+':'+(process.env.PATH || '/usr/bin:/bin')}},(error,stdout,stderr)=>{if(error)return reject(new Error('Docker 操作失败：'+String(stderr || error.message).replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s@]+@/gi,'$1***@').slice(-600)));resolve(combinedOutput?[stdout,stderr].filter(Boolean).join("\n").trim():stdout.trim() || stderr.trim());});
   child.stdin.on('error',()=>{});if(inputFile){const source=createReadStream(inputFile);source.on('error',error=>{child.kill();reject(error);});child.on('close',()=>source.destroy());source.pipe(child.stdin);}else child.stdin.end(input);
  });
 }
 async engineProcess(binary,args,{timeout,env,onProgress}){
  return new Promise((resolve,reject)=>{
   let tail='';
   const child=execFile(binary,args,{timeout,maxBuffer:4*1024*1024,env},error=>error?reject(new Error('容器引擎准备失败，请检查网络与磁盘空间后重试')):resolve());
   const output=chunk=>{tail=(tail+String(chunk)).slice(-4096);const matches=[...tail.matchAll(/(\d+(?:\.\d+)?)%/g)];if(matches.length){const percent=Number(matches.at(-1)[1]);if(percent>=0 && percent<=100)onProgress?.({percent});tail='';}};
   child.stdout.on('data',output);child.stderr.on('data',output);
  });
 }
 async prepare(onProgress=()=>{},options={}){
  const configuration=imageConfiguration(options);
  if(this.busy)throw new Error('正在初始化容器引擎');this.busy=true;
  try{
   onProgress({stage:1,message:"检查容器引擎组件"});
   let colima;try{colima=await this.binary('colima');await this.binary('docker');}catch{
    let brew;for(const file of ['/opt/homebrew/bin/brew','/usr/local/bin/brew'])try{await access(file);brew=file;break;}catch{}
    if(!brew)throw new Error('容器引擎组件缺失：当前开发版需要安装完整引擎组件，尚未提供独立分发安装包');
    await this.engineProcess(brew,['install','docker','colima'],{timeout:900000,env:{...process.env,HOMEBREW_NO_AUTO_UPDATE:'1',HOMEBREW_NO_INSTALL_CLEANUP:'1'},onProgress:download=>onProgress({stage:1,message:'下载并安装容器引擎组件',download})});colima=await this.binary('colima');
   }
   onProgress({stage:2,message:'启动容器引擎'});
   let projectMountPaths=[];try{const manifest=JSON.parse(await readFile(path.join(this.directory || path.join(homedir(),'.dingtu'),'project-mounts.json'),'utf8'));projectMountPaths=manifest.paths || [];}catch(error){if(error.code!=='ENOENT')throw error;}
   await this.engineProcess(colima,['start','dingtu','--activate=false','--vm-type','vz','--cpus','2','--memory','4','--disk','30',...(projectMountPaths.length?projectMountPaths.flatMap(p=>['--mount',p+':w']):['--mount','none'])],{timeout:600000,env:{...process.env,PATH:path.dirname(colima)+':'+(process.env.PATH || '/usr/bin:/bin')},onProgress:download=>onProgress({stage:2,message:'下载或启动容器引擎',download})});
   onProgress({stage:3,message:'准备基础镜像，首次下载可能需要几分钟'});
   await this.pullBaseImage(configuration,progress=>onProgress({stage:3,message:'下载基础镜像',download:progress}));
   onProgress({stage:3,message:'构建容器基础镜像，正在安装必需组件',download:{percent:null}});
   await this.command(['build','--build-arg','BASE_IMAGE='+configuration.baseImage,'-t',configuration.imageName,'-f','docker/runtime/Dockerfile','.'],{timeout:900000});
   onProgress({stage:4,message:'核验容器引擎与基础镜像'});
   const status=await this.engineStatus(configuration);if(!status.ready || !status.image)throw new Error('配置核验未通过，请重试');
   await this.verifyImageTools(configuration.imageName);
   onProgress({stage:4,complete:true,message:'容器环境配置完成'});
  }finally{this.busy=false;}
 }
 async configureImage(owner,options){return accountMutation(this,owner,async()=>{if(this.busy)throw new Error('正在配置容器，请稍候');const configuration=imageConfiguration(options),data=await this.load(owner);data.imageConfig={version:configuration.version,repository:configuration.repository};await this.save(owner,data);return data.imageConfig;});}
 async pullBaseImage(configuration,onProgress){
  const progress=new ImageDownloadProgress();
  return new Promise((resolve,reject)=>{
   let pending='',settled=false,lastSent=0;
   const fail=error=>{if(!settled){settled=true;reject(error);}};
   const req=http.request({socketPath:this.endpoint.slice('unix://'.length),method:'POST',path:'/images/create?fromImage='+encodeURIComponent(configuration.repository)+'&tag='+encodeURIComponent(configuration.version)},res=>{
    if(res.statusCode!==200){res.resume();fail(new Error('镜像下载失败，仓库返回状态 '+res.statusCode+'。请检查公开仓库地址与版本'));return;}
    const line=raw=>{if(!raw.trim())return;const event=JSON.parse(raw),value=progress.update(event);if(Date.now()-lastSent>100 || ['Download complete','Pull complete'].includes(event.status)){lastSent=Date.now();onProgress(value);}};
    res.setEncoding('utf8');res.on('data',chunk=>{pending+=chunk;try{let end;while((end=pending.indexOf('\n'))!==-1){const raw=pending.slice(0,end);pending=pending.slice(end+1);line(raw);}if(pending.length>1024*1024)throw new Error('镜像下载响应异常');}catch(error){fail(error);req.destroy();}});
    res.on('end',()=>{try{line(pending);if(!settled){settled=true;onProgress({...progress.update({}),percent:100,complete:true});resolve();}}catch(error){fail(error);}});res.on('error',fail);res.on('aborted',()=>fail(new Error('镜像下载连接中断，请重试')));
   });
   req.setTimeout(900000,()=>req.destroy(new Error('镜像下载超时，请重试')));req.on('error',fail);req.end();
  });
 }
 async engineStatus(options={}){
  const configuration=imageConfiguration(options);
  const info={name:'Docker Engine',...configuration,imageSize:null};
  try{const version=await this.command(['version','--format','{{.Server.Version}}']);let image=true;
   try{const inspection=await this.command(['image','inspect',configuration.imageName]);try{const size=JSON.parse(inspection)?.[0]?.Size;if(Number.isFinite(size) && size>=0)info.imageSize=size;}catch{}}catch{image=false;}
   return {...info,ready:true,image,version,busy:this.busy};
  }catch{return {...info,ready:false,image:false,busy:this.busy};}
 }
 file(owner){if(!owner)throw new Error('请先登录再创建 Docker 环境');return path.join(this.directory,createHash('sha256').update(owner).digest('hex')+'.bin');}
 async load(owner){const localName=await this.readDeviceName();if(!owner)return {activeId:null,localName,environments:[]};try{return {...JSON.parse(this.decrypt(await readFile(this.file(owner)))),localName};}catch(error){if(error.code==='ENOENT')return{activeId:null,localName,localEnabled:this.defaultLocalEnabled,environments:[]};throw new Error('环境配置无法读取，已停止切换');}}
 async save(owner,value){await mkdir(this.directory,{recursive:true,mode:0o700});const file=this.file(owner),temporary=file+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,this.encrypt(JSON.stringify(value)),{mode:0o600,flag:'wx'});await rename(temporary,file);}finally{await rm(temporary,{force:true});}}
 async get(owner,id){const data=await this.load(owner);const item=data.environments.find(item=>item.id===id);if(!item)throw new Error('当前账号下不存在该环境');return {data,item,prefix:resourcePrefix(owner,id)};}
 async create(owner,name,icon){return accountMutation(this,owner,async()=>{if(typeof name!=='string'||!name.trim()||name.length>40)throw new Error('环境名称需为1至40个字符');const data=await this.load(owner);if(data.environments.length>=10)throw new Error('最多创建10个环境');const item={id:randomUUID(),name:name.trim(),icon:environmentIcon(icon),createdAt:new Date().toISOString(),imageName:imageConfiguration(data.imageConfig).imageName,baseImage:imageConfiguration(data.imageConfig).baseImage,registry:null,proxy:null};data.environments.push(item);await this.save(owner,data);return item.id;});}
 async verifyImageTools(image){
  try{await this.command(['run','--rm','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges','--entrypoint','sh',image,'-c','node --version && npm --version && curl --version && git --version && command -v ssh-keygen'],{timeout:30000});}
  catch{throw new Error('基础镜像缺少可用的 Node.js、npm、curl、Git 或 SSH 客户端，请重新准备基础镜像后再创建环境');}
 }
 async createPrepared(owner,name,icon){
  const data=await this.load(owner),engine=await this.engineStatus(data.imageConfig);
  if(!engine.ready || !engine.image)throw new Error('请先准备容器引擎与基础镜像');
  await this.verifyImageTools(imageConfiguration(data.imageConfig).imageName);
  const id=await this.create(owner,name,icon);
  try{
   const {prefix,item}=await this.get(owner,id);
   await readGitInfo(args=>{
    const command=runtimeInstallerArguments({name:prefix+'-git-init',prefix,image:item.imageName,args:[...args.slice(0,2),"require('fs').mkdirSync('/workspace/Download',{recursive:true});\n"+args[2],...args.slice(3)],network:'none'});
    command.splice(command.indexOf('--entrypoint'),0,'--mount',`type=volume,src=${prefix}-worker-work,dst=/workspace`);
    return this.command(command);
   },{generate:true});
   return id;
  }catch(error){
   try{await this.deleteResources(owner,id,name.trim());await this.forget(owner,id,name.trim());}
   catch{throw new Error('Git 初始化失败：'+error.message+'。部分资源已保留，请在环境列表中重试或删除「'+name.trim()+'」。');}
   throw new Error('Git 初始化失败，已清理本次创建的资源：'+error.message);
  }
 }
 async createAndStart(owner,name,icon){
  const data=await this.load(owner),engine=await this.engineStatus(data.imageConfig);if(!engine.ready || !engine.image)throw new Error('请先准备容器引擎与基础镜像');
  await this.verifyImageTools(imageConfiguration(data.imageConfig).imageName);
  const id=await this.create(owner,name,icon);
  try{await this.start(owner,id);await readGitInfo(args=>this.exec(owner,id,args),{generate:true});return id;}
  catch(error){
   try{await this.deleteResources(owner,id,name.trim());await this.forget(owner,id,name.trim());}
   catch{throw new Error('容器创建未完成：'+error.message+'。部分资源已保留，请在环境列表中重试启动或删除「'+name.trim()+'」。');}
   throw new Error('容器创建失败，已清理本次创建的资源：'+error.message);
  }
 }
 async existing(owner){
  const [containers,data]=await Promise.all([listExternalContainers(this,owner),this.load(owner)]);
  return containers.map(container=>({...container,environmentNames:data.environments.filter(item=>item.external?item.external.id===container.id:container.name===resourcePrefix(owner,item.id)+'-worker').map(item=>item.name)}));
 }
 async previewExisting(owner,key){const item=await inspectExternal(this,owner,key);if(!item.running)return {runtimes:[],stopped:true};return this.detectCommands(args=>this.command(['exec',item.id,...args],{endpoint:item.endpoint}));}
 async attach(owner,name,key,icon){return accountMutation(this,owner,async()=>{
  if(typeof name!=='string'||!name.trim()||name.trim().length>40)throw new Error('环境名称需为1至40个字符');
  const data=await this.load(owner),source=await inspectExternal(this,owner,key);
  const duplicate=data.environments.find(item=>item.external?.id===source.id || resourcePrefix(owner,item.id)+'-worker'===source.name);
  if(duplicate)return duplicate.id;
  if(data.environments.length>=10)throw new Error('最多创建10个环境');
  const claimed=await claimExternal(this,owner,source);
  try{if(!source.running)await this.command(['start',source.id],{endpoint:source.endpoint});
   const item={id:randomUUID(),name:name.trim(),icon:environmentIcon(icon),createdAt:new Date().toISOString(),registry:null,proxy:null,external:source};data.environments.push(item);await this.save(owner,data);return item.id;
  }catch(error){if(claimed)await releaseExternal(this,owner,source);throw error;}
 });}
 async syncDeepSeekSource(owner,id){
  const runtime=await readFile(path.join(this.sourceRoot,'src/features/runtimes/deepseek-runtime.mjs'),'utf8');
  const compaction=await readFile(path.join(this.sourceRoot,'src/features/runtimes/history-compaction.mjs'),'utf8');
  const snapshot=await readFile(path.join(this.sourceRoot,'src/features/runtimes/file-snapshot.mjs'),'utf8');
  const catalog=await readFile(path.join(this.sourceRoot,'src/features/runtimes/context-catalog.mjs'),'utf8');
  const tools=await readFile(path.join(this.sourceRoot,'src/features/runtimes/deepseek-tools.mjs'),'utf8');
  const lifecycle=await readFile(path.join(this.sourceRoot,'src/features/proxy/request-lifecycle.mjs'),'utf8');
  const admission=await readFile(path.join(this.sourceRoot,'src/features/proxy/request-admission.mjs'),'utf8');
  await this.exec(owner,id,['node','-e',"const fs=require('fs'),base='/home/node/.local/lib';let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const files=JSON.parse(s);for(const [file,value] of Object.entries(files)){const p=base+'/'+file;fs.mkdirSync(require('path').dirname(p),{recursive:true});const tmp=p+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,value,{mode:0o600});fs.renameSync(tmp,p);}});"],{input:JSON.stringify({'dingtu/deepseek.mjs':runtime,'dingtu/deepseek-tools.mjs':tools,'dingtu/context-catalog.mjs':catalog,'dingtu/file-snapshot.mjs':snapshot,'dingtu/history-compaction.mjs':compaction,'proxy/request-lifecycle.mjs':lifecycle,'proxy/request-admission.mjs':admission})});
 }
 async detectCommands(execute){const runtimes=[];for(const [id,command] of CLI_RUNTIMES.map(id=>[id,RUNTIME_CATALOG[id].command]))try{const version=await execute([command,'--version']);runtimes.push({id,name:RUNTIME_CATALOG[id].name,version});}catch{}try{const item=JSON.parse(await execute(['node','/home/node/.local/lib/dingtu/deepseek.mjs','info']));if(item.id==='deepseek')runtimes.push(item);}catch{}return {runtimes,checkedAt:new Date().toISOString()};}
 async workingDirectory(owner,id){const {item}=await this.get(owner,id);return item.external?.workingDirectory || '/workspace';}
 async update(owner,id,patch){return accountMutation(this,owner,async()=>{const {data,item}=await this.get(owner,id);Object.assign(item,typeof patch==='function'?patch(item):patch);await this.save(owner,data);});}
 async select(owner,id){return accountMutation(this,owner,async()=>{const data=await this.load(owner);if(id?!data.environments.some(item=>item.id===id):data.localEnabled===false)throw new Error('环境不存在');data.activeId=id;await this.save(owner,data);});}
 // Stop only containers registered to this account; never touch unrelated Docker workloads.
 async stopOtherEnvironments(owner,id){
  const data=await this.load(owner);
  for(const item of data.environments){
   if(item.id===id)continue;
   await this.stopEnvironmentResources(resourcePrefix(owner,item.id),item);
  }
 }

 async ensureSelectedEngine(owner,id){
  if(!id)return;
  const {item}=await this.get(owner,id);if(item.external)return;
  if((await this.engineStatus()).ready)return;
  // Resume the existing profile without rebuilding images or changing its mounts.
  const colima=await this.binary('colima');
  await this.engineProcess(colima,['start','dingtu','--activate=false'],{timeout:600000,env:{...process.env,PATH:path.dirname(colima)+':'+(process.env.PATH || '/usr/bin:/bin')}});
  if(!(await this.engineStatus()).ready)throw new Error('容器引擎启动失败');
 }
 async activate(owner,id){
  const data=await this.load(owner);
  if(id?!data.environments.some(item=>item.id===id):data.localEnabled===false)throw new Error('环境不存在');
  await this.stopOtherEnvironments(owner,id);
  if(id){const item=data.environments.find(item=>item.id===id),prefix=resourcePrefix(owner,id);if(this.environmentStopFailures?.has(prefix))await this.stopEnvironmentResources(prefix,item);else await this.stopDirectTasks(prefix,{reconcileManagedContainers:!item.external});}
  if(id){
   try{await this.start(owner,id);}
   catch(error){await this.stop(owner,id).catch(()=>{});throw new Error('目标环境启动失败，原环境已停止：'+error.message);}
  }
  await this.select(owner,id);
 }
 async changeEnvironmentIcon(owner,id,icon){return accountMutation(this,owner,async()=>{
  if(!owner)throw new Error('请先登录');
  if(!ENVIRONMENT_ICONS.includes(icon))throw new Error('请选择有效的环境图标');
  const data=await this.load(owner);
  if(id===null){if(data.localEnabled===false)throw new Error('环境不存在');data.localIcon=icon;}
  else{const item=data.environments.find(item=>item.id===id);if(!item)throw new Error('当前账号下不存在该环境');item.icon=icon;}
  await this.save(owner,data);
 });}
 async renameEnvironment(owner,id,name){return accountMutation(this,owner,async()=>{
  if(!owner)throw new Error('请先登录');
  if(typeof name!=='string' || !name.trim() || name.trim().length>40)throw new Error('环境名称需为1至40个字符');
  const data=await this.load(owner),value=name.trim();
  if(id===null)throw new Error('本机环境名称跟随当前设备名称，请在系统设置中修改');
  else{const item=data.environments.find(item=>item.id===id);if(!item)throw new Error('当前账号下不存在该环境');item.name=value;}
  await this.save(owner,data);
 });}
 async createLocal(owner,name,icon){return accountMutation(this,owner,async()=>{const data=await this.load(owner);if(data.localEnabled!==false)throw new Error('本机环境已存在');data.localEnabled=true;delete data.localName;data.localIcon=environmentIcon(icon,"monitor");await this.save(owner,data);});}
 async forgetLocal(owner,name){return accountMutation(this,owner,async()=>{const data=await this.load(owner);if(data.localEnabled===false || name!==(data.localName || '本机环境'))throw new Error('请输入完整且一致的环境名称');data.localEnabled=false;if(!data.activeId)data.activeId=data.environments[0]?.id || null;await this.save(owner,data);});}
 async deleteResources(owner,id,name){
  const {item,prefix}=await this.get(owner,id);if(name!==item.name)throw new Error('请输入完整且一致的环境名称');if(item.external)return;
  await this.stopDirectTasks(prefix);
  // List first so unavailable engines and removal failures cannot look like successful deletion.
  for(const [kind,names] of [['container',[prefix+'-worker',prefix+'-gateway']],['network',[prefix+'-private',prefix+'-direct-egress']],['volume',[prefix+'-worker-home',prefix+'-worker-work']]]){
   const existing=new Set((await this.command([kind,'ls',...(kind==='container'?['-a']:[]),'--format','{{.Name'+(kind==='container'?'s':'')+'}}'])).split('\n'));
   for(const name of names)if(existing.has(name))await this.command([kind,'rm',...(kind==='container'?['-f']:[]),name]);
  }
 }
 async forget(owner,id,name){return accountMutation(this,owner,async()=>{const {data,item}=await this.get(owner,id);if(name!==item.name)throw new Error('请输入完整且一致的环境名称');const ordered=[...(data.localEnabled!==false?[null]:[]),...data.environments.map(item=>item.id)],index=ordered.indexOf(id);const remaining=ordered.filter(value=>value!==id);data.environments=data.environments.filter(item=>item.id!==id);if(data.activeId===id)data.activeId=remaining[index] ?? remaining[0] ?? null;await this.save(owner,data);if(item.external)await releaseExternal(this,owner,item.external);});}
 async state(owner){
  const data=await this.load(owner),engine=await this.engineStatus(data.imageConfig);
  const environments=await Promise.all(data.environments.map(async item=>{
   let diagnostics=containerStatus(null);
   if(item.external || engine.ready)try{diagnostics=containerStatus(JSON.parse(await this.command(['inspect','--format','{{json .State}}',item.external?.id || resourcePrefix(owner,item.id)+'-worker'],{endpoint:item.external?.endpoint || this.endpoint,timeout:5000})));}catch{}
   return {id:item.id,name:item.name,icon:item.icon,createdAt:item.createdAt,...diagnostics,external:Boolean(item.external),containerName:item.external?.name || null,runtimeCount:item.registry?.runtimes?.length||0};
  }));return {...data,localEnabled:data.localEnabled!==false,localName:data.localName || '本机环境',environments,engine,activeId:data.activeId};
 }
 // Keep all asynchronous creation work inside the same stop barrier as task launches.
 async withEnvironmentPreparation(prefix,operation){
  const guard=this.taskLaunchGuard();guard(prefix);
  this.environmentPreparations ||= new Map();
  let pending;const active=this.environmentPreparations.get(prefix) || new Set();
  this.environmentPreparations.set(prefix,active);
  pending=Promise.resolve().then(()=>{guard(prefix);return operation(()=>guard(prefix));});
  active.add(pending);
  try{return await pending;}finally{active.delete(pending);if(!active.size)this.environmentPreparations.delete(prefix);}
 }
 async ensureGateway(owner,id,engineOverride){
  const key=resourcePrefix(owner,id);
  return this.withEnvironmentPreparation(key,async assertCurrent=>{
   this.gatewayPreparations ||= new Map();
   const previous=this.gatewayPreparations.get(key) || Promise.resolve();
   const pending=previous.catch(()=>{}).then(()=>{assertCurrent();return this.prepareGateway(owner,id,assertCurrent,engineOverride);});this.gatewayPreparations.set(key,pending);
   try{return await pending;}finally{if(this.gatewayPreparations.get(key)===pending)this.gatewayPreparations.delete(key);}
  });
 }
 async prepareGateway(owner,id,assertCurrent=()=>{},engineOverride){
  assertCurrent();
  const {prefix,item}=await this.get(owner,id),name=prefix+'-gateway',network=prefix+'-private';
  assertCurrent();const engine=engineOverride || (item.proxy?.node?'mihomo':process.env.KUNECO_PROXY_ENGINE || 'native');
  const image=await gatewayImage(this,item.imageName || LEGACY_IMAGE,engine);
  assertCurrent();await ensurePrivateNetwork(this,network);assertCurrent();
  const existing=await inspectContainer(this,name);assertCurrent();
  if(existing && existing.Config?.Labels?.app!=='dingtu')throw new Error('容器归属不匹配，已停止升级');
  if(existing){validateContainerNetworks(existing,network,{gateway:true});if((existing.Mounts || []).some(m=>m.Type!=='tmpfs'))throw new Error('网关存在额外数据挂载，保留原容器，请先核对挂载');}
  const privateIP=existing?.NetworkSettings?.Networks?.[network]?.IPAddress;
  const spec=specHash({version:1,image,role:'gateway'});
  if(existing?.Config.Image===image && existing.Config.Labels?.[SPEC_LABEL]===spec){await this.command(['start',name]);assertCurrent();return{prefix,name,network};}
  // Build and validate first, then replace only this environment's stateless gateway.
  // Keep its private address because the worker's firewall pins that address.
  const attempt=randomUUID(),backup=name+'-upgrade-'+Date.now();let renamed=false,detached=false,created=false;
  try{if(existing){await this.command(['stop','-t','5',name]);assertCurrent();await this.command(['rename',name,backup]);renamed=true;assertCurrent();if(privateIP){await this.command(['network','disconnect',network,backup]);detached=true;assertCurrent();}}
  created=true;await this.command(['run','-d',...reliabilityArguments,'--label',ATTEMPT_LABEL+'='+attempt,'--label',SPEC_LABEL+'='+spec,'--health-cmd',"printf '%s' '{\"action\":\"status\"}' | node /opt/dingtu/control.mjs",'--health-interval','30s','--health-timeout','5s','--health-retries','3','--name',name,'--label','app=dingtu','--network','bridge','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','256m','--tmpfs','/tmp:rw,nosuid,nodev,size=32m','-p','127.0.0.1::8080',image,'node','/opt/dingtu/gateway.mjs']);
  assertCurrent();await this.command(['network','connect',...(privateIP?['--ip',privateIP]:[]),network,name]);assertCurrent();
  let ready=false;for(let i=0;i<30;i++){try{await this.rpc(owner,id,'status');assertCurrent();ready=true;break;}catch{assertCurrent();await new Promise(r=>setTimeout(r,100));}}if(!ready)throw new Error('新网关控制入口未就绪，已取消升级');
  }catch(error){if(created)await removeAttemptContainer(this,name,attempt);if(existing){if(renamed)await this.command(['rename',backup,name]);if(detached)await this.command(['network','connect','--ip',privateIP,network,name]);let current=true;try{assertCurrent();}catch{current=false;}if(existing.State.Running&&current)await this.command(['start',name]);}throw error;}
  if(existing)await this.command(['rm',backup]);
  return{prefix,name,network};
 }
 async rpc(owner,id,action,value){const {prefix}=await this.get(owner,id);const raw=await this.command(['exec','-i',prefix+'-gateway','node','/opt/dingtu/control.mjs'],{input:JSON.stringify({action,value})});return JSON.parse(raw);}
 async start(owner,id){return this.withEnvironmentPreparation(resourcePrefix(owner,id),async assertCurrent=>{const {item}=await this.get(owner,id);assertCurrent();if(item.external){await this.command(['start',item.external.id],{endpoint:item.external.endpoint});assertCurrent();return this.state(owner);}const adapter=await this.connect(owner,id,{protocol:'http',host:'192.0.2.1',port:1,username:'',password:''},null);assertCurrent();await adapter.startWorker();assertCurrent();return this.state(owner);});}
 async shutdownTasks(){
  this.shuttingDown=true;
  // Preparations see the shutdown guard before publishing or launching work.
  await Promise.allSettled([...(this.environmentPreparations?.values() || [])].flatMap(set=>[...set]));
  const prefixes=new Set([...(this.directTasks?.values() || [])].map(task=>task.prefix));
  for(const prefix of this.directStopFailures || [])prefixes.add(prefix);
  const results=await Promise.allSettled([...prefixes].map(prefix=>this.stopDirectTasks(prefix,{reconcileManagedContainers:false})));
  const errors=results.filter(result=>result.status==='rejected').map(result=>result.reason);
  if(errors.length)throw new AggregateError(errors,'退出清理未完成，请重试退出');
 }
 reserveTask(){this.taskCapacity ||= new TaskCapacity();return this.taskCapacity.reserve();}
 async stopDirectTasks(prefix,{reconcileManagedContainers=true}={}){
  this.directStops ||= new Map();
  if(this.directStops.has(prefix))return this.directStops.get(prefix);
  this.directGenerations ||= new Map();
  const invalidate=()=>this.directGenerations.set(prefix,(this.directGenerations.get(prefix)||0)+1);
  invalidate();
  const pending=Promise.resolve().then(async()=>{
   const settled=await Promise.allSettled([...(this.directTasks?.entries() || [])].filter(([,task])=>task.prefix===prefix).map(async([id,task])=>{await task.cancel();this.directTasks.delete(id);}));
   const errors=settled.filter(result=>result.status==='rejected').map(result=>result.reason);
   for(const app of reconcileManagedContainers?['dingtu-direct','dingtu-installer']:[]){
    try{
     const names=(await this.command(['ps','-a','--format','{{.Names}}','--filter','label=app='+app,'--filter','label=io.kuneco.environment='+prefix])).split('\n').filter(Boolean);
     for(const name of names)try{await cleanupDirectTask(this,name,prefix,app);}catch(error){errors.push(error);}
    }catch(error){errors.push(error);}
   }
   if(errors.length)throw new AggregateError(errors,'环境任务清理未完成：'+errors.map(error=>error.message).join('；'));
  });
  this.directStops.set(prefix,pending);
  this.directStopFailures ||= new Set();
  try{await pending;this.directStopFailures.delete(prefix);}
  catch(error){this.directStopFailures.add(prefix);throw error;}
  finally{invalidate();this.directStops.delete(prefix);}
 }
 taskLaunchGuard(){
  const generations=new Map(this.directGenerations);
  return prefix=>{if(this.shuttingDown)throw new Error('应用正在退出，不能启动新任务');if(this.environmentStopFailures?.has(prefix)||this.directStopFailures?.has(prefix))throw new Error('环境任务清理未完成，请重试停止或切换环境');if(this.environmentStops?.has(prefix)||this.directStops?.has(prefix)||(generations.get(prefix)||0)!==(this.directGenerations?.get(prefix)||0))throw new Error('环境已停止或切换，不能启动旧任务');};
 }

 async stopEnvironmentResources(prefix,item){
  this.environmentStops ||= new Map();
  if(this.environmentStops.has(prefix))return this.environmentStops.get(prefix);
  this.directGenerations ||= new Map();
  const invalidate=()=>this.directGenerations.set(prefix,(this.directGenerations.get(prefix)||0)+1);
  invalidate();
  const pending=Promise.resolve().then(async()=>{
   const direct=this.stopDirectTasks(prefix,{reconcileManagedContainers:!item.external});
   // Wait even when task cleanup fails: a delayed Docker create must settle before stop returns.
   const [cleanup]=await Promise.allSettled([direct,...(this.environmentPreparations?.get(prefix)||[])]);
   const endpoint=item.external?.endpoint || this.endpoint;
   const names=new Set((await this.command(['ps','-a',...(item.external?['--no-trunc']:[]),'--format',item.external?'{{.ID}}':'{{.Names}}'],{endpoint})).split('\n'));
   const targets=item.external?[item.external.id]:['worker','gateway'].map(suffix=>prefix+'-'+suffix);
   const errors=cleanup.status==='rejected'?[cleanup.reason]:[];
   for(const target of targets){
    if(!names.has(target))continue;
    try{await this.command(['stop','-t','5',target],{endpoint});if((await this.command(['inspect','--format','{{.State.Running}}',target],{endpoint})).trim()!=='false')throw new Error('容器未能停止，请重试');}
    catch(error){
     // Removal may race the initial listing or post-stop inspect. Only a fresh,
     // successful listing on the same daemon can confirm the target is gone.
     try{
      const remaining=(await this.command(['ps','-a',...(item.external?['--no-trunc']:[]),'--format',item.external?'{{.ID}}':'{{.Names}}'],{endpoint})).split('\n');
      if(remaining.includes(target))errors.push(error);
     }catch{errors.push(error);}
    }
   }
   if(errors.length)throw new AggregateError(errors,'环境停止未完成：'+errors.map(error=>error.message).join('；'));
  });
  this.environmentStops.set(prefix,pending);this.environmentStopFailures ||= new Set();
  try{await pending;this.environmentStopFailures.delete(prefix);}
  catch(error){this.environmentStopFailures.add(prefix);throw error;}
  finally{invalidate();this.environmentStops.delete(prefix);}
 }
 async stop(owner,id){const {prefix,item}=await this.get(owner,id);await this.stopEnvironmentResources(prefix,item);return this.state(owner);}
 async connect(owner,id,config,expectedIp,onVerified){
  return this.withEnvironmentPreparation(resourcePrefix(owner,id),async assertEnvironmentCurrent=>{
  const {item}=await this.get(owner,id);if(item.external)throw new Error('已有容器使用原网络，请使用应用代理连接');assertEnvironmentCurrent();const {prefix,name,network}=await this.ensureGateway(owner,id,config.node?'mihomo':undefined);assertEnvironmentCurrent();
  // Give the container service time to bind without silently retrying a proxy request.
  let ready=false;for(let i=0;i<30;i++){try{await this.rpc(owner,id,'status');assertEnvironmentCurrent();ready=true;break;}catch{assertEnvironmentCurrent();await new Promise(r=>setTimeout(r,100));}}if(!ready)throw new Error('容器代理服务未启动');
  const info=await this.rpc(owner,id,'connect',{config,expectedIp,engine:config.node?'mihomo':process.env.KUNECO_PROXY_ENGINE || 'native'});
  assertEnvironmentCurrent();const ports=JSON.parse(await this.command(['inspect','--format','{{json .NetworkSettings.Ports}}',name]));const port=Number(ports['8080/tcp']?.[0]?.HostPort);if(!port)throw new Error('容器代理端口未就绪');
  assertEnvironmentCurrent();const gatewayIP=await this.command(['inspect','--format',`{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,name]);
  assertEnvironmentCurrent();const adapter=new ContainerGateway(this,owner,id,port,info.token,onVerified);
  adapter.startWorker=async({isCurrent=()=>true}={})=>this.withEnvironmentPreparation(prefix,async()=>{
   const generation=adapter.generation;
   const assertCurrent=()=>{assertEnvironmentCurrent();if(!adapter.current(generation)||!isCurrent())throw Object.assign(new Error('代理操作已取消'),{name:'AbortError'});};
   assertCurrent();
   await this.prepareWorker({prefix,item,network,gatewayIP,token:info.token,assertCurrent});assertCurrent();
   await this.exec(owner,id,['/usr/local/bin/node','-e',"let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>require('fs').writeFileSync('/tmp/dingtu-chat-proxy',s,{mode:0o600}));"],{input:`http://workspace:${info.token}@${gatewayIP}:8080`});
  });
  return adapter;
  });
 }
 async prepareWorker({prefix,item,network,gatewayIP,token,assertCurrent}){
  const name=prefix+'-worker',image=await workerImage(this,item.imageName || LEGACY_IMAGE);assertCurrent();
  const spec=specHash({version:1,image,network,gatewayIP,mounts:item.projectMounts || []});
  const args=workerArguments({name,network,gatewayIP,proxyURL:`http://workspace:${token}@${gatewayIP}:8080`,image,projectMounts:item.projectMounts || [],spec});
  await ensureWorker(this,{name,image,spec,args,assertCurrent});
 }
 async previewRuntimes(){const runtimes=[];for(const id of ['cc','codex']){try{const version=await this.command(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--entrypoint',id==='cc'?'claude':'codex',IMAGE,'--version'],{timeout:20000});runtimes.push({id,name:id==='cc'?'Claude Code':'Codex',version});}catch{}}return {runtimes,checkedAt:new Date().toISOString()};}
 async runtimeInfo(owner,id,detect){const {item,prefix}=await this.get(owner,id);if(!detect)return item.registry || {hostName:item.name,runtimes:[]};if((await this.command(['inspect','--format','{{.State.Running}}',item.external?.id || prefix+'-worker'],{endpoint:item.external?.endpoint || this.endpoint}))!=='true')throw new Error('容器尚未运行，请先启动');const result=await this.detectCommands(args=>this.exec(owner,id,args));const registry={...result,hostName:item.name,runtimes:result.runtimes.map(runtime=>({...runtime,...(item.runtimeMetadata?.[runtime.id] || {})}))};await this.update(owner,id,{registry});return registry;}
 async exec(owner,id,args,options={}){const {prefix,item}=await this.get(owner,id);if(item.external)return this.command(['exec',...((options.input!==undefined||options.inputFile)?['-i']:[]),item.external.id,...args],{...options,endpoint:item.external.endpoint});return this.command(['exec','--user','1000:1000','--workdir','/workspace',...((options.input!==undefined||options.inputFile)?['-i']:[]),prefix+'-worker',...args],options);}
 async runRuntimeInstaller(owner,id,args,options={}){
  const assertCurrent=this.taskLaunchGuard();
  const {item,prefix}=await this.get(owner,id);
  if(item.external)throw new Error('请在原容器中安装运行时，安装完成后点击重新检测');
  assertCurrent(prefix);
  const name=prefix+'-installer-'+randomUUID();const release=this.reserveTask();let closed=false,cancelling;
  const cancel=()=>{
   if(cancelling)return cancelling;
   const pending=waitForTaskCleanup(this,name,prefix,()=>closed,'dingtu-installer').then(release);
   cancelling=pending;void pending.catch(()=>{if(cancelling===pending)cancelling=null;});return pending;
  };
  this.directTasks ||= new Map();this.directTasks.set(name,{prefix,cancel});
  const run=runtimeInstallerArguments({name,prefix,image:item.imageName || LEGACY_IMAGE,args,input:options.input!==undefined});
  run.splice(2,0,'--label','io.kuneco.environment='+prefix);
  try{const result=await this.command(run,{...options,timeout:options.timeout || 600000});assertCurrent(prefix);return result;}
  finally{closed=true;try{await cancel();this.directTasks.delete(name);}catch(error){this.directStopFailures ||= new Set();this.directStopFailures.add(prefix);throw error;}}
 }

 async removeRuntime(owner,id,engine){
  if(!Object.hasOwn(RUNTIME_CATALOG,engine))throw new Error('未知运行时');
  const {item}=await this.get(owner,id);if(item.external)throw new Error('请在原容器中移除运行时后重新检测');
  if(engine==='deepseek'){
   await this.exec(owner,id,['node','-e',"const fs=require('fs');fs.rmSync('/home/node/.config/dingtu-deepseek/credentials.json',{force:true});"]);
  }else{
   const source=await readFile(path.join(this.sourceRoot,'src/features/runtimes/runtime-removal.mjs'),'utf8');
   await this.runRuntimeInstaller(owner,id,['node','--input-type=module','-e',source+'\nawait removeCLIRuntime('+JSON.stringify(engine)+');'],{timeout:150000});
  }
  const registry=await this.runtimeInfo(owner,id,true);
  if(registry.runtimes.some(runtime=>runtime.id===engine))throw new Error('仍检测到此运行时，可能有其他安装副本，请检查安装位置');
  await this.update(owner,id,item=>{const metadata={...item.runtimeMetadata};delete metadata[engine];return {runtimeMetadata:metadata};});return registry;
 }
 async installRuntime(owner,id,engine,configuration={}){
  if(typeof engine!=='string' || !Object.hasOwn(RUNTIME_CATALOG,engine))throw new Error('未知运行时');
  const metadata={};if(configuration.name!==undefined){if(typeof configuration.name!=='string' || !configuration.name.trim() || configuration.name.length>40)throw new Error('运行时名称需为1至40个字符');metadata.name=configuration.name.trim();}
  if(configuration.description!==undefined){if(typeof configuration.description!=='string' || configuration.description.length>500)throw new Error('运行时描述最多500个字符');metadata.description=configuration.description.trim();}
  const saveMetadata=async()=>{await this.update(owner,id,item=>{const previous=item.runtimeMetadata?.[engine];const existing=item.registry?.runtimes?.find(runtime=>runtime.id===engine);const addedAt=previous?.addedAt || existing?.addedAt || (previous || existing?undefined:new Date().toISOString());return {runtimeMetadata:{...item.runtimeMetadata,[engine]:{...previous,...metadata,...(addedAt?{addedAt}:{})}}};});return this.runtimeInfo(owner,id,true);};
  const {item}=await this.get(owner,id);if(item.registry?.runtimes?.some(runtime=>runtime.id===engine))throw new Error('当前环境已添加此运行时，无需重复添加');if(item.external)throw new Error('请在原容器中安装运行时，安装完成后点击重新检测');if(engine==='deepseek'){
  await this.syncDeepSeekSource(owner,id);
  await this.runRuntimeInstaller(owner,id,['node','/home/node/.local/lib/dingtu/deepseek.mjs','configure-install'],{input:JSON.stringify({apiKey:configuration.apiKey,model:configuration.model}),timeout:150000});
  return saveMetadata();
 }if(!RUNTIME_INSTALL_COMMANDS[engine])throw new Error('未知运行时');await this.runRuntimeInstaller(owner,id,['bash','-o','pipefail','-c',RUNTIME_INSTALL_COMMANDS[engine]]);await this.exec(owner,id,[RUNTIME_CATALOG[engine].command,'--version']);return saveMetadata();}
 async directChatSpawner(owner,id){
  const guard=this.taskLaunchGuard();
  const {prefix,item}=await this.get(owner,id);if(item.external){guard(prefix);return this.externalSpawner(owner,id,item,{direct:true,guard});}
  const assertCurrent=()=>guard(prefix);
  assertCurrent();const binary=await this.binary('docker'),image=await workerImage(this,item.imageName || LEGACY_IMAGE);assertCurrent();await ensureDirectNetwork(this,prefix);assertCurrent();
  return ({command,args=[],signal,cwd='/workspace'})=>{
   assertCurrent();if(signal?.aborted)throw new Error('请求已取消');const task=randomUUID();
   const worker=prefix+'-direct-'+task;
   const run=directTaskArguments({prefix,name:worker,image,projectMounts:item.projectMounts || [],task,command,args});
   const release=this.reserveTask();let child;
   try{child=spawn(binary,['--host',this.endpoint,...run],{stdio:['pipe','pipe','pipe'],env:{...process.env,DOCKER_HOST:'',DOCKER_CONTEXT:this.context}});}catch(error){release();throw error;}
   const kill=child.kill.bind(child);let closed=false,cancelling;
   const cancel=()=>{
    if(cancelling)return cancelling;
    const pending=waitForTaskCleanup(this,worker,prefix,()=>closed).then(release);
    cancelling=pending;void pending.catch(()=>{if(cancelling===pending)cancelling=null;});return pending;
   };
   this.directTasks ||= new Map();this.directTasks.set(task,{prefix,cancel});
   const report=error=>{this.directStopFailures ||= new Set();this.directStopFailures.add(prefix);if(!closed && child.listenerCount('error'))child.emit('error',error);console.error('直连任务清理失败：'+error.message);};
   child.once('close',()=>{closed=true;void cancel().then(()=>this.directTasks.delete(task)).catch(report);});
   child.kill=(type='SIGTERM')=>{void cancel().then(()=>kill(type)).catch(report);return true;};
   const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});child.once('close',()=>signal?.removeEventListener('abort',abort));return child;
  };
 }

 async spawner(owner,id){const assertCurrent=this.taskLaunchGuard();const {prefix,item}=await this.get(owner,id);if(item.external)throw new Error('已有容器无法保证全程代理隔离，请使用Kuneco创建的容器进行代理对话，或新建直连对话');assertCurrent(prefix);const binary=await this.binary('docker');const proxy=await this.exec(owner,id,['/usr/local/bin/node','-e',"try{process.stdout.write(require('fs').readFileSync('/tmp/dingtu-chat-proxy','utf8'))}catch{}"]);assertCurrent(prefix);if(!proxy)throw new Error('当前环境代理尚未就绪，无法启动代理任务');const containerId=(await this.command(['inspect','--format','{{.Id}}',prefix+'-worker'])).trim();assertCurrent(prefix);if(!/^[a-f0-9]{64}$/.test(containerId))throw new Error('工作容器标识不可确认');const proxyEnvironment=proxy?['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'].flatMap(key=>['-e',key+'='+proxy]):[];return ({command,args,signal,cwd='/workspace'})=>{
  assertCurrent(prefix);if(signal?.aborted)throw new Error('请求已取消');const task=randomUUID();
  const child=spawn(binary,['--host',this.endpoint,'exec','-i','--user','1000:1000','--workdir','/workspace','-e','LANG=C.UTF-8','-e','LC_ALL=C.UTF-8',...proxyEnvironment,containerId,'/usr/local/bin/node','/opt/dingtu/exec.mjs',task,command,...args],{stdio:['pipe','pipe','pipe'],env:{...process.env,DOCKER_HOST:'',DOCKER_CONTEXT:this.context}});
  trackProxyTask(this,owner,id,prefix,task,child,undefined,{containerId,endpoint:this.endpoint});
  const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});child.once('close',()=>signal?.removeEventListener('abort',abort));return child;
 };}

 async externalSpawner(owner,id,item,{direct=false,guard=this.taskLaunchGuard()}={}){const prefix=resourcePrefix(owner,id);guard(prefix);const binary=await this.binary('docker');await verifyExternalTaskCapabilities(this,item);guard(prefix);return ({command,args=[],signal,cwd='/workspace'})=>{
  guard(prefix);if(signal?.aborted)throw new Error('请求已取消');const token=randomUUID();
  const config=direct?null:item.proxy,environment=direct?['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'].flatMap(key=>['-e',key+'=']).concat(['-e','NO_PROXY=*','-e','no_proxy=*']):[];if(config?.host){const proxy=new URL((config.protocol==='socks5'?'socks5:':config.protocol==='https'?'https:':'http:')+'//'+config.host+':'+config.port);if(config.username){proxy.username=config.username;proxy.password=config.password || '';}for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])environment.push('-e',key+'='+proxy.toString());}
  const child=spawn(binary,['--host',item.external.endpoint,'exec','-i','--workdir',item.external.workingDirectory,'-e','LANG=C.UTF-8','-e','LC_ALL=C.UTF-8',...environment,item.external.id,...externalTaskArguments(token,command,args)],{stdio:['pipe','pipe','pipe']});
  trackProxyTask(this,owner,id,prefix,token,child,externalTaskCancellation(this,item,token),{containerId:item.external.id,endpoint:item.external.endpoint});const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});child.once('close',()=>signal?.removeEventListener('abort',abort));return child;
 };}

}
export class ContainerGateway extends EventEmitter{
 constructor(manager,owner,id,port,token,onVerified){super();Object.assign(this,{manager,owner,id,port,token,onVerified});this.status={state:'blocked',reason:'容器出口未核验'};this.closed=false;this.generation=0;this.syncSequence=0;}
 get address(){return `http://127.0.0.1:${this.port}`;}get url(){return `http://workspace:${this.token}@127.0.0.1:${this.port}`;}
 current(generation){return !this.closed && generation===this.generation;}
 async sync(){
  if(this.closed)return this.status;
  const generation=this.generation,sequence=++this.syncSequence,valid=()=>this.current(generation)&&sequence===this.syncSequence;
  if(this.blocking)await this.blocking;if(!valid()||this.blockFailed)return this.status;
  let status;
  try{status=await this.manager.rpc(this.owner,this.id,'status');}
  catch{
   if(!valid())return this.status;
   let running;try{running=await this.manager.command(['inspect','--format','{{.State.Running}}',resourcePrefix(this.owner,this.id)+'-gateway']);}catch{}
   status=running==='false'?{...this.status,state:'blocked',reason:'容器代理服务已停止'}:{...this.status,controlState:'unavailable',reason:'网关状态暂不可读取；不因监测故障关闭连接'};
  }
  if(!valid())return this.status;
  this.status=status;this.emit('status',this.status);return this.status;
 }
 async verify(){
  const generation=this.generation;if(!this.current(generation))return this.status;
  if(this.blocking)await this.blocking;if(!this.current(generation))return this.status;
  const status=await this.manager.rpc(this.owner,this.id,'verify');
  if(!this.current(generation))return this.status;
  if(status.state==='ready'){
   try{
    await this.onVerified?.(status.ip);if(!this.current(generation))return this.status;
    await this.startWorker({isCurrent:()=>this.current(generation)});
   }catch(error){if(!this.current(generation))return this.status;await this.stop();throw error;}
  }
  if(!this.current(generation))return this.status;this.blockFailed=false;return this.sync();
 }
 async checkNow(){const generation=this.generation;if(!this.current(generation))return this.status;if(this.blocking)await this.blocking;if(!this.current(generation))return this.status;await this.manager.rpc(this.owner,this.id,'verify');if(!this.current(generation))return this.status;this.blockFailed=false;return this.sync();}
 startMonitoring(){
  if(this.closed || this.poll)return;
  this.poll=setInterval(()=>{if(!this.polling){this.polling=true;void this.sync().finally(()=>{this.polling=false;});}},1000);this.poll.unref?.();
 }
 async detectRegion(){const generation=this.generation;if(!this.current(generation))return this.status;await this.manager.rpc(this.owner,this.id,'region');return this.current(generation)?this.sync():this.status;}
 block(reason,options){
  if(this.closed)return;
  const generation=++this.generation;this.status={...this.status,state:'blocked',reason};this.emit('status',this.status);
  // Do not let a status RPC overtake the control operation it is observing.
  this.blocking=Promise.resolve(this.blocking).then(()=>{if(this.current(generation))return this.manager.rpc(this.owner,this.id,'block',{reason,options});}).then(()=>{if(this.current(generation))this.blockFailed=false;}).catch(()=>{if(this.current(generation)){this.blockFailed=true;this.status={...this.status,controlState:'unavailable'};this.emit('status',this.status);}});
 }
 stop({strict=false}={}){
  if(!this.stopping){
   this.closed=true;this.generation++;clearInterval(this.poll);this.poll=null;this.status={...this.status,state:'blocked',reason:'代理已停止'};
   const pending=Promise.resolve(this.blocking).then(()=>this.manager.rpc(this.owner,this.id,'stop'));
   this.stopping=pending;void pending.catch(()=>{if(this.stopping===pending)this.stopping=null;});
  }
  if(!strict)return this.stopping.catch(()=>{});
  return this.stopping.catch(async error=>{
   const container=await inspectContainer(this.manager,resourcePrefix(this.owner,this.id)+'-gateway');
   if(!container || (container.State?.Running===false && container.State?.Restarting!==true))return;
   throw error;
  });
 }
}
