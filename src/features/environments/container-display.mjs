import {containerStatus,SPEC_LABEL} from './container-reliability.mjs';
// Return display-safe fields only: never expose Env, labels, mount sources or health logs.
export async function readContainerDisplay(manager,name,endpoint){
 try{
  const format='{"state":{{json .State}},"init":{{json .HostConfig.Init}},"memory":{{json .HostConfig.Memory}},"cpus":{{json .HostConfig.NanoCpus}},"pids":{{json .HostConfig.PidsLimit}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"log":{{json .HostConfig.LogConfig}},"spec":{{json (index .Config.Labels "'+SPEC_LABEL+'")}}}';
  const value=JSON.parse(await manager.command(['inspect','--format',format,name],{endpoint,timeout:5000}));
  return {available:true,status:containerStatus(value.state).statusText,health:value.state?.Health?.Status || null,init:value.init===true,memory:value.memory,cpus:value.cpus,pids:value.pids,readonly:value.readonly===true,logDriver:value.log?.Type || null,logMaxSize:value.log?.Config?.['max-size'] || null,logMaxFiles:value.log?.Config?.['max-file'] || null,specManaged:Boolean(value.spec)};
 }catch{return {available:false};}
}
