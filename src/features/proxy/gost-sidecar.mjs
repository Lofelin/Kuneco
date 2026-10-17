import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
const execute=promisify(execFile);
export const GOST_VERSION='3.3.0';
export function gostConfig(upstream,port,password,{caFile}={}){
 const auth={username:upstream.username,password:upstream.password};
 return {
  log:{level:'error'},
  services:[{name:'kuneco-private',addr:`127.0.0.1:${port}`,handler:{type:'http',auth:{username:'kuneco',password},chain:'fixed-egress',retries:0},listener:{type:'tcp'}}],
  chains:[{name:'fixed-egress',hops:[{name:'only-upstream',nodes:[{name:'configured-proxy',addr:net.isIP(upstream.host)===6?`[${upstream.host}]:${upstream.port}`:`${upstream.host}:${upstream.port}`,connector:{type:upstream.protocol==='socks5'?'socks5':'http',auth},dialer:{type:upstream.protocol==='https'?'tls':'tcp',...(upstream.protocol==='https'?{tls:{secure:true,serverName:upstream.host,...(caFile?{caFile}:{})}}:{})}}]}]}]
 };
}
export async function startGost(upstream,{binary,ca,onExit=()=>{}}){
 const {stdout}=await execute(binary,['-V'],{timeout:5000});
 if(!new RegExp(`gost (?:v|version )${GOST_VERSION.replaceAll('.','\\.')}(?:\\s|$)`).test(stdout))throw new Error('GOST版本不匹配，请运行安装脚本');
 const directory=await mkdtemp(path.join(tmpdir(),'kuneco-gost-'));
 const reservation=net.createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
 const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const password=randomBytes(32).toString('hex');let child,stopping=false,exited=false;
 const stop=async()=>{
  stopping=true;
  if(child && !exited){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);await ended;clearTimeout(timer);}
  await rm(directory,{recursive:true,force:true});
 };
 try{
  const caFile=ca?path.join(directory,'ca.pem'):undefined;if(caFile)await writeFile(caFile,ca,{mode:0o600});
  const configFile=path.join(directory,'config.json');await writeFile(configFile,JSON.stringify(gostConfig(upstream,port,password,{caFile})),{mode:0o600});
  // Credentials never appear in command-line arguments, inherited environment or logs.
  child=spawn(binary,['-C',configFile],{stdio:'ignore',env:{PATH:process.env.PATH,HOME:directory}});
  let startError;child.once('error',()=>{startError=true;exited=true;});
  child.once('exit',()=>{exited=true;if(!stopping)onExit();});
  let ready=false;
  for(let i=0;i<100;i++){
   if(startError || exited)throw new Error('GOST内核启动失败');
   ready=await new Promise(resolve=>{const socket=net.connect(port,'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>{socket.destroy();resolve(false);});});
   if(ready)break;await new Promise(resolve=>setTimeout(resolve,30));
  }
  if(!ready)throw new Error('GOST内核启动超时');
  return {config:{protocol:'http',host:'127.0.0.1',port,username:'kuneco',password},pid:child.pid,stop};
 }catch(error){await stop();throw error;}
}
