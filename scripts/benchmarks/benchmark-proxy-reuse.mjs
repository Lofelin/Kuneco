// Isolated paired benchmark. Upstream credentials are read from stdin, never argv or reports.
import {ProxyGateway} from '../../src/features/proxy/proxy.mjs';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import {performance} from 'node:perf_hooks';
const local=process.argv.includes('--local');
const binary=process.env.GOST_BINARY || new URL('../../vendor/gost/'+process.platform+'_'+(process.arch==='x64'?'amd64':process.arch)+'/gost',import.meta.url).pathname;
const emit=value=>console.log(JSON.stringify({at:new Date().toISOString(),...value}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const sockets=new Set();let target,upstream,closed=false;const gateways=[];
async function fixture(){
 target=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(req.url==='/exit'?JSON.stringify({ip:'203.0.113.8'}):'x'.repeat(65536));});
 const port=await listen(target);
 upstream=http.createServer();upstream.on('connect',(req,client,head)=>{
  if(req.headers['proxy-authorization']!=='Basic '+Buffer.from('benchmark:private').toString('base64'))return client.end('HTTP/1.1 407 Authentication Required\r\n\r\n');
  const u=new URL('http://'+req.url);if(u.hostname!=='127.0.0.1'||Number(u.port)!==port)return client.destroy();
  const remote=net.connect(port,'127.0.0.1',()=>{client.write('HTTP/1.1 200 OK\r\n\r\n');if(head.length)remote.write(head);client.pipe(remote);remote.pipe(client);});
  for(const s of [remote,client]){sockets.add(s);s.on('error',()=>{client.destroy();remote.destroy();});s.once('close',()=>{sockets.delete(s);client.destroy();remote.destroy();});}
 });
 return {config:{protocol:'http',host:'127.0.0.1',port:await listen(upstream),username:'benchmark',password:'private'},expectedIp:'203.0.113.8',probe:`http://127.0.0.1:${port}/exit`,url:`http://127.0.0.1:${port}/payload`};
}
// Each agent is bound to one gateway and target. Every new socket goes through
// authenticated CONNECT; the agent never has a direct-network fallback.
function makeAgent(gateway,url){
 const u=new URL(url),agent=new http.Agent({keepAlive:true,maxSockets:1,maxFreeSockets:1});
 let serial=0;
 agent.createConnection=(_options,callback)=>{
  let socket,done=false,timer;const start=performance.now(),stamp={};
  const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);if(error)socket?.destroy();callback(error,result);};
  try{gateway.assertOpen();socket=net.connect(gateway.port,'127.0.0.1');}catch(e){finish(e);return;}
  timer=setTimeout(()=>finish(Object.assign(Error('deadline'),{code:'BENCH_TIMEOUT'})),20000);
  socket.once('error',e=>finish(e));
  socket.once('connect',()=>{
   stamp.localTcp=performance.now()-start;let buffer=Buffer.alloc(0);
   const closed=()=>finish(Object.assign(Error('closed'),{code:'BENCH_TUNNEL'}));socket.once('close',closed);
   const data=chunk=>{
    buffer=Buffer.concat([buffer,chunk]);const end=buffer.indexOf('\r\n\r\n');
    if(buffer.length>16384)return finish(Object.assign(Error('headers'),{code:'BENCH_TUNNEL'}));
    if(end<0)return;socket.off('data',data);socket.off('close',closed);
    if(!/^HTTP\/1.1 200 /.test(buffer.toString()))return finish(Object.assign(Error('CONNECT rejected'),{code:'BENCH_TUNNEL'}));
    if(buffer.length>end+4)socket.unshift(buffer.subarray(end+4));
    stamp.tunnel=performance.now()-start-stamp.localTcp;const tlsStart=performance.now();
    const ready=()=>{stamp.tls=performance.now()-tlsStart;socket.benchmark={id:++serial,...stamp};finish(null,socket);};
    if(u.protocol==='https:'){socket=tls.connect({socket,servername:u.hostname});socket.once('error',e=>finish(e));socket.once('secureConnect',ready);}else ready();
   };
   socket.on('data',data);socket.write(`CONNECT ${u.hostname}:${u.port||(u.protocol==='https:'?443:80)} HTTP/1.1\r\nHost: ${u.host}\r\nProxy-Authorization: Basic ${Buffer.from('workspace:'+gateway.token).toString('base64')}\r\n\r\n`);
  });
 };
 return agent;
}
async function measure(gateway,url,agent){
 gateway.assertOpen();const start=performance.now(),u=new URL(url);
 return await new Promise((resolve,reject)=>{
  let socketAt,connection,timer;
  const req=http.request({host:u.hostname,port:u.port||443,path:u.pathname+u.search,headers:{Host:u.host},agent},res=>{
   const responseHeaders=performance.now()-socketAt;let bytes=0,body='';
   res.on('data',c=>{bytes+=c.length;if(!local)body+=c;});res.once('error',reject);res.once('aborted',()=>reject(Object.assign(Error('aborted'),{code:'BENCH_ABORTED'})));
   res.once('end',()=>{
    clearTimeout(timer);
    if(res.statusCode!==200)return reject(Object.assign(Error('status'),{code:'HTTP_'+res.statusCode}));
    if(!local){let ip;try{ip=JSON.parse(body).ip;}catch{}if(ip!==settings.expectedIp){gateway.quarantined=true;gateway.block('Benchmark exit mismatch');return reject(Object.assign(Error('pin'),{code:'EXIT_MISMATCH'}));}}
    const reused=req.reusedSocket,total=performance.now()-start;
    resolve({reused,socketId:connection.id,localTcp:reused?0:connection.localTcp,tunnel:reused?0:connection.tunnel,tls:reused?0:connection.tls,responseHeaders,total,bytes});
   });
  });
  req.once('socket',socket=>{socketAt=performance.now();connection=socket.benchmark;});
  req.once('error',e=>{clearTimeout(timer);reject(e);});
  timer=setTimeout(()=>req.destroy(Object.assign(Error('deadline'),{code:'BENCH_TIMEOUT'})),20000);req.end();
 });
}
const samples=[];
let settings;
async function cleanup(){if(closed)return;closed=true;for(const g of gateways)await g.stop();for(const s of sockets)s.destroy();target?.closeAllConnections();target?.close();upstream?.close();}
process.on('SIGTERM',()=>{void cleanup().then(()=>process.exit(143));});process.on('SIGINT',()=>{void cleanup().then(()=>process.exit(130));});
try{
 if(local)settings=await fixture();else{let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>16384)throw Error('Input too large');}settings=JSON.parse(raw);}
 if(!net.isIP(settings.expectedIp))throw Error('Explicit fixed exit required');
 if(!local){settings.probe='https://api.ipify.org?format=json';settings.url=settings.probe;}
 emit({type:'start',mode:local?'synthetic-loopback':'real-upstream',samplesPerMode:local?40:24,node:process.version,platform:process.platform,arch:process.arch});
 for(const engine of ['native','gost']){const g=await new ProxyGateway(settings.config,{expectedIp:settings.expectedIp,allowLocalTargets:local,gostBinary:engine==='gost'?binary:null,healthInterval:60000,jitter:0.2}).start();gateways.push(g);await g.verify(settings.probe);if(g.status.state!=='ready')throw Error('Initial fixed exit verification failed');g.startMonitoring([settings.probe]);g.on('status',s=>{if(!closed && s.state!=='ready')emit({type:'state',engine,state:s.state,coreState:s.coreState});});}
 if(gateways[0].port===gateways[1].port || gateways[0].token===gateways[1].token)throw Error('Gateway isolation failed');
 const agents=new Map(gateways.map(g=>[g,makeAgent(g,settings.url)]));
 try{
  // Alternating engine and mode order reduces temporal ordering bias.
  for(let i=0;i<(local?40:24);i++){
   for(const g of (i%2?[...gateways].reverse():gateways)){
    for(const mode of (i%2?['reuse','cold']:['cold','reuse'])){
     const agent=mode==='cold'?makeAgent(g,settings.url):agents.get(g);
     try{const result=await measure(g,settings.url,agent);const row={type:'sample',iteration:i,engine:g.status.engine,mode,ok:true,...result};samples.push(row);emit(row);}
     catch(e){const row={type:'sample',iteration:i,engine:g.status.engine,mode,ok:false,code:/^[A-Z0-9_]+$/.test(e.code||'')?e.code:'REQUEST_FAILED'};samples.push(row);emit(row);if(g.quarantined)throw e;}
     finally{if(mode==='cold')agent.destroy();}
    }
   }
  }
  // A stale pooled connection must reconnect through the same gateway.
  for(const g of gateways){const agent=agents.get(g);for(const list of Object.values(agent.freeSockets))for(const socket of list)socket.destroy();await sleep(50);const r=await measure(g,settings.url,agent);emit({type:'reconnect',engine:g.status.engine,...r});if(r.reused)throw Error('Expected new authenticated tunnel');}
  emit({type:'complete',samples});
 }finally{for(const agent of agents.values())agent.destroy();}
}catch(error){emit({type:'fatal',code:error.code||'BENCH_FAILED',message:['Explicit fixed exit required','Initial fixed exit verification failed','Fixed exit/security quarantine; benchmark stopped'].includes(error.message)?error.message:'Benchmark could not complete'});process.exitCode=1;}
finally{await cleanup();}
