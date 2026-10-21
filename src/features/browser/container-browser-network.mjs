import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import net from 'node:net';
import {resourcePrefix} from '../environments/docker-environments.mjs';

const ROLE='kuneco-browser-transport',INSTANCE='io.kuneco.browser.transport-instance';
function owned(item,prefix){return item?.Config?.Labels?.app===ROLE&&item.Config.Labels['io.kuneco.environment']===prefix;}
async function inspect(manager,name){
 try{return JSON.parse(await manager.command(['inspect','--format','{{json .}}',name]));}
 catch(error){const names=(await manager.command(['ps','-a','--format','{{.Names}}'])).split('\n');if(names.includes(name))throw error;return null;}
}
export function browserTransportArguments({prefix,image,instance}){
 return ['run','-d','--name',prefix+'-browser-transport','--label','app='+ROLE,'--label','io.kuneco.environment='+prefix,'--label',INSTANCE+'='+instance,
 '--hostname','browser-network','--network',prefix+'-browser-egress','--user','1000:1000','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
 '--pids-limit','64','--memory','128m','--cpus','0.5','--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=8m','--entrypoint','node',image,'-e','setInterval(()=>{},2147483647)'];
}
export class ContainerBrowserNetwork {
 constructor(manager,{spawnProcess=spawn}={}){this.manager=manager;this.spawnProcess=spawnProcess;this.instance=randomUUID();this.routes=new Map();this.stopped=false;this.closing=false;}
 async start({owner,environmentId,mode,image,proxy=null,assertCurrent=()=>{},onRouteSelected=()=>{},onClosed=()=>{}}){
  if(!['direct','proxy','mixed'].includes(mode))throw Error('浏览器网络模式无效');
  if(proxy&&(!net.isIP(proxy.ip)||!proxy.token))throw Error('浏览器代理未就绪');
  Object.assign(this,{mode,proxy,onRouteSelected,onClosed});this.assertCurrent=()=>{if(this.stopped)throw Error('浏览器网络转发已关闭');assertCurrent();};this.prefix=resourcePrefix(owner,environmentId);this.name=this.prefix+'-browser-transport';this.egressName=this.prefix+'-browser-egress';
  assertCurrent();
  if(mode==='proxy'){if(!proxy)throw Error('环境代理未就绪');this.gatewayIP=proxy.ip;this.token=proxy.token;return this;}
  if(typeof image!=='string'||!image)throw Error('浏览器镜像未就绪');
  this.token=randomBytes(32).toString('base64url');
  // The manager-level queue also covers creation from separate engine objects.
  this.manager.browserTransportPreparations ||= new Map();const previous=this.manager.browserTransportPreparations.get(this.prefix)||Promise.resolve();
  const operation=previous.catch(()=>{}).then(()=>this.prepare(image));this.manager.browserTransportPreparations.set(this.prefix,operation);
  try{await operation;return this;}catch(error){await this.close();throw error;}finally{if(this.manager.browserTransportPreparations.get(this.prefix)===operation)this.manager.browserTransportPreparations.delete(this.prefix);}
 }
 async prepare(image){
  const {manager,prefix,egressName,assertCurrent}=this;assertCurrent();
  const internal=JSON.parse(await manager.command(['network','inspect','--format','{{json .}}',prefix+'-private']));
  if(internal.Driver!=='bridge'||internal.Internal!==true||internal.Labels?.app!=='dingtu')throw Error('环境私有网络归属或隔离配置不匹配');
  let egress;
  try{egress=JSON.parse(await manager.command(['network','inspect','--format','{{json .}}',egressName]));}
  catch(error){if((await manager.command(['network','ls','--format','{{.Name}}'])).split('\n').includes(egressName))throw error;assertCurrent();await manager.command(['network','create','--driver','bridge','--label','app='+ROLE,'--label','io.kuneco.environment='+prefix,egressName]);egress=JSON.parse(await manager.command(['network','inspect','--format','{{json .}}',egressName]));}
  if(egress.Driver!=='bridge'||egress.Internal||egress.Labels?.app!==ROLE||egress.Labels?.['io.kuneco.environment']!==prefix)throw Error('浏览器出口网络归属不匹配');
  if(Object.values(egress.Containers||{}).some(container=>container.Name!==this.name))throw Error('浏览器出口网络被其他容器引用，已停止启动');
  assertCurrent();const old=await inspect(manager,this.name);assertCurrent();
  if(old){
   const networks=Object.keys(old.NetworkSettings?.Networks||{});
   if(!owned(old,prefix)||old.Mounts?.some(m=>m.Type!=='tmpfs')||networks.some(name=>![prefix+'-private',egressName].includes(name))||old.HostConfig?.Privileged||Object.keys(old.HostConfig?.PortBindings||{}).length)throw Error('浏览器转发容器归属或隔离配置不匹配');
   await manager.command(['stop','-t','3',old.Id||this.name]);assertCurrent();await manager.command(['rm',old.Id||this.name]);assertCurrent();
  }
  await manager.command(browserTransportArguments({prefix,image,instance:this.instance}));assertCurrent();
  await manager.command(['network','connect',prefix+'-private',this.name]);assertCurrent();
  const current=await inspect(manager,this.name);assertCurrent();
  if(!owned(current,prefix)||current.Config.Labels[INSTANCE]!==this.instance)throw Error('浏览器转发容器实例已变化');
  this.containerId=current.Id;this.gatewayIP=current.NetworkSettings?.Networks?.[prefix+'-private']?.IPAddress;
  if(net.isIP(this.gatewayIP)!==4)throw Error('浏览器转发地址未就绪');
  const binary=await manager.binary('docker');assertCurrent();
  const child=this.child=this.spawnProcess(binary,['--host',manager.endpoint,'exec','-i','--user','1000:1000',this.containerId||this.name,'node','/opt/kuneco/network-transport.mjs'],{cwd:manager.sourceRoot,stdio:['pipe','pipe','pipe'],env:{...process.env,DOCKER_HOST:'',DOCKER_CONTEXT:manager.context}});
  child.stdin.on('error',()=>{});child.stderr.resume();
  await new Promise((resolve,reject)=>{
   let buffer='',ready=false;const timer=setTimeout(()=>reject(Error('浏览器网络转发启动超时')),20000);
   const failed=()=>{clearTimeout(timer);this.stopped=true;if(!ready)reject(Error('浏览器网络转发已断开'));if(!this.closing){try{this.onClosed();}catch{}}};
   child.once('error',failed);child.once('close',()=>{if(!this.stopped)failed();});
   child.stdout.on('data',chunk=>{
    buffer+=chunk;if(buffer.length>65536){child.kill();return;}let end;
    while((end=buffer.indexOf('\n'))>=0){let message;try{message=JSON.parse(buffer.slice(0,end));}catch{}buffer=buffer.slice(end+1);
     if(message?.type==='ready'&&!ready){ready=true;clearTimeout(timer);resolve();}
     else if(message?.type==='route'&&typeof message.host==='string'&&['direct','proxy'].includes(message.route)){this.routes.set(message.host,message.route);try{this.onRouteSelected({host:message.host,route:message.route});}catch{}}
    }
   });
   child.stdin.write(JSON.stringify({mode:this.mode,token:this.token,proxy:this.mode==='mixed'?this.proxy:null})+'\n');
  });assertCurrent();
 }
 route(host){return this.mode==='proxy'?'proxy':this.routes.get(String(host).toLowerCase().replace(/\.$/,''));}
 async close(){
  if(this.closing)return;this.closing=true;this.stopped=true;this.child?.stdin.end();
  if(this.child){const child=this.child;await Promise.race([new Promise(resolve=>child.once('close',resolve)),new Promise(resolve=>setTimeout(resolve,1000))]);child.kill();}
  if(!this.prefix||this.mode==='proxy')return;
  try{const item=await inspect(this.manager,this.name);if(!owned(item,this.prefix)||item.Config.Labels[INSTANCE]!==this.instance)return;
   const id=item.Id||this.name;await this.manager.command(['stop','-t','3',id]);await this.manager.command(['rm',id]);
   const egress=JSON.parse(await this.manager.command(['network','inspect','--format','{{json .}}',this.egressName]));
   if(egress.Labels?.app===ROLE&&egress.Labels?.['io.kuneco.environment']===this.prefix&&!Object.keys(egress.Containers||{}).length)await this.manager.command(['network','rm',this.egressName]);
  }catch{}
 }
}
export async function createContainerBrowserNetwork(manager,options){return new ContainerBrowserNetwork(manager).start(options);}
