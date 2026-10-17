// A switched environment remains selected even if its saved proxy is unavailable.
export async function connectEnvironmentProxy(config,{connect,block}){
 if(!config?.host){
  const result={state:'unconfigured',reason:'当前环境尚未配置代理'};
  await block(result.reason);return result;
 }
 try{
  const status=await connect({...config});
  if(status?.state!=='ready')throw new Error(status?.reason || '出口核验未通过');
  return {state:'ready',reason:'已自动连接该环境保存的代理'};
 }catch(error){
  const result={state:'blocked',reason:'当前环境代理自动连接失败：'+error.message};
  await block(result.reason);return result;
 }
}

export async function restoreSelectedEnvironment({owner,id,localEnabled,ensureEngine,activate,connectProxy}){
 if(!owner || (!id && !localEnabled))return {state:'skipped'};
 await ensureEngine(owner,id);
 await activate(owner,id);
 return connectProxy();
}
