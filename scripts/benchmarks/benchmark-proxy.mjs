// Isolated paired benchmark. Upstream credentials are read from stdin, never argv or reports.
import {ProxyGateway} from '../../src/features/proxy/proxy.mjs';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import {readFile,readdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
const local=process.argv.includes('--local');
const duration=Number(process.argv.find(v=>v.startsWith('--seconds='))?.split('=')[1] || 1800);
if(!Number.isFinite(duration)||duration<1||duration>28800)throw Error('Invalid duration');
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
async function measure(gateway,url){
 const start=performance.now(),u=new URL(url),stamp={};let socket,agent;let timer;
 try{
  gateway.assertOpen();
  socket=net.connect(gateway.port,'127.0.0.1');
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{socket?.destroy();reject(Object.assign(Error('deadline'),{code:'BENCH_TIMEOUT'}));},20000);});
  const operation=(async()=>{
   await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});stamp.localTcp=performance.now()-start;
   await new Promise((resolve,reject)=>{
    let buffer=Buffer.alloc(0);const fail=()=>reject(Object.assign(Error('tunnel'),{code:'BENCH_TUNNEL'}));
    const data=chunk=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length>16384)return fail();if(buffer.indexOf('\r\n\r\n')<0)return;socket.off('data',data);socket.off('close',fail);if(!/^HTTP\/1.1 200 /.test(buffer.toString()))return fail();resolve();};
    socket.on('data',data);socket.once('close',fail);socket.once('error',reject);
    socket.write(`CONNECT ${u.hostname}:${u.port||(u.protocol==='https:'?443:80)} HTTP/1.1\r\nHost: ${u.host}\r\nProxy-Authorization: Basic ${Buffer.from('workspace:'+gateway.token).toString('base64')}\r\n\r\n`);
   });stamp.tunnel=performance.now()-start-stamp.localTcp;
   const tlsStart=performance.now();
   if(u.protocol==='https:'){socket=tls.connect({socket,servername:u.hostname});await new Promise((resolve,reject)=>{socket.once('secureConnect',resolve);socket.once('error',reject);});}
   stamp.tls=performance.now()-tlsStart;
   agent=new http.Agent({keepAlive:false});agent.createConnection=()=>socket;
   const requestStart=performance.now();
   const result=await new Promise((resolve,reject)=>{
    const req=http.request({host:u.hostname,path:u.pathname+u.search,headers:{Host:u.host,Connection:'close'},agent},res=>{
     stamp.responseHeaders=performance.now()-requestStart;let bytes=0,body='';res.on('data',c=>{bytes+=c.length;if(!local)body+=c;});res.once('aborted',()=>reject(Object.assign(Error('aborted'),{code:'BENCH_ABORTED'})));res.once('error',reject);res.once('end',()=>resolve({status:res.statusCode,bytes,body}));
    });req.once('error',reject);req.end();
   });stamp.total=performance.now()-start;stamp.body=stamp.total-stamp.localTcp-stamp.tunnel-stamp.tls-stamp.responseHeaders;
   if(result.status!==200)throw Object.assign(Error('status'),{code:'HTTP_'+result.status});
   if(!local){let ip;try{ip=JSON.parse(result.body).ip;}catch{}if(ip!==gateway.status.ip){gateway.quarantined=true;gateway.block('Benchmark detected exit mismatch');throw Object.assign(Error('pin'),{code:'EXIT_MISMATCH'});}}
   return {...stamp,bytes:result.bytes};
  })();return await Promise.race([operation,deadline]);
 }finally{clearTimeout(timer);agent?.destroy();socket?.destroy();}
}
const samples=[];
function stats(rows){const keys=['localTcp','tunnel','tls','responseHeaders','body','total'];return Object.fromEntries(keys.map(k=>{const a=rows.map(x=>x[k]).sort((a,b)=>a-b);return[k,{p50:a[Math.floor((a.length-1)*.5)]??null,p95:a[Math.ceil((a.length-1)*.95)]??null,max:a.at(-1)??null}];}));}
async function resources(g){let rss=null,fd=null,cpuTicks=null;if(g.sidecar)try{const s=await readFile(`/proc/${g.sidecar.pid}/status`,'utf8');rss=Number(s.match(/^VmRSS:\s+(\d+)/m)?.[1])*1024;fd=(await readdir(`/proc/${g.sidecar.pid}/fd`)).length;const stat=(await readFile(`/proc/${g.sidecar.pid}/stat`,'utf8')).split(' ');cpuTicks=Number(stat[13])+Number(stat[14]);}catch{}return{coreFd:fd,coreCpuTicks:cpuTicks,nodeCpu:process.cpuUsage(),gatewaySockets:g.sockets.size,corePid:g.sidecar?.pid||null,coreRss:rss,nodeRss:process.memoryUsage().rss,nodeHeap:process.memoryUsage().heapUsed,coreAttempts:g.coreAttempts};}
async function batch(phase,count,concurrency,order){
 for(const engine of order){const g=gateways.find(g=>g.status.engine===engine),start=performance.now();let next=0;
  await Promise.all(Array.from({length:concurrency},async()=>{while(next++<count){try{samples.push({phase,engine,ok:true,...await measure(g,settings.url)});}catch(e){samples.push({phase,engine,ok:false,code:/^[A-Z0-9_]+$/.test(e.code||'')?e.code:'REQUEST_FAILED'});}}}));
  const rows=samples.filter(x=>x.phase===phase&&x.engine===engine);emit({type:'batch',phase,engine,concurrency,count,elapsedMs:performance.now()-start,success:rows.filter(x=>x.ok).length,failed:rows.filter(x=>!x.ok).length,stats:stats(rows.filter(x=>x.ok)),resources:await resources(g)});
 }
}
let settings;
async function cleanup(){if(closed)return;closed=true;for(const g of gateways)await g.stop();for(const s of sockets)s.destroy();target?.closeAllConnections();target?.close();upstream?.close();}
process.on('SIGTERM',()=>{void cleanup().then(()=>process.exit(143));});process.on('SIGINT',()=>{void cleanup().then(()=>process.exit(130));});
try{
 if(local)settings=await fixture();else{let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>16384)throw Error('Input too large');}settings=JSON.parse(raw);}
 if(!net.isIP(settings.expectedIp))throw Error('Explicit fixed exit required');
 if(!local){settings.probe='https://api.ipify.org?format=json';settings.url=settings.probe;}
 emit({type:'start',mode:local?'synthetic-loopback':'real-upstream',durationSeconds:duration,node:process.version,platform:process.platform,arch:process.arch});
 for(const engine of ['native','gost']){const g=await new ProxyGateway(settings.config,{expectedIp:settings.expectedIp,allowLocalTargets:local,gostBinary:engine==='gost'?binary:null,healthInterval:60000,jitter:0.2}).start();gateways.push(g);await g.verify(settings.probe);if(g.status.state!=='ready')throw Error('Initial fixed exit verification failed');g.startMonitoring([settings.probe]);g.on('status',s=>{if(!closed && s.state!=='ready')emit({type:'state',engine,state:s.state,coreState:s.coreState});});}
 if(gateways[0].port===gateways[1].port || gateways[0].token===gateways[1].token)throw Error('Gateway isolation failed');
 await batch('warmup',local?10:2,1,['native','gost']);
 await batch('serial',local?100:8,1,['gost','native']);
 await batch('concurrent',local?200:8,local?8:4,['native','gost']);
 const started=Date.now();let iteration=0;
 while(Date.now()-started<duration*1000){
  await batch('soak',1,1,iteration++%2?['gost','native']:['native','gost']);
  if(gateways.some(g=>g.quarantined))throw Error('Fixed exit/security quarantine; benchmark stopped');
  await sleep(Math.max(0,Math.min(local?1000:30000,duration*1000-(Date.now()-started))));
 }
 emit({type:'complete',soakElapsedSeconds:(Date.now()-started)/1000,iterations:iteration,samples});
}catch(error){emit({type:'fatal',code:error.code||'BENCH_FAILED',message:['Explicit fixed exit required','Initial fixed exit verification failed','Fixed exit/security quarantine; benchmark stopped'].includes(error.message)?error.message:'Benchmark could not complete'});process.exitCode=1;}
finally{await cleanup();}
