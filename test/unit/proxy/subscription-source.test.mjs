import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {publicProxyAddress,proxyDNSRecords,resolveProxyAddress,fetchProxySubscription,prepareSubscriptionProxy} from '../../../src/features/proxy/subscription-source.mjs';
const PUBLIC='93.184.216.34';
function mockHTTPS(t,{body='',error,status=200,headers={}}={}){
 let options;
 t.mock.method(https,'get',(value,callback)=>{
  options=value;const req=new EventEmitter();req.destroy=()=>queueMicrotask(()=>req.emit('error',new Error('socket closed')));
  queueMicrotask(()=>{if(error){req.emit('error',error);return;}const res=new EventEmitter();res.statusCode=status;res.headers=headers;callback(res);res.emit('data',Buffer.from(body));res.emit('end');});return req;
 });return ()=>options;
}
test('subscription requests pin public resolved IP while keeping correct TLS and Host names',async()=>{
 let captured;
 const body=await fetchProxySubscription('https://nodes.example/q/private-token',{resolve:async host=>{assert.equal(host,'nodes.example');return PUBLIC;},request:async options=>{captured=options;return {status:200,text:'proxies: []'};}});
 assert.equal(body,'proxies: []');assert.equal(captured.hostname,PUBLIC);assert.equal(captured.servername,'nodes.example');assert.equal(captured.headers.host,'nodes.example');assert.equal(captured.path,'/q/private-token');assert.equal(captured.headers['accept-encoding'],'identity');
});
test('subscription rejects credential URLs, alternate schemes/ports and private resolved addresses',async()=>{
 for(const source of ['http://nodes.example/a','file:///etc/passwd','https://user:secret@nodes.example/a','https://nodes.example:444/a','https://nodes.example/a#token'])await assert.rejects(fetchProxySubscription(source,{resolve:async()=>PUBLIC,request:async()=>assert.fail('must not download')}));
 for(const ip of ['127.0.0.1','10.0.0.1','172.16.1.1','192.168.0.1','169.254.169.254','100.64.0.1','198.18.0.1','::1','0:0:0:0:0:0:0:1','0:0:0:0:0:ffff:7f00:1','::ffff:127.0.0.1','fe80::1','fd00::1']){
  assert.equal(publicProxyAddress(ip),false,ip);
  await assert.rejects(fetchProxySubscription('https://nodes.example/private-token',{resolve:async()=>ip,request:async()=>assert.fail('must not download')}),/公网/);
 }
});
test('redirects re-resolve and revalidate every target; private and downgrade redirects never downloaded',async()=>{
 for(const location of ['http://other.example/token','https://user:pass@other.example/token','https://other.example:8443/token','https://private.example/token']){
  let requests=0;
  await assert.rejects(fetchProxySubscription('https://nodes.example/q/token',{resolve:async host=>host==='private.example'?'127.0.0.1':PUBLIC,request:async()=>{requests++;return {status:302,location,text:''};}}));assert.equal(requests,1);
 }
 let calls=0;await assert.rejects(fetchProxySubscription('https://nodes.example/a',{resolve:async()=>PUBLIC,request:async()=>{calls++;return {status:302,location:'/again',text:''};}}),/跳转过多/);assert.equal(calls,4);
});
test('subscription caps body size and reports HTTP failures without revealing token or response body',async()=>{
 await assert.rejects(fetchProxySubscription('https://nodes.example/private-token',{resolve:async()=>PUBLIC,request:async()=>({status:200,text:'x'.repeat(1024*1024+1)})}),/1 MB/);
 await assert.rejects(fetchProxySubscription('https://nodes.example/private-token',{resolve:async()=>PUBLIC,request:async()=>({status:403,text:'secret-password'})}),error=>!error.message.includes('private-token')&&!error.message.includes('secret-password'));
});
test('actual HTTPS request failures sanitize raw errors containing credentials',async t=>{
 mockHTTPS(t,{error:new Error('https://nodes.example/q/private-token user:secret-password')});
 await assert.rejects(fetchProxySubscription('https://nodes.example/q/private-token',{resolve:async()=>PUBLIC}),error=>error.message==='安全连接失败，请检查订阅或节点可达性');
});
test('DNS bootstrap uses TLS to fixed public resolver with JSON DNS request',async t=>{
 const captured=mockHTTPS(t,{body:JSON.stringify({Status:0,Answer:[{type:1,data:PUBLIC}]})});
 assert.deepEqual(await proxyDNSRecords('nodes.example','A'),[{type:1,data:PUBLIC}]);
 assert.equal(captured().hostname,'1.1.1.1');assert.equal(captured().servername,'cloudflare-dns.com');assert.equal(captured().path,'/dns-query?name=nodes.example&type=A');
});
test('DNS resolution chooses only public A answers and skips private or irrelevant records',async()=>{
 assert.equal(await resolveProxyAddress('nodes.example',{records:async(host,type)=>{assert.equal(host,'nodes.example');assert.equal(type,'A');return [{type:5,data:'alias.example'},{type:1,data:'127.0.0.1'},{type:1,data:PUBLIC}];}}),PUBLIC);
 await assert.rejects(resolveProxyAddress('nodes.example',{records:async()=>[{type:1,data:'10.0.0.1'}]}),/公网/);
 assert.equal(await resolveProxyAddress(PUBLIC,{records:async()=>assert.fail('IP needs no DNS')}),PUBLIC);
});
test('selected-node preparation pins resolved server and keeps TLS names without mutating saved node',async()=>{
 for(const protocol of ['vless','hysteria2']){
  const original={protocol,host:'nodes.example',port:443,node:{type:protocol,server:'nodes.example',port:443,...(protocol==='vless'?{tls:true}:{})}};
  const prepared=await prepareSubscriptionProxy(original,{resolve:async()=>PUBLIC});
  assert.equal(prepared.host,PUBLIC);assert.equal(prepared.node.server,PUBLIC);assert.equal(prepared.node[protocol==='vless'?'servername':'sni'],'nodes.example');assert.equal(original.node.server,'nodes.example');
 }
});
test('ECH preparation fetches HTTPS record over encrypted resolver and passes static config to core',async()=>{
 const original={protocol:'vless',host:'nodes.example',port:443,node:{type:'vless',server:'nodes.example',port:443,tls:true,'ech-opts':{enable:true,'query-server-name':'ech.example'}}};
 const result=await prepareSubscriptionProxy(original,{resolve:async()=>PUBLIC,records:async(host,type)=>{assert.equal(host,'ech.example');assert.equal(type,'HTTPS');return [{type:65,data:'1 . alpn="h2" ech="AQIDBA=="'}];}});
 assert.deepEqual(result.node['ech-opts'],{enable:true,config:'AQIDBA=='});assert.equal(original.node['ech-opts']['query-server-name'],'ech.example');
 await assert.rejects(prepareSubscriptionProxy(original,{resolve:async()=>PUBLIC,records:async()=>[]}),/ECH/);
});
test('download enforces streaming size cap before accepting subscription content',async t=>{
 mockHTTPS(t,{body:'x'.repeat(1024*1024+1)});
 await assert.rejects(fetchProxySubscription('https://nodes.example/q/private-token',{resolve:async()=>PUBLIC}),/1 MB/);
});
test('DoH refuses bad status, malformed JSON, and resolver failures',async t=>{
 mockHTTPS(t,{body:'not JSON'});await assert.rejects(proxyDNSRecords('nodes.example'),/响应无效/);t.mock.restoreAll();
 mockHTTPS(t,{body:'{"Status":3}'});await assert.rejects(proxyDNSRecords('nodes.example'),/无法通过加密 DNS/);t.mock.restoreAll();
 mockHTTPS(t,{status:503,body:'private-token'});await assert.rejects(proxyDNSRecords('nodes.example'),/引导失败/);t.mock.restoreAll();
 await assert.rejects(proxyDNSRecords('bad/host?secret'),/域名无效/);
});
test('static ECH is canonicalized without runtime query name or extra DNS',async()=>{
 const original={protocol:'vless',host:'nodes.example',port:443,node:{type:'vless',server:'nodes.example',port:443,tls:true,'ech-opts':{enable:true,config:'AQIDBA==','query-server-name':'ech.example'}}};
 const result=await prepareSubscriptionProxy(original,{resolve:async()=>PUBLIC,records:async()=>assert.fail('static ECH requires no lookup')});
 assert.deepEqual(result.node['ech-opts'],{enable:true,config:'AQIDBA=='});
 assert.equal(original.node['ech-opts']['query-server-name'],'ech.example');
});
test('relay and exit bootstrap separately without mutating persisted nodes',async()=>{
 const config={protocol:'ss',host:'exit.example.com',port:443,node:{type:'ss',server:'exit.example.com',port:443,cipher:'aes-256-gcm',password:'secret',relay:{type:'vless',server:'relay.example.com',port:443,tls:true,uuid:'12345678-1234-4234-8234-123456789abc'}}};
 const seen=[];const prepared=await prepareSubscriptionProxy(config,{resolve:async h=>{seen.push(h);return h.startsWith('exit')?'203.0.113.2':'203.0.113.3';}});
 assert.deepEqual(seen,['exit.example.com','relay.example.com']);assert.equal(prepared.node.relay.server,'203.0.113.3');assert.equal(prepared.node.relay.servername,'relay.example.com');assert.equal(config.node.relay.server,'relay.example.com');
});
