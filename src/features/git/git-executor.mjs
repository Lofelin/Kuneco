import {spawn} from 'node:child_process';
import {gitOperationsScript,gitOperationPayload} from './git-operations.mjs';
export const GIT_ACTIONS=new Set(['read','identity','keyCreate','keySelect','credentialSave','credentialRemove','test']);
export async function executeGitOperation({action,value,context,execute,launch,executable=process.execPath}){
 if(!GIT_ACTIONS.has(action))throw new Error('未知 Git 操作');
 const input=JSON.stringify(await gitOperationPayload(action,value,context));let output;
 if(execute)output=await execute(['node','-e',gitOperationsScript],{input,timeout:40000,maxBuffer:262144});
 else output=await new Promise((resolve,reject)=>{
  const child=(launch || (options=>spawn(options.command,options.args,{env:options.env,stdio:['pipe','pipe','pipe']})))({command:executable,args:['-e',gitOperationsScript],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
  let stdout='',done=false;const timer=setTimeout(()=>{child.kill();finish(new Error('Git 操作超时'));},40000);
  const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(stdout);};
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>262144){child.kill();finish(new Error('Git 响应过大'));}});child.stderr.on('data',()=>{});
  child.on('error',()=>finish(new Error('无法启动 Git 管理进程')));child.on('close',code=>finish(code===0?null:new Error('Git 管理进程未完成')));child.stdin.on('error',()=>{});child.stdin.end(input);
 });
 let result;try{result=JSON.parse(output);}catch{throw new Error('Git 返回无效数据');}if(result.error)throw new Error(result.error);return result;
}
