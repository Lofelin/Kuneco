import {spawn} from 'node:child_process';
import {mkdir,open} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {directRequest,accountServerURL} from '../features/account/account-client.mjs';

export async function backendReady(url){
 let response;
 try{response=await directRequest(new URL('/health',url),{signal:AbortSignal.timeout(1500)});}
 catch(error){if(['ECONNREFUSED','ECONNRESET','ABORT_ERR'].includes(error.code) || error.name==='AbortError')return false;throw error;}
 let data;try{data=JSON.parse(response.data.toString());}catch{}
 if(response.status!==200 || data?.ok!==true || data?.database!=='postgresql')throw new Error('账号服务地址已被其他服务占用或健康检查失败：'+url);
 return true;
}

export async function ensureAccountBackend({root,serverURL=process.env.WORKSPACE_ACCOUNT_SERVER_URL || 'http://localhost:8787',probe=backendReady,launch=launchBackend,timeoutMs=30000,pollMs=250}={}){
 const url=new URL(accountServerURL(serverURL));
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))return {external:true};
 if(await probe(url.href))return {reused:true};
 const processInfo=await launch(root,url);
 const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){
  if(processInfo.error())throw new Error('账号后端启动失败：'+processInfo.error()+'；日志：'+processInfo.logPath);
  if(await probe(url.href))return {started:true,pid:processInfo.pid,logPath:processInfo.logPath};
  await delay(pollMs);
 }
 throw new Error('账号后端启动超时；日志：'+processInfo.logPath);
}

async function launchBackend(root,url){
 const cwd=path.join(root,'backend');
 const binary=path.join(cwd,'bin',process.platform==='win32'?'account-server.exe':'account-server');
 await mkdir(path.dirname(binary),{recursive:true});
 await new Promise((resolve,reject)=>{
  const build=spawn('go',['build','-o',binary,'./cmd/server'],{cwd,stdio:'inherit'});
  build.once('error',reject);build.once('exit',code=>code===0?resolve():reject(new Error('账号后端构建失败（退出码 '+code+'）')));
 });
 // Another desktop launcher may have finished starting the shared service during the build.
 if(await backendReady(url.href))return {error:()=>null,logPath:'',pid:undefined};
 const logPath=path.join(cwd,'data','account-server.log');await mkdir(path.dirname(logPath),{recursive:true});
 const log=await open(logPath,'a',0o600);
 let child,error=null;
 try{child=spawn(binary,[],{cwd,detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,LISTEN_ADDR:(url.hostname==='localhost'?'127.0.0.1':url.hostname)+':'+(url.port || (url.protocol==='https:'?'443':'80'))}});
  child.once('error',err=>{error=err.message;});child.once('exit',(code,signal)=>{error='进程退出 '+(signal || code);});child.unref();
 }finally{await log.close();}
 return {pid:child.pid,logPath,error:()=>error};
}
