import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {browserRoute} from '../../../src/features/browser/browser-routing.mjs';
import {createBrowserDirectTransport} from '../../../src/features/browser/browser-direct.mjs';
test('automatic routing prefers proxy regardless of country',()=>{
 assert.equal(browserRoute('mixed','https://baidu.com'),'proxy');
 assert.equal(browserRoute('mixed','https://google.com'),'proxy');
 assert.equal(browserRoute('direct','https://google.com'),'direct');
});
for(const automatic of [true,false])test('proxy failure '+(automatic?'falls back in automatic mode':'does not fall back in proxy-only mode'),async()=>{
 let attempts=0;
 const target=http.createServer((req,res)=>res.end('direct'));
 await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
 const transport=await createBrowserDirectTransport({routeProxy:()=>{attempts++;throw new Error('offline');},allowDirectFallback:()=>automatic});
 const request=()=>new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port:transport.port,path:`http://127.0.0.1:${target.address().port}/`,headers:{'proxy-authorization':'Basic '+Buffer.from('workspace:'+transport.token).toString('base64')}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));}).on('error',reject));
 try{assert.equal((await request()).status,automatic?200:502);assert.equal((await request()).status,automatic?200:502);assert.equal(attempts,automatic?1:2);assert.equal(transport.getRoute('127.0.0.1'),automatic?'direct':null);}finally{await transport.close();await new Promise(resolve=>target.close(resolve));}
});
test('successful proxy stays pinned and never falls back after proxy loss',async()=>{
 let ready=true,hits=0;
 const target=http.createServer((req,res)=>res.end('ok'));await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
 const gateway=http.createServer();gateway.on('connect',(req,client,head)=>{hits++;assert.equal(req.headers['proxy-authorization'],'Basic '+Buffer.from('workspace:test').toString('base64'));const remote=net.connect(target.address().port,'127.0.0.1',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);client.pipe(remote);remote.pipe(client);});client.on('close',()=>remote.destroy());});await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
 const transport=await createBrowserDirectTransport({routeProxy:()=>{if(!ready)throw new Error('offline');return {port:gateway.address().port,token:'test'};},allowDirectFallback:()=>true});
 const request=()=>new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port:transport.port,path:`http://127.0.0.1:${target.address().port}/`,headers:{'proxy-authorization':'Basic '+Buffer.from('workspace:'+transport.token).toString('base64')}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject));
 try{assert.equal(await request(),200);assert.equal(transport.getRoute('127.0.0.1'),'proxy');ready=false;assert.equal(await request(),502);assert.equal(hits,1);}finally{await transport.close();await new Promise(resolve=>gateway.close(resolve));await new Promise(resolve=>target.close(resolve));}
});
for(const automatic of [true,false])test(`CONNECT rejection only falls back when automatic=${automatic}`,async()=>{
 let received=0,attempts=0;
 const target=http.createServer((req,res)=>{received++;res.end('direct');});await new Promise(r=>target.listen(0,'127.0.0.1',r));
 const gateway=http.createServer();gateway.on('connect',(req,socket)=>{attempts++;socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');});await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const transport=await createBrowserDirectTransport({routeProxy:()=>({port:gateway.address().port,token:'test'}),allowDirectFallback:()=>automatic});
 try{
  const status=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:transport.port,path:`http://127.0.0.1:${target.address().port}/`,method:'POST',headers:{'proxy-authorization':'Basic '+Buffer.from('workspace:'+transport.token).toString('base64')}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end('one submission');});
  assert.equal(status,automatic?200:502);assert.equal(received,automatic?1:0);assert.equal(attempts,1);
  assert.equal(transport.getRoute('127.0.0.1'),automatic?'direct':null);
  transport.closeConnections();assert.equal(transport.getRoute('127.0.0.1'),null);
 }finally{await transport.close();await new Promise(r=>gateway.close(r));await new Promise(r=>target.close(r));}
});
test('HTTP application failure after proxy connection does not replay the request',async()=>{
 let received=0;
 const target=http.createServer((req,res)=>{received++;res.writeHead(503);res.end();});await new Promise(r=>target.listen(0,'127.0.0.1',r));
 const gateway=http.createServer();gateway.on('connect',(req,client)=>{const remote=net.connect(target.address().port,'127.0.0.1',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');client.pipe(remote);remote.pipe(client);});client.on('close',()=>remote.destroy());});await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const transport=await createBrowserDirectTransport({routeProxy:()=>({port:gateway.address().port,token:'test'}),allowDirectFallback:()=>true});
 try{const status=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:transport.port,path:`http://127.0.0.1:${target.address().port}/`,method:'POST',headers:{'proxy-authorization':'Basic '+Buffer.from('workspace:'+transport.token).toString('base64')}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end('one submission');});assert.equal(status,503);assert.equal(received,1);assert.equal(transport.getRoute('127.0.0.1'),'proxy');}finally{await transport.close();await new Promise(r=>gateway.close(r));await new Promise(r=>target.close(r));}
});
