import {spawn} from 'node:child_process';
import {proxyEnvironment} from '../proxy/proxy.mjs';
export const chatRuntimeEnvironment=base=>({...base,LANG:'C.UTF-8',LC_ALL:'C.UTF-8'});
export const chatNetworkMode=item=>['direct','auto'].includes(item?.networkMode)?item.networkMode:'proxy';
export const chatRequestRoute=(item,status)=>chatNetworkMode(item)==='direct'?'direct':'proxy';
export function directChatEnvironment(base){
 const env=chatRuntimeEnvironment(proxyEnvironment(base,''));
 for(const key of Object.keys(env))if(/^(https?_proxy|all_proxy|no_proxy)$/i.test(key))delete env[key];
 env.NO_PROXY='*';env.no_proxy='*';return env;
}
export function createDirectChatSpawner(canStart=()=>true){
 return ({command,args=[],cwd,env,signal})=>{
  if(!canStart() || signal?.aborted)throw new Error('对话已停止或环境不可用');
  return spawn(command,args,{cwd,env:directChatEnvironment(env || process.env),signal,stdio:['pipe','pipe','pipe']});
 };
}
