import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {publicBrowserAddress,browserDestination,resolveBrowserDestination,createNetworkTransport} from '../../../docker/browser/network-transport.mjs';
import {browserTransportArguments,ContainerBrowserNetwork} from '../../../src/features/browser/container-browser-network.mjs';
const token='unit-browser-token-with-at-least-24-characters';
const authorization='Basic '+Buffer.from('workspace:'+token).toString('base64');
const listen=server=>new Promise(resolve=>{server.testSockets=new Set();server.on('connection',socket=>{server.testSockets.add(socket);socket.once('close',()=>server.testSockets.delete(socket));});server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
const stop=server=>new Promise(resolve=>{for(const socket of server.testSockets||[])socket.destroy();server.closeAllConnections?.();server.close(resolve);});
function request(port,{method='GET',path='http://example.com/path',body,auth=authorization}={}){
 return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path,method,headers:{...(auth?{'proxy-authorization':auth}:{}),...(body?{'content-length':Buffer.byteLength(body)}:{})}},res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);req.end(body);});
}
function connector(targetPort,{proxyPort,onConnect=()=>{}}={}){return options=>{onConnect(options);return net.createConnection({host:'127.0.0.1',port:options.host==='172.20.0.2'?proxyPort:targetPort});};}
const publicDNS=async()=>[{address:'93.184.216.34',family:4}];

test('destination checks reject private, mapped, local and metadata addresses before DNS',async()=>{
 for(const address of ['127.0.0.1','10.0.0.1','172.19.0.1','169.254.169.254','192.168.0.1','100.64.0.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2002:7f00:1::1','2001:db8::1'])assert.equal(publicBrowserAddress(address),false,address);
 for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(publicBrowserAddress(address),true,address);
 for(const name of ['localhost','host.docker.internal','service.local','metadata','evil.invalid','foo..example.com'])assert.throws(()=>browserDestination(name));
 await assert.rejects(resolveBrowserDestination('example.com',async()=>[{address:'8.8.8.8'},{address:'10.0.0.1'}]),/blocked/);
 assert.equal(await resolveBrowserDestination('example.com',publicDNS),'93.184.216.34');
});
test('direct HTTP uses checked IP and never forwards transport authentication to website',async()=>{
 let seen;const target=http.createServer((req,res)=>{seen={url:req.url,host:req.headers.host,auth:req.headers['proxy-authorization']};res.end('direct works');}),port=await listen(target),connections=[];
 const transport=await createNetworkTransport({mode:'direct',token},{lookup:publicDNS,connect:connector(port,{onConnect:args=>connections.push(args)}),listenHost:'127.0.0.1',listenPort:0});
 try{const result=await request(transport.server.address().port);assert.deepEqual(result,{status:200,text:'direct works'});assert.deepEqual(seen,{url:'/path',host:'example.com',auth:undefined});assert.equal(connections[0].host,'93.184.216.34');assert.equal(transport.route('example.com'),'direct');}
 finally{await transport.close();await stop(target);}
});
test('unauthenticated and private DNS requests are blocked without opening outbound sockets',async()=>{
 let opened=0;const transport=await createNetworkTransport({mode:'direct',token},{lookup:async()=>[{address:'10.0.0.1'}],connect:()=>{opened++;throw Error();},listenHost:'127.0.0.1',listenPort:0});
 try{const port=transport.server.address().port;assert.equal((await request(port,{auth:null})).status,407);assert.equal((await request(port)).status,502);assert.equal((await request(port,{path:'http://169.254.169.254/'})).status,403);assert.equal(opened,0);}
 finally{await transport.close();}
});
test('mixed fallback completes before HTTP POST and pins successful direct route',async()=>{
 let posts=0,bodies=[],proxyAttempts=0;
 const target=http.createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{posts++;bodies.push(body);res.end('saved');});}),port=await listen(target);
 const failed=net.createServer(socket=>{proxyAttempts++;socket.end('HTTP/1.1 503 Unavailable\r\n\r\n');}),proxyPort=await listen(failed);
 const transport=await createNetworkTransport({mode:'mixed',token,proxy:{ip:'172.20.0.2',token:'upstream-secret'}},{lookup:publicDNS,connect:connector(port,{proxyPort}),listenHost:'127.0.0.1',listenPort:0});
 try{const local=transport.server.address().port;assert.equal((await request(local,{method:'POST',body:'first'})).status,200);assert.equal((await request(local,{method:'POST',body:'second'})).status,200);assert.equal(posts,2);assert.deepEqual(bodies,['first','second']);assert.equal(proxyAttempts,1);assert.equal(transport.route('example.com'),'direct');}
 finally{await transport.close();await stop(target);await stop(failed);}
});
test('successful proxy route is pinned and later failure does not silently change routes',async()=>{
 let connected=0,direct=0;const proxy=net.createServer(socket=>socket.once('data',data=>{assert.match(data.toString(),/^CONNECT example\.com:80 /);assert.ok(data.includes(Buffer.from('workspace:upstream-secret').toString('base64')));connected++;if(connected>1){socket.end('HTTP/1.1 503 Unavailable\r\n\r\n');return;}socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.once('data',request=>{assert.match(request.toString(),/^GET \/path HTTP\/1\.1/);assert.doesNotMatch(request.toString(),/upstream-secret|Proxy-Authorization/i);socket.end('HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied');});})),proxyPort=await listen(proxy);
 const transport=await createNetworkTransport({mode:'mixed',token,proxy:{ip:'172.20.0.2',token:'upstream-secret'}},{lookup:async()=>{throw Error('Local DNS unavailable');},connect:options=>{if(options.host!=='172.20.0.2')direct++;return net.createConnection({host:'127.0.0.1',port:proxyPort});},listenHost:'127.0.0.1',listenPort:0});
 try{const port=transport.server.address().port;assert.equal((await request(port)).text,'proxied');assert.equal((await request(port)).status,502);assert.equal(direct,0);assert.equal(transport.route('example.com'),'proxy');}
 finally{await transport.close();await stop(proxy);}
});
test('transport failure after HTTP mutation bytes never causes direct replay',async()=>{
 let mutationAttempts=0,direct=0;const proxy=net.createServer(socket=>socket.once('data',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.once('data',()=>{mutationAttempts++;socket.destroy();});})),proxyPort=await listen(proxy);
 const transport=await createNetworkTransport({mode:'mixed',token,proxy:{ip:'172.20.0.2',token:'upstream-secret'}},{lookup:publicDNS,connect:options=>{if(options.host!=='172.20.0.2')direct++;return net.createConnection({host:'127.0.0.1',port:proxyPort});},listenHost:'127.0.0.1',listenPort:0});
 try{assert.equal((await request(transport.server.address().port,{method:'POST',body:'charge-once'})).status,502);assert.equal(mutationAttempts,1);assert.equal(direct,0);}
 finally{await transport.close();await stop(proxy);}
});
test('CONNECT tunnels preserve bytes and all tunnels close with their scoped transport',async()=>{
 const target=net.createServer(socket=>socket.pipe(socket)),targetPort=await listen(target);
 const transport=await createNetworkTransport({mode:'direct',token},{lookup:publicDNS,connect:connector(targetPort),listenHost:'127.0.0.1',listenPort:0});
 const client=net.createConnection({host:'127.0.0.1',port:transport.server.address().port});
 try{await new Promise((resolve,reject)=>{client.once('error',reject);client.once('connect',()=>client.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: '+authorization+'\r\n\r\n'));client.once('data',data=>{assert.match(data.toString(),/^HTTP\/1\.1 200/);client.once('data',echo=>{assert.equal(echo.toString(),'hello');resolve();});client.write('hello');});});await transport.close();assert.equal(transport.route('example.com'),'direct');}
 finally{client.destroy();await transport.close();await stop(target);}
});
test('WebSocket upgrade remains in the selected container route and strips proxy credentials',async()=>{
 let raw='';const target=net.createServer(socket=>socket.once('data',data=>{raw=data.toString();socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');socket.pipe(socket);})),targetPort=await listen(target);
 const transport=await createNetworkTransport({mode:'direct',token},{lookup:publicDNS,connect:connector(targetPort),listenHost:'127.0.0.1',listenPort:0});
 const client=net.createConnection({host:'127.0.0.1',port:transport.server.address().port});
 try{await new Promise((resolve,reject)=>{client.once('error',reject);client.once('connect',()=>client.write('GET ws://example.com/socket HTTP/1.1\r\nHost: example.com\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nProxy-Authorization: '+authorization+'\r\n\r\n'));client.once('data',data=>{assert.match(data.toString(),/^HTTP\/1\.1 101/);client.once('data',echo=>{assert.equal(echo.toString(),'frame');resolve();});client.write('frame');});});assert.match(raw,/GET \/socket HTTP\/1\.1/);assert.doesNotMatch(raw,/Proxy-Authorization/i);}
 finally{client.destroy();await transport.close();await stop(target);}
});
test('transport container has no host mounts, profile, devices or published ports',()=>{
 const args=browserTransportArguments({prefix:'owned-environment',image:'kuneco-browser:test',instance:'instance'}),joined=args.join(' ');
 assert.ok(args.includes('--read-only'));assert.ok(args.includes('1000:1000'));assert.ok(args.includes('ALL'));assert.ok(args.includes('no-new-privileges'));assert.equal(args[args.indexOf('--network')+1],'owned-environment-browser-egress');
 for(const forbidden of ['--mount','--volume','--device','--publish','--privileged','--cap-add'])assert.ok(!args.includes(forbidden));assert.doesNotMatch(joined,/secret|token|gateway/i);
});
test('proxy mode preserves existing gateway without Docker mutation',async()=>{
 const transport=await new ContainerBrowserNetwork({command(){throw Error('must not call Docker');}}).start({owner:'owner',environmentId:'183494cd-1b80-4886-a620-4956f9535772',mode:'proxy',proxy:{ip:'172.20.0.2',token:'existing-token'}});
 assert.equal(transport.gatewayIP,'172.20.0.2');assert.equal(transport.token,'existing-token');assert.equal(transport.route('example.com'),'proxy');await transport.close();assert.equal(transport.stopped,true);
});
test('manager config stays on stdin, route events propagate, stale close preserves replacement',async()=>{
 const calls=[],child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
 let prefix,instance,replaced=false,input='';child.stdin.on('data',data=>{input+=data;queueMicrotask(()=>child.stdout.write('{"type":"ready"}\n'));});
 const manager={sourceRoot:'/project',endpoint:'unix:///docker',context:'unit',binary:async()=>'/docker',command:async args=>{calls.push(args);const name=args.at(-1);
  if(args[0]==='network'&&args[1]==='inspect'){if(name.endsWith('-private')){prefix=name.replace(/-private$/,'');return JSON.stringify({Driver:'bridge',Internal:true,Labels:{app:'dingtu'}});}return JSON.stringify({Driver:'bridge',Internal:false,Labels:{app:'kuneco-browser-transport','io.kuneco.environment':prefix}});}
  if(args[0]==='inspect')return JSON.stringify({Id:'owned-container',Config:{Labels:{app:'kuneco-browser-transport','io.kuneco.environment':prefix,'io.kuneco.browser.transport-instance':replaced?'new-instance':instance}},NetworkSettings:{Networks:{[prefix+'-private']:{IPAddress:'172.20.0.4'}}}});
  if(args[0]==='run'){prefix=args[args.indexOf('--name')+1].replace(/-browser-transport$/,'');instance=args.find(x=>x.startsWith('io.kuneco.browser.transport-instance=')).split('=')[1];}
  return '';
 }};
 // Initial inspection represents no previous container.
 const command=manager.command;let inspectCount=0;manager.command=async args=>{if(args[0]==='inspect'&&inspectCount++===0){calls.push(args);throw Error('absent');}return command(args);};
 const events=[];const transport=await new ContainerBrowserNetwork(manager,{spawnProcess:(_binary,args,options)=>{assert.ok(!args.join(' ').includes('secret'));assert.ok(!JSON.stringify(options.env).includes('upstream-unit-secret'));return child;}}).start({owner:'owner',environmentId:'183494cd-1b80-4886-a620-4956f9535772',mode:'mixed',image:'kuneco-browser:test',proxy:{ip:'172.20.0.2',token:'upstream-unit-secret'},onRouteSelected:event=>events.push(event)});
 assert.equal(JSON.parse(input).proxy.token,'upstream-unit-secret');assert.equal(transport.gatewayIP,'172.20.0.4');assert.notEqual(transport.token,'upstream-unit-secret');assert.ok(calls.some(args=>args[0]==='network'&&args[1]==='connect'));
 child.stdout.write('{"type":"route","host":"example.com","route":"direct"}\n');assert.equal(transport.route('example.com'),'direct');assert.equal(events.length,1);
 replaced=true;await transport.close();assert.ok(!calls.some(args=>args[0]==='stop'));assert.equal(transport.stopped,true);
});
