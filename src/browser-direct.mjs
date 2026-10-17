// Authenticated loopback transport; automatic routes are pinned after connection.
import http from 'node:http';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
export async function createBrowserDirectTransport({routeProxy=()=>null,onRouteSelected=()=>{}}={}){
 const token=randomBytes(24).toString('hex'),sockets=new Set(),routes=new Map(),pending=new Map();
 const authorization='Basic '+Buffer.from('workspace:'+token).toString('base64');
 const authorize=(req,socket)=>{if(req.headers['proxy-authorization']===authorization)return true;socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="browser-direct"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');return false;};
 const track=socket=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));return socket;};
 const direct=(host,port)=>new Promise((resolve,reject)=>{const socket=track(net.connect({host:host.replace(/^\[|\]$/g,''),port}));socket.setTimeout(10000,()=>socket.destroy(new Error('Connection timeout')));socket.once('error',reject);socket.once('connect',()=>{socket.setTimeout(0);resolve({socket,head:Buffer.alloc(0)});});});
 const proxied=(proxy,host,port)=>new Promise((resolve,reject)=>{
  const request=http.request({hostname:'127.0.0.1',port:proxy.port,method:'CONNECT',path:host+':'+port,headers:{host:host+':'+port,'proxy-authorization':'Basic '+Buffer.from('workspace:'+proxy.token).toString('base64')},agent:false});
  request.on('socket',track);request.setTimeout(10000,()=>request.destroy(new Error('Proxy timeout')));request.once('error',reject);
  request.once('connect',(response,socket,head)=>{track(socket);if(response.statusCode!==200){socket.destroy();reject(new Error('Proxy connection failed'));return;}socket.setTimeout(0);resolve({socket,head});});request.end();
 });
 async function connect(host,port){
  // Serialize the first choice so parallel resources cannot choose different routes.
  if(pending.has(host))await pending.get(host);
  const chosen=routes.get(host);
  if(chosen==='direct')return direct(host,port);
  if(chosen==='proxy'){const proxy=routeProxy(host);if(!proxy)throw new Error('Selected proxy unavailable');return proxied(proxy,host,port);}
  let unlock;pending.set(host,new Promise(resolve=>unlock=resolve));
  try{
   const proxy=routeProxy(host);
   if(proxy){const connection=await proxied(proxy,host,port);routes.set(host,'proxy');onRouteSelected(host,'proxy');return connection;}
   const connection=await direct(host,port);routes.set(host,'direct');onRouteSelected(host,'direct');return connection;
  }finally{pending.delete(host);unlock();}
 }
 const server=http.createServer(async(req,res)=>{
  if(!authorize(req,req.socket))return;
  let url;try{url=new URL(req.url);if(url.protocol!=='http:' || url.username || url.password)throw new Error();}catch{res.writeHead(400);res.end();return;}
  try{
   const {socket,head}=await connect(url.hostname,Number(url.port)||80);if(req.destroyed || res.destroyed){socket.destroy();return;}if(head.length)socket.unshift(head);
   const headers={...req.headers};delete headers['proxy-authorization'];delete headers['proxy-connection'];
   const agent=new http.Agent();agent.createConnection=()=>socket;
   const upstream=http.request(url,{method:req.method,headers,agent},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
   upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.on('aborted',()=>upstream.destroy());res.on('close',()=>{upstream.destroy();agent.destroy();});req.pipe(upstream);
  }catch{res.writeHead(502);res.end('网站连接失败');}
 });
 server.on('connection',track);
 server.on('connect',async(req,client,head)=>{
  if(!authorize(req,client))return;
  let target;try{target=new URL('http://'+req.url);if(!target.port || target.username || target.password || target.pathname!=='/')throw new Error();}catch{client.end('HTTP/1.1 400 Bad Request\r\n\r\n');return;}
  try{const {socket:remote,head:proxyHead}=await connect(target.hostname,Number(target.port));if(client.destroyed){remote.destroy();return;}
   client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(proxyHead.length)client.write(proxyHead);if(head.length)remote.write(head);client.pipe(remote);remote.pipe(client);client.on('close',()=>remote.destroy());remote.on('close',()=>client.destroy());remote.on('error',()=>client.destroy());
  }catch{client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const port=server.address().port;
 return {getRoute(host){return routes.get(host)||null;},port,token,address:'http://127.0.0.1:'+port,closeConnections(){routes.clear();for(const socket of sockets)socket.destroy();},async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
