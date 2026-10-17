import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

export const SPEC_LABEL='io.kuneco.container-spec';
export const reliabilityArguments=['--init','--log-driver','local','--log-opt','max-size=10m','--log-opt','max-file=3'];
export function specHash(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,20);}
export async function workerImage(manager,baseImage){
 const base=JSON.parse(await manager.command(['image','inspect','--format','{{json .}}',baseImage]));
 const files=['worker.sh','exec.mjs'],contents=await Promise.all(files.map(file=>readFile(path.join(manager.sourceRoot,'docker/runtime',file))));
 const tag='kuneco-worker:'+specHash([base.Id,...contents.map(b=>b.toString())]);
 try{await manager.command(['image','inspect',tag]);return tag;}catch{}
 const dir=await mkdtemp(path.join(tmpdir(),'kuneco-worker-build-'));
 try{
  for(let i=0;i<files.length;i++)await writeFile(path.join(dir,files[i]),contents[i]);
  await writeFile(path.join(dir,'Dockerfile'),`FROM ${base.Id}\nCOPY worker.sh exec.mjs /opt/dingtu/\nRUN chmod 755 /opt/dingtu/worker.sh\n`);
  await manager.command(['build','-t',tag,dir],{timeout:120000});return tag;
 }finally{await rm(dir,{recursive:true,force:true});}
}
export function containerStatus(state){
 if(!state)return {running:false,statusText:'状态不可读取'};
 const common={running:Boolean(state.Running),exitCode:state.ExitCode,oomKilled:Boolean(state.OOMKilled),health:state.Health?.Status || null};
 const statusText=state.OOMKilled?'内存不足退出':state.Restarting?'正在重启':state.Dead?'容器异常':state.Running?(state.Health?.Status==='unhealthy'?'容器自检失败':state.Health?.Status==='starting'?'正在初始化':'运行中'):state.Status==='created'?'尚未启动':state.ExitCode?'异常退出（'+state.ExitCode+'）':'已停止';
 return {...common,statusText};
}
// Replace only an exact owned worker; volumes stay in place and are never removed.
export async function ensureWorker(manager,options){
 manager.workerPreparations ||= new Map();
 const previous=manager.workerPreparations.get(options.name) || Promise.resolve();
 const pending=previous.catch(()=>{}).then(()=>replaceWorker(manager,options));
 manager.workerPreparations.set(options.name,pending);
 try{return await pending;}finally{if(manager.workerPreparations.get(options.name)===pending)manager.workerPreparations.delete(options.name);}
}
async function replaceWorker(manager,{name,image,spec,args,assertCurrent}){
 assertCurrent();const old=await inspectContainer(manager,name);
 assertCurrent();
 if(old){validateContainerNetworks(old,args[args.indexOf('--network')+1],{direct:true});if(old.State?.Running)await validateDirectFirewall(manager,name,old);}
 if(old && old.Config?.Labels?.app!=='dingtu')throw new Error('容器归属不匹配，已停止升级');
 const validate=async()=>{
  assertCurrent();const state=JSON.parse(await manager.command(['inspect','--format','{{json .State}}',name]));assertCurrent();
  if(!state.Running)throw new Error(containerStatus(state).statusText);
  await manager.command(['exec',name,'test','-f','/tmp/kuneco-worker-ready']);assertCurrent();
  const current=await inspectContainer(manager,name);assertCurrent();
  validateContainerNetworks(current,args[args.indexOf('--network')+1],{direct:true});await validateDirectFirewall(manager,name,current);assertCurrent();
 };
 const ready=async()=>{for(let i=0;;i++){try{await validate();return;}catch(error){assertCurrent();if(i===29)throw error;await new Promise(r=>setTimeout(r,100));}}};
 if(old){
  const mounts=old.Mounts || [];
  const expected=args.flatMap((v,i)=>v==='--mount'?[Object.fromEntries(args[i+1].split(',').map(part=>{const n=part.indexOf('=');return [part.slice(0,n),part.slice(n+1)];}))]:[]);
  if(expected.some(e=>!mounts.some(m=>e.type===m.Type&&e.dst===m.Destination&&e.src===(m.Type==='volume'?m.Name:m.Source)&&m.RW!==false)) || mounts.some(m=>!expected.some(e=>e.type===m.Type&&e.dst===m.Destination&&e.src===(m.Type==='volume'?m.Name:m.Source)&&m.RW!==false)))throw new Error('容器挂载与环境配置不一致，保留原容器，请先核对挂载');
 }
 if(old?.Config?.Image===image && old.Config.Labels[SPEC_LABEL]===spec){
  if(!old.State.Running){await manager.command(['start',name]);assertCurrent();}
  await ready();return;
 }
 const attempt=randomUUID();
 const backup=name+'-upgrade-'+Date.now();let renamed=false,created=false,stopped=false;
 try{
  if(old){if(old.State.Running){await manager.command(['stop','-t','5',name]);stopped=true;}assertCurrent();await manager.command(['rename',name,backup]);renamed=true;assertCurrent();}
  // A failed run may have created a container; cleanup requires this attempt label and immutable ID.
  created=true;await manager.command([...args.slice(0,2),'--label',ATTEMPT_LABEL+'='+attempt,...args.slice(2)]);assertCurrent();
  await ready();
 }catch(error){
  if(created)await removeAttemptContainer(manager,name,attempt);
  if(renamed)await manager.command(['rename',backup,name]);
  if(stopped){let current=true;try{assertCurrent();}catch{current=false;}if(old.State.Running&&current)await manager.command(['start',name]);}
  throw error;
 }
 if(renamed)await manager.command(['rm',backup]);
}

// Inspection errors are not proof of absence. Confirm against the daemon before mutation.
export async function inspectContainer(manager,name){
 try{return JSON.parse(await manager.command(['inspect','--format','{{json .}}',name]));}
 catch(error){
  const names=(await manager.command(['ps','-a','--format','{{.Names}}'])).split('\n');
  if(names.includes(name))throw error;
  return null;
 }
}

export const ATTEMPT_LABEL='io.kuneco.creation-attempt';
export function validateContainerNetworks(container,network,{gateway=false,direct=false}={}){
 const attached=Object.keys(container.NetworkSettings?.Networks || {});
 const allowed=gateway || direct?['bridge',network]:[network];
 if(!network || !attached.includes(network) || attached.some(name=>!allowed.includes(name)))throw new Error('容器网络与环境隔离配置不一致，保留原容器，请先核对网络');
 if(gateway && !attached.includes('bridge'))throw new Error('网关缺少预期网络，保留原容器，请先核对网络');
}
export async function ensurePrivateNetwork(manager,name){
 let network;
 try{network=JSON.parse(await manager.command(['network','inspect','--format','{{json .}}',name]));}
 catch(error){
  const names=(await manager.command(['network','ls','--format','{{.Name}}'])).split('\n');
  if(names.includes(name))throw error;
  await manager.command(['network','create','--internal','--label','app=dingtu',name]);
  network=JSON.parse(await manager.command(['network','inspect','--format','{{json .}}',name]));
 }
 if(network?.Internal!==true || network?.Driver!=='bridge' || network?.Labels?.app!=='dingtu')throw new Error('私有网络隔离配置或归属不匹配，已停止启动');
}
export async function removeAttemptContainer(manager,name,attempt){
 const container=await inspectContainer(manager,name);if(!container)return;
 if(!container.Id || container.Config?.Labels?.[ATTEMPT_LABEL]!==attempt)throw new Error('创建失败且同名容器归属无法确认，已保留容器与升级备份，请核对后重试');
 await manager.command(['rm','-f',container.Id]);
}

// Explicit direct chats share the worker but only GID 1001 may bypass proxy egress.
export function validateDirectFirewallRules(ipv4,ipv6,gatewayIP){
 const check=(text,v6)=>{
  const rules=text.trim().split('\n');
  if(!rules.includes('-P OUTPUT DROP') || !rules.includes('-A OUTPUT -m owner --gid-owner 1001 -j ACCEPT'))throw new Error('直连网络的代理隔离规则不完整，已停止复用');
  const allowed=new Set(['-P OUTPUT DROP','-A OUTPUT -o lo -j ACCEPT','-A OUTPUT -m owner --gid-owner 1001 -j ACCEPT']);
  if(!v6){
   allowed.add('-A OUTPUT -p udp -m udp --dport 53 -j REJECT --reject-with icmp-port-unreachable');
   allowed.add('-A OUTPUT -p tcp -m tcp --dport 53 -j REJECT --reject-with icmp-port-unreachable');
   allowed.add('-A OUTPUT -d '+gatewayIP+'/32 -p tcp -m tcp --dport 8080 -j ACCEPT');
  }
  if(rules.some(rule=>!allowed.has(rule)))throw new Error('直连网络存在非预期放行规则，已停止复用');
 };
 check(ipv4,false);check(ipv6,true);
}
async function validateDirectFirewall(manager,name,container){
 if(!container?.NetworkSettings?.Networks?.bridge)return;
 const gatewayIP=container.Config?.Env?.find(value=>value.startsWith('DINGTU_GATEWAY_IP='))?.slice('DINGTU_GATEWAY_IP='.length);
 if(!gatewayIP)throw new Error('缺少代理网关隔离地址');
 const [v4,v6]=await Promise.all(['iptables','ip6tables'].map(binary=>manager.command(['exec','--user','0',name,binary,'-S','OUTPUT'])));
 validateDirectFirewallRules(v4,v6,gatewayIP);
}
