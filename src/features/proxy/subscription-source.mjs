import https from 'node:https';
import {isIP} from 'node:net';

export function publicProxyAddress(ip){
 if(isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19));}
 if(isIP(ip)!==6)return false;
 const canonical=new URL('http://['+ip+']/').hostname.slice(1,-1);
 return !/^(::|fc|fd|fe[89ab]|ff)/i.test(canonical);
}
function requestText(options,limit=1024*1024){
 return new Promise((resolve,reject)=>{
  const req=https.get({...options,timeout:20000},res=>{let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>limit){req.destroy();reject(new Error('订阅超过 1 MB 限制'));}else chunks.push(chunk);});res.on('error',()=>reject(new Error('安全下载中断')));res.on('end',()=>resolve({status:res.statusCode,location:res.headers.location,text:Buffer.concat(chunks).toString('utf8')}));});
  req.on('timeout',()=>req.destroy());req.on('error',()=>reject(new Error('安全连接失败，请检查订阅或节点可达性')));
 });
}
export async function proxyDNSRecords(host,type='A'){
 if(typeof host!=='string'||host.length>253||!/^[a-z\d.-]+$/i.test(host))throw new Error('节点域名无效');
 const response=await requestText({hostname:'1.1.1.1',servername:'cloudflare-dns.com',path:'/dns-query?name='+encodeURIComponent(host)+'&type='+type,headers:{host:'cloudflare-dns.com',accept:'application/dns-json'}},65536);
 if(response.status!==200)throw new Error('加密 DNS 引导失败');
 let body;try{body=JSON.parse(response.text);}catch{throw new Error('加密 DNS 响应无效');}
 if(body.Status!==0)throw new Error('节点域名无法通过加密 DNS 解析');
 return body.Answer||[];
}
export async function resolveProxyAddress(host,{records=proxyDNSRecords}={}){
 if(isIP(host)){if(!publicProxyAddress(host))throw new Error('订阅入口必须是公网地址');return host;}
 const answers=await records(host,'A');const ip=answers.find(x=>x.type===1&&publicProxyAddress(x.data))?.data;
 if(!ip)throw new Error('节点没有可用的公网 IP');return ip;
}
export async function fetchProxySubscription(source,{resolve=resolveProxyAddress,request=requestText}={}){
 let url;try{url=new URL(source);}catch{throw new Error('请输入有效的 HTTPS 订阅链接');}
 for(let i=0;i<4;i++){
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port&&url.port!=='443')throw new Error('订阅仅支持不含用户信息的标准 HTTPS 链接');
  const ip=await resolve(url.hostname);if(!publicProxyAddress(ip))throw new Error('订阅入口必须是公网地址');
  const response=await request({hostname:ip,servername:url.hostname,port:443,path:url.pathname+url.search,headers:{host:url.hostname,'user-agent':'ClashMeta/Kuneco','accept':'text/yaml, application/yaml, text/plain, application/json','accept-encoding':'identity'}});
  if([301,302,303,307,308].includes(response.status)&&response.location){try{url=new URL(response.location,url);}catch{throw new Error('订阅跳转无效');}continue;}
  if(response.status!==200)throw new Error('订阅下载失败，请检查链接与套餐状态');
  if(Buffer.byteLength(response.text)>1024*1024)throw new Error('订阅超过 1 MB 限制');return response.text;
 }
 throw new Error('订阅跳转过多');
}
export async function prepareSubscriptionProxy(config,{resolve=resolveProxyAddress,records=proxyDNSRecords}={}){
 if(!config.node)return config;
 const ip=await resolve(config.host);const node={...config.node,server:ip};
 if(node.relay){const r=node.relay;const prepared=await prepareSubscriptionProxy({protocol:r.type,host:r.server,port:r.port,node:r},{resolve,records});node.relay=prepared.node;}
 if(node.tls&&isIP(config.host)===0&&!node.servername)node.servername=config.host;
 if(config.protocol==='hysteria2'&&isIP(config.host)===0&&!node.sni)node.sni=config.host;
 if(node['ech-opts']?.enable&&!node['ech-opts'].config){
  const query=node['ech-opts']['query-server-name']||node.servername||config.host;
  const answers=await records(query,'HTTPS');
  const ech=answers.filter(x=>x.type===65).map(x=>/\bech=(?:"([A-Za-z\d+/=]+)"|([A-Za-z\d+/=]+))/.exec(x.data)).find(Boolean);
  if(!ech)throw new Error('节点 ECH 配置无法通过加密 DNS 获取');
  node['ech-opts']={enable:true,config:ech[1]||ech[2]};
 }
 if(node['ech-opts']?.enable&&node['ech-opts'].config)node['ech-opts']={enable:true,config:node['ech-opts'].config};
 return {...config,host:ip,node};
}
