import {createHash} from 'node:crypto';
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
 if(old && old.Config?.Labels?.app!=='dingtu')throw new Error('容器归属不匹配，已停止升级');
 const validate=async()=>{
  assertCurrent();const state=JSON.parse(await manager.command(['inspect','--format','{{json .State}}',name]));assertCurrent();
  if(!state.Running)throw new Error(containerStatus(state).statusText);
  await manager.command(['exec',name,'test','-f','/tmp/kuneco-worker-ready']);assertCurrent();
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
 const backup=name+'-upgrade-'+Date.now();let renamed=false,created=false,stopped=false;
 try{
  if(old){if(old.State.Running){await manager.command(['stop','-t','5',name]);stopped=true;}assertCurrent();await manager.command(['rename',name,backup]);renamed=true;assertCurrent();}
  // run can create a container before returning an error; cleanup is exact-name only.
  created=true;await manager.command(args);assertCurrent();
  await ready();
 }catch(error){
  if(created)await manager.command(['rm','-f',name]).catch(()=>{});
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
