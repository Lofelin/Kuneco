import {containerStatus,SPEC_LABEL,validateWorkerFirewall,validateContainerNetworks} from './container-reliability.mjs';
// Return display-safe fields only: never expose Env, labels, mount sources or health logs.
export async function readContainerDisplay(manager,name,endpoint){
 try{
  const format='{"state":{{json .State}},"init":{{json .HostConfig.Init}},"memory":{{json .HostConfig.Memory}},"cpus":{{json .HostConfig.NanoCpus}},"pids":{{json .HostConfig.PidsLimit}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"log":{{json .HostConfig.LogConfig}},"spec":{{json (index .Config.Labels "'+SPEC_LABEL+'")}}}';
  const value=JSON.parse(await manager.command(['inspect','--format',format,name],{endpoint,timeout:5000}));
  const latest=value.state?.Health?.Log?.at(-1);
  const checkedAt=latest?.End && Number.isFinite(Date.parse(latest.End))?new Date(latest.End).toISOString():null;
  return {available:true,healthCheckedAt:checkedAt,healthExitCode:Number.isInteger(latest?.ExitCode)?latest.ExitCode:null,status:containerStatus(value.state).statusText,health:value.state?.Health?.Status || null,init:value.init===true,memory:value.memory,cpus:value.cpus,pids:value.pids,readonly:value.readonly===true,logDriver:value.log?.Type || null,logMaxSize:value.log?.Config?.['max-size'] || null,logMaxFiles:value.log?.Config?.['max-file'] || null,specManaged:Boolean(value.spec)};
 }catch{return {available:false};}
}

// On-demand inspection only: reading this panel never changes networking or reconnects proxies.
export async function readNetworkDisplay(manager,prefix,endpoint){
 try{
  const worker=JSON.parse(await manager.command(['inspect','--format','{{json .}}',prefix+'-worker'],{endpoint,timeout:5000}));
  const network=JSON.parse(await manager.command(['network','inspect','--format','{{json .Internal}}',prefix+'-private'],{endpoint,timeout:5000}));
  let verified=false;
  try{validateContainerNetworks(worker,prefix+'-private');if(network!==true)throw Error();if(!worker.State?.Running)throw Error();await validateWorkerFirewall({command:(args,options)=>manager.command(args,{...options,endpoint})},prefix+'-worker',worker);verified=true;}catch{}
  const tasks=(await manager.command(['ps','-q','--filter','label=app=dingtu-direct','--filter','label=io.kuneco.environment='+prefix],{endpoint,timeout:5000})).split('\n').filter(id=>/^[a-f0-9]+$/.test(id)).length;
  return {available:true,verified,running:worker.State?.Running===true,internal:network===true,bridge:Boolean(worker.NetworkSettings?.Networks?.bridge),directTasks:tasks,checkedAt:new Date().toISOString()};
 }catch{return {available:false};}
}
