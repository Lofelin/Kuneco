import http from 'node:http';
import {ProxyGateway} from './proxy.mjs';
let gateway;
const server=http.createServer(async(req,res)=>{
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536){res.writeHead(413,{connection:'close'});res.end();return;}}
  const {action,value}=JSON.parse(raw);let result;
  if(action==='connect'){
   await gateway?.stop();
   if(!['native','gost'].includes(value.engine || 'native'))throw new Error('未知代理内核');
   gateway=await new ProxyGateway(value.config,{gostBinary:value.engine==='gost'?'/usr/local/bin/gost':null,listenHost:'0.0.0.0',listenPort:8080,expectedIp:value.expectedIp,healthInterval:60000,jitter:0.2}).start();
   result={token:gateway.token};
  }else if(action==='status')result=gateway?.status || {state:'blocked',reason:'代理未连接'};
  else if(action==='verify'){if(!gateway)throw new Error('请先连接代理');result=await gateway.verify();gateway.serviceProbes=true;gateway.startMonitoring();}
  else if(action==='region'){await gateway.detectRegion();result=gateway.status;}
  else if(action==='block'){gateway?.block(value.reason,value.options);result=true;}
  else if(action==='stop'){await gateway?.stop();result=true;}
  else throw new Error('未知操作');
  res.setHeader('content-type','application/json');res.end(JSON.stringify(result));
 }catch{if(res.destroyed)return;if(res.headersSent){res.destroy();return;}res.writeHead(500);res.end(JSON.stringify({error:'容器代理操作失败，请检查代理配置与出口'}));}
});
server.listen(9091,'127.0.0.1');
process.on('SIGTERM',async()=>{await gateway?.stop();server.close();});
