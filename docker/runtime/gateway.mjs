import http from 'node:http';
import {ProxyGateway} from './proxy.mjs';
let gateway;
let generation=0,mutations=Promise.resolve(),closing=false;
const superseded=()=>new Error('代理控制操作已失效');
function enqueue(operation){
 const result=mutations.then(operation);
 mutations=result.catch(()=>{});
 return result;
}
async function control(action,value={}){
 if(action==='status')return gateway?.status || {state:'blocked',reason:'代理未连接'};
 if(closing)throw superseded();
 if(action==='connect'){
  if(!['native','gost'].includes(value.engine || 'native'))throw new Error('未知代理内核');
  const ticket=++generation;
  return enqueue(async()=>{
   if(ticket!==generation)throw superseded();
   await gateway?.stop();
   if(ticket!==generation)throw superseded();
   const candidate=new ProxyGateway(value.config,{gostBinary:value.engine==='gost'?'/usr/local/bin/gost':null,listenHost:'0.0.0.0',listenPort:8080,expectedIp:value.expectedIp,healthInterval:60000,jitter:0.2});
   gateway=candidate;
   try{
    await candidate.start();
    if(ticket!==generation)throw superseded();
    return {token:candidate.token};
   }catch(error){await candidate.stop();throw error;}
  });
 }
 if(action==='stop' || action==='block'){
  ++generation;
  // Invalidate in-flight verification immediately; startup is drained before
  // final cleanup, so a late listener cannot survive a successful stop.
  gateway?.block(value.reason,value.options);
  return enqueue(async()=>{
   if(action==='stop')await gateway?.stop();
   else gateway?.block(value.reason,value.options);
   return true;
  });
 }
 if(action==='verify' || action==='region'){
  const ticket=generation;
  await mutations;
  if(ticket!==generation || closing)throw superseded();
  const current=gateway;
  if(!current)throw new Error('请先连接代理');
  const result=action==='verify'?await current.verify():await current.detectRegion();
  if(ticket!==generation || current!==gateway || closing)throw superseded();
  if(action==='verify'){current.serviceProbes=true;current.startMonitoring();return result;}
  return current.status;
 }
 throw new Error('未知操作');
}
const server=http.createServer(async(req,res)=>{
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536){res.writeHead(413,{connection:'close'});res.end();return;}}
  const {action,value}=JSON.parse(raw);const result=await control(action,value);
  res.setHeader('content-type','application/json');res.end(JSON.stringify(result));
 }catch{if(res.destroyed)return;if(res.headersSent){res.destroy();return;}res.writeHead(500);res.end(JSON.stringify({error:'容器代理操作失败，请检查代理配置与出口'}));}
});
server.listen(9091,'127.0.0.1');
process.on('SIGTERM',()=>{
 if(closing)return;
 closing=true;++generation;
 gateway?.block('代理已停止');
 server.close();server.closeIdleConnections();
 enqueue(()=>gateway?.stop()).catch(()=>{process.exitCode=1;});
});
