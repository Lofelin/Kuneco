// A stopped/deleted immutable container cannot retain an exec process. Never
// infer deletion from an inspect/daemon error alone or resolve a mutable name.
export async function taskContainerStopped(manager,{containerId,endpoint}){
 if(!/^[a-f0-9]{64}$/.test(containerId || ''))throw new Error('任务容器 ID 无效');
 let state;
 try{state=JSON.parse(await manager.command(['inspect','--format','{{json .State}}',containerId],{endpoint}));}
 catch(error){
  const ids=(await manager.command(['ps','-aq','--no-trunc'],{endpoint})).trim().split(/\s+/).filter(Boolean);
  if(!ids.includes(containerId))return true;
  throw error;
 }
 return state?.Running===false&&state?.Restarting!==true;
}
export async function cancelWithContainerFallback(manager,execution,cancel){
 try{return await cancel();}
 catch(error){if(execution&&await taskContainerStopped(manager,execution))return;throw error;}
}
