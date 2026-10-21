import http from 'node:http';
import net from 'node:net';
import {lookup as dnsLookup} from 'node:dns/promises';
import {createHash,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// Only globally routable destinations. DNS is resolved once, checked in full,
// and the resulting IP is passed to connect: no second lookup can rebind it.
export function publicBrowserAddress(address){
 if(net.isIP(address)===4){const [a,b,c]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);}
 if(net.isIP(address)!==6)return false;
 const canonical=new URL('http://['+address+']/').hostname.slice(1,-1);
 return /^[23]/i.test(canonical)&&!/^2001:(?:db8:|0:|:)/i.test(canonical)&&!/^2002:/i.test(canonical);
}
export function browserDestination(host){
 const normalized=String(host).replace(/^\[|\]$/g,'').toLowerCase().replace(/\.$/,'');
 if(net.isIP(normalized)){if(!publicBrowserAddress(normalized))throw Error('Destination blocked');return normalized;}
 if(normalized.length>253||!normalized.includes('.')||!normalized.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))||/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(normalized))throw Error('Destination blocked');
 return normalized;
}
export async function resolveBrowserDestination(host,lookup=dnsLookup){
 const name=browserDestination(host);if(net.isIP(name))return name;
 const answers=await lookup(name,{all:true,verbatim:true});
 if(!answers.length||answers.some(answer=>!publicBrowserAddress(answer.address)))throw Error('Destination blocked');
 return answers.find(answer=>net.isIP(answer.address)===4)?.address||answers[0].address;
}
function sameSecret(actual,expected){return timingSafeEqual(createHash('sha256').update(String(actual||'')).digest(),createHash('sha256').update(expected).digest());}
function authority(host,port){return (net.isIP(host)===6?'['+host+']':host)+':'+port;}
function cleanHeaders(headers){const result={...headers};for(const key of ['proxy-authorization','proxy-connection','connection','keep-alive','upgrade','te','trailer'])delete result[key];result.connection='close';return result;}

export async function createNetworkTransport(configuration,{lookup=dnsLookup,connect=net.createConnection,onRoute=()=>{},listenHost='0.0.0.0',listenPort=8080,connectionTimeout=12000}={}){
 const {mode,token,proxy}=configuration;
 if(!['direct','mixed'].includes(mode)||typeof token!=='string'||token.length<24)throw Error('Invalid transport configuration');
 if(proxy&&(!net.isIP(proxy.ip)||typeof proxy.token!=='string'||!proxy.token))throw Error('Invalid proxy configuration');
 const expected='Basic '+Buffer.from('workspace:'+token).toString('base64'),routes=new Map(),selecting=new Map(),sockets=new Set();let closed=false;
 const track=socket=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));return socket;};
 const tcp=(host,port)=>new Promise((resolve,reject)=>{
  if(closed)return reject(Error('Transport closed'));
  const socket=track(connect({host,port}));const timer=setTimeout(()=>socket.destroy(Error('Connection timeout')),connectionTimeout);
  const fail=()=>{clearTimeout(timer);reject(Error('Connection failed'));};socket.once('error',fail);socket.once('connect',()=>{clearTimeout(timer);socket.removeListener('error',fail);resolve(socket);});
 });
 const openProxy=async(host,port)=>{
  if(!proxy)throw Error('Proxy unavailable');
  const socket=await tcp(proxy.ip,8080);
  return new Promise((resolve,reject)=>{
   let buffer=Buffer.alloc(0),settled=false;
   const done=(error)=>{if(settled)return;settled=true;clearTimeout(timer);socket.removeListener('data',data);socket.removeListener('error',fail);socket.removeListener('end',fail);if(error){socket.destroy();reject(Error('Proxy connection failed'));}else{socket.pause();resolve(socket);}};
   const fail=()=>done(true),timer=setTimeout(fail,connectionTimeout);
   const data=chunk=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length>32768)return fail();const end=buffer.indexOf('\r\n\r\n');if(end<0)return;if(!/^HTTP\/1\.[01] 200(?: |\r\n)/.test(buffer.toString('latin1',0,end+2)))return fail();const extra=buffer.subarray(end+4);if(extra.length)socket.unshift(extra);done(false);};
   socket.on('data',data);socket.once('error',fail);socket.once('end',fail);
   socket.write('CONNECT '+authority(host,port)+' HTTP/1.1\r\nHost: '+authority(host,port)+'\r\nProxy-Authorization: Basic '+Buffer.from('workspace:'+proxy.token).toString('base64')+'\r\n\r\n');
  });
 };
 const establish=async(host,port)=>{
  const name=browserDestination(host);
  // The verified application proxy resolves its own destinations. Local DNS
  // availability must not break proxy routing; only direct connections use
  // local resolution, with address validation and no second lookup.
  const open=async route=>route==='proxy'?openProxy(name,port):tcp(await resolveBrowserDestination(name,lookup),port);
  // Concurrent first requests wait for the same decision, then each opens its
  // own connection. A previously successful route never changes implicitly.
  if(selecting.has(name))await selecting.get(name);
  if(routes.has(name))return {socket:await open(routes.get(name)),route:routes.get(name)};
  let release;const gate=new Promise(resolve=>{release=resolve;});selecting.set(name,gate);
  try{
   let route=mode==='mixed'&&proxy?'proxy':'direct',socket;
   try{socket=await open(route);}catch(error){if(route!=='proxy'||mode!=='mixed')throw error;route='direct';socket=await open(route);}
   if(closed){socket.destroy();throw Error('Transport closed');}
   routes.set(name,route);onRoute({host:name,route});return {socket,route};
  }finally{selecting.delete(name);release();}
 };
 const authenticate=req=>sameSecret(req.headers['proxy-authorization'],expected);
 const server=http.createServer(async(req,res)=>{
  if(!authenticate(req)){res.writeHead(407,{'proxy-authenticate':'Basic realm="Kuneco browser"','connection':'close'});res.end();return;}
  let destination;try{destination=new URL(req.url);if(destination.protocol!=='http:'||destination.username||destination.password)throw Error();browserDestination(destination.hostname);}catch{res.writeHead(403);res.end('Destination blocked');return;}
  req.pause();let outbound;
  try{
   const {socket}=await establish(destination.hostname,Number(destination.port)||80);
   if(req.destroyed||closed){socket.destroy();return;}
   const agent=new http.Agent({keepAlive:false});agent.createConnection=()=>socket;
   outbound=http.request({host:destination.hostname,port:Number(destination.port)||80,method:req.method,path:destination.pathname+destination.search,headers:{...cleanHeaders(req.headers),host:destination.host},agent},response=>{res.writeHead(response.statusCode,cleanHeaders(response.headers));response.pipe(res);response.on('error',()=>res.destroy());});
   outbound.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Connection failed');});
   // All retries and fallback have finished before request headers/body leave.
   req.pipe(outbound);socket.resume();req.resume();
  }catch{res.writeHead(502);res.end('Connection failed');}
  req.once('aborted',()=>outbound?.destroy());res.once('close',()=>outbound?.destroy());
 });
 server.on('connection',track);
 server.on('connect',async(req,client,head)=>{
  if(!authenticate(req)){client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Kuneco browser"\r\nConnection: close\r\n\r\n');return;}
  client.pause();try{
   const target=new URL('http://'+req.url);if(target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw Error();
   const host=browserDestination(target.hostname),port=Number(target.port)||80;if(port<1||port>65535)throw Error();
   const {socket}=await establish(host,port);if(client.destroyed||closed){socket.destroy();return;}
   client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)socket.write(head);
   socket.pipe(client);client.pipe(socket);socket.once('close',()=>client.destroy());client.once('close',()=>socket.destroy());socket.resume();client.resume();
  }catch{client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');}
 });
 server.on('upgrade',async(req,client,head)=>{
  if(!authenticate(req)){client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Kuneco browser"\r\nConnection: close\r\n\r\n');return;}
  client.pause();try{
   const target=new URL(req.url);if(!['http:','ws:'].includes(target.protocol)||target.username||target.password||req.headers.upgrade?.toLowerCase()!=='websocket')throw Error();
   const host=browserDestination(target.hostname),port=Number(target.port)||80,{socket}=await establish(host,port);if(client.destroyed||closed){socket.destroy();return;}
   const headers={...cleanHeaders(req.headers),host:target.host,connection:'Upgrade',upgrade:'websocket'};
   socket.write(req.method+' '+target.pathname+target.search+' HTTP/1.1\r\n'+Object.entries(headers).map(([key,value])=>key+': '+value).join('\r\n')+'\r\n\r\n');
   if(head.length)socket.write(head);socket.pipe(client);client.pipe(socket);socket.once('close',()=>client.destroy());client.once('close',()=>socket.destroy());socket.resume();client.resume();
  }catch{client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');}
 });
 server.on('clientError',(_error,socket)=>socket.destroy());server.requestTimeout=300000;server.headersTimeout=30000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(listenPort,listenHost,resolve);});
 return {server,route:host=>routes.get(String(host).toLowerCase()),close:async()=>{closed=true;for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let input='',started=false,transport;
 const shutdown=()=>{void transport?.close().finally(()=>process.exit(0));if(!transport)process.exit(0);};
 process.stdin.setEncoding('utf8');process.stdin.on('data',async chunk=>{
  if(started)return;input+=chunk;if(input.length>32768){shutdown();return;}const end=input.indexOf('\n');if(end<0)return;started=true;
  try{const config=JSON.parse(input.slice(0,end));input='';transport=await createNetworkTransport(config,{onRoute:route=>process.stdout.write(JSON.stringify({type:'route',...route})+'\n')});process.stdout.write(JSON.stringify({type:'ready'})+'\n');}catch{process.exitCode=1;shutdown();}
 });
 process.stdin.on('end',shutdown);process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);process.stdin.resume();
}
