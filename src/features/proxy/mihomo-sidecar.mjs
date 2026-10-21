import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
const execute=promisify(execFile);
export const MIHOMO_VERSION='1.19.32';
const fields={
 vless:['uuid','flow','tls','servername','network','client-fingerprint','reality-opts','ws-opts','grpc-opts','http-opts','h2-opts','packet-encoding','alpn','ech-opts','udp','fingerprint'],
 hysteria2:['tls','client-fingerprint','password','sni','obfs','obfs-password','up','down','alpn','fingerprint','ports','hop-interval'],
 ss:['cipher','password','udp','udp-over-tcp','udp-over-tcp-version']
};
const nested={
 'reality-opts':['public-key','short-id'],
 'ech-opts':['enable','config'],
 'ws-opts':['path','headers','max-early-data','early-data-header-name','v2ray-http-upgrade','v2ray-http-upgrade-fast-open'],
 'grpc-opts':['grpc-service-name'],
 'http-opts':['method','path','headers'],
 'h2-opts':['host','path']
};
function checkedNode(upstream){
 if(!Object.hasOwn(fields,upstream?.protocol))throw new Error('不支持的订阅节点协议');
 const node=upstream.node;
 if(!node || node.type!==upstream.protocol || !net.isIP(node.server) || node.server!==upstream.host || !Number.isInteger(node.port) || node.port<1 || node.port>65535 || node.port!==upstream.port)throw new Error('订阅节点地址无效或尚未解析');
 if(node.type==='hysteria2'&&node.tls===false)throw new Error('Hysteria2 必须验证 TLS');
 const allowed=new Set(['name','type','server','port','udp','tfo','ip-version','relay',...fields[node.type]]);
 for(const key of Object.keys(node))if(!allowed.has(key))throw new Error('订阅节点包含不允许的配置');
 for(const [key,keys] of Object.entries(nested))if(node[key]!==undefined){
  if(!node[key] || typeof node[key]!=='object' || Array.isArray(node[key]) || Object.keys(node[key]).some(item=>!keys.includes(item)))throw new Error('订阅节点传输配置无效');
 }
 if(node['ech-opts']?.enable && (typeof node['ech-opts'].config!=='string'||!node['ech-opts'].config||!/^[A-Za-z0-9+/]+=*$/.test(node['ech-opts'].config)))throw new Error('ECH配置须先通过加密DNS解析');
 // Round-trip strips prototypes; user-supplied names never become rule targets.
 const {relay,...selected}=JSON.parse(JSON.stringify(node));
 if(relay){
  if(!['hysteria2','ss'].includes(node.type)||relay.type!=='vless'||relay.tls!==true||relay.relay)throw new Error('前置节点配置无效');
  checkedNode({protocol:relay.type,host:relay.server,port:relay.port,node:relay});
 }
 return {...selected,name:'kuneco-selected'};
}
export function mihomoConfig(upstream,port,password){
 if(!Number.isInteger(port)||port<1||port>65535||typeof password!=='string'||!password||password.includes(':')||/[\r\n]/.test(password))throw new Error('本地代理监听配置无效');
 const selected=checkedNode(upstream),proxies=[selected];
 if(upstream.node.relay){const r=upstream.node.relay;const relay=checkedNode({protocol:r.type,host:r.server,port:r.port,node:r});relay.name='kuneco-relay';selected['dialer-proxy']=relay.name;proxies.push(relay);}
 return {
  port,'socks-port':0,'mixed-port':0,'redir-port':0,'tproxy-port':0,
  'allow-lan':false,'bind-address':'127.0.0.1',authentication:[`kuneco:${password}`],'skip-auth-prefixes':[],
  mode:'rule','log-level':'silent',ipv6:false,'external-controller':'','external-controller-unix':'','external-controller-pipe':'',
  'geodata-mode':false,'geo-auto-update':false,'find-process-mode':'off',
  profile:{'store-selected':false,'store-fake-ip':false},
  tun:{enable:false},sniffer:{enable:false},dns:{enable:false},
  proxies,'proxy-groups':[],'proxy-providers':{},'rule-providers':{},rules:['MATCH,kuneco-selected']
 };
}
export async function startMihomo(upstream,{binary,onExit=()=>{}}){
 const {stdout}=await execute(binary,['-v'],{timeout:5000,maxBuffer:64*1024,env:{PATH:process.env.PATH}});
 if(!new RegExp(`Mihomo Meta v${MIHOMO_VERSION.replaceAll('.','\\.')}\\b`,'i').test(stdout))throw new Error('Mihomo版本不匹配，请运行安装脚本');
 // Validate before allocating resources, including when the caller bypasses the importer.
 checkedNode(upstream);
 const directory=await mkdtemp(path.join(tmpdir(),'kuneco-mihomo-'));
 let child,stopping=false,exited=false,stopPromise;
 const stop=()=>stopPromise??=(async()=>{
  stopping=true;
  if(child&&!exited){
   const ended=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');
   const timer=setTimeout(()=>child.kill('SIGKILL'),2000);await ended;clearTimeout(timer);
  }
  await rm(directory,{recursive:true,force:true});
 })();
 try{
  const reservation=net.createServer();
  await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const password=randomBytes(32).toString('hex');
  const file=path.join(directory,'config.json');await writeFile(file,JSON.stringify(mihomoConfig(upstream,port,password)),{mode:0o600});
  // Private temporary directory and explicit minimal environment keep secrets out of argv and logs.
  child=spawn(binary,['-d',directory,'-f',file],{stdio:'ignore',env:{PATH:process.env.PATH,HOME:directory}});
  let startError=false;
  child.once('error',()=>{startError=true;exited=true;});
  child.once('exit',()=>{exited=true;if(!stopping){void rm(directory,{recursive:true,force:true});onExit();}});
  let ready=false;
  for(let i=0;i<150;i++){
   if(startError||exited)throw new Error('Mihomo内核启动失败');
   ready=await new Promise(resolve=>{const socket=net.connect(port,'127.0.0.1');socket.setTimeout(100);const finish=value=>{socket.destroy();resolve(value);};socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(false));});
   if(ready)break;await new Promise(resolve=>setTimeout(resolve,30));
  }
  if(!ready||exited)throw new Error('Mihomo内核启动超时');
  return {config:{protocol:'http',host:'127.0.0.1',port,username:'kuneco',password},pid:child.pid,stop};
 }catch(error){await stop();throw error;}
}
