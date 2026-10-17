import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {browserRoute} from '../src/browser-routing.mjs';
import {createBrowserDirectTransport} from '../src/browser-direct.mjs';
test('automatic routing prefers proxy regardless of country',()=>{
 assert.equal(browserRoute('mixed','https://baidu.com'),'proxy');
 assert.equal(browserRoute('mixed','https://google.com'),'proxy');
 assert.equal(browserRoute('direct','https://google.com'),'direct');
});
for(const automatic of [true,false])test('proxy failure '+(automatic?'cannot enable legacy direct fallback':'does not fall back in proxy-only mode'),async()=>{
 let attempts=0;
 const target=http.createServer((req,res)=>res.end('direct'));
 await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
 const transport=await createBrowserDirectTransport({routeProxy:()=>{attempts++;throw new Error('offline');},allowDirectFallback:()=>automatic});
 const request=()=>new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port:transport.port,path:`http://127.0.0.1:${target.address().port}/`,headers:{'proxy-authorization':'Basic '+Buffer.from('workspace:'+transport.token).toString('base64')}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));}).on('error',reject));
 try{assert.equal((await request()).status,502);assert.equal((await request()).status,502);assert.equal(attempts,2);assert.equal(transport.getRoute('127.0.0.1'),null);}finally{await transport.close();await new Promise(resolve=>target.close(resolve));}
});
test('successful proxy stays pinned and never falls back after proxy loss',async()=>{
 let ready=true,hits=0;
 const target=http.createServer((req,res)=>res.end('ok'));await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
 const gateway=http.createServer();gateway.on('connect',(req,client,head)=>{hits++;assert.equal(req.headers['proxy-authorization'],'Basic '+Buffer.from('workspace:test').toString('base64'));const remote=net.connect(target.address().port,'127.0.0.1',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);client.pipe(remote);remote.pipe(client);});client.on('close',()=>remote.destroy());});await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
 const transport=await createBrowserDirectTransport({routeProxy:()=>{if(!ready)throw new Error('offline');return {port:gateway.address().port,token:'test'};},allowDirectFallback:()=>true});
 const request=()=>new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port:transport.port,path:`http://127.0.0.1:${target.address().port}/`,headers:{'proxy-authorization':'Basic '+Buffer.from('workspace:'+transport.token).toString('base64')}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject));
 try{assert.equal(await request(),200);assert.equal(transport.getRoute('127.0.0.1'),'proxy');ready=false;assert.equal(await request(),502);assert.equal(hits,1);}finally{await transport.close();await new Promise(resolve=>gateway.close(resolve));await new Promise(resolve=>target.close(resolve));}
});
