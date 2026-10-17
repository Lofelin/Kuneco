import {DockerEnvironments,resourcePrefix} from '../src/docker-environments.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory=await mkdtemp(path.join(tmpdir(),'dingtu-egress-test-'));
const m=new DockerEnvironments({directory,sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()});
const owner='proxy-qa-'+Date.now(),id=await m.create(owner,'出口验收'),prefix=resourcePrefix(owner,id),upstream=prefix+'-upstream';let gateway;
try{
 const proxyCode="const http=require('http'),net=require('net');const server=http.createServer();server.on('connect',(req,socket,head)=>{const u=new URL('http://'+req.url);const target=net.connect(Number(u.port),u.hostname,()=>{socket.write('HTTP/1.1 200 Connection Established\\r\\n\\r\\n');if(head.length)target.write(head);target.pipe(socket);socket.pipe(target)});target.on('error',()=>socket.destroy());socket.on('error',()=>target.destroy())});server.listen(3128,'0.0.0.0')";
 await m.command(['run','-d','--name',upstream,'--label','app=dingtu-test','--network','bridge', 'dingtu-runtime:1','node','-e',proxyCode]);
 const upstreamIP=await m.command(['inspect','--format','{{.NetworkSettings.Networks.bridge.IPAddress}}',upstream]);
 gateway=await m.connect(owner,id,{protocol:'http',host:upstreamIP,port:3128,username:'',password:''},null);
 const status=await gateway.verify();assert.equal(status.state,'ready');
 const empty=await m.runtimeInfo(owner,id,true);assert.equal(empty.runtimes.length,0);
 console.log('空白容器确认无运行时，正在通过临时代理安装 Codex…');
 const installed=await m.installRuntime(owner,id,'codex');assert.deepEqual(installed.runtimes.map(item=>item.id),['codex']);
 console.log('容器内 Codex 安装与检测通过：'+installed.runtimes[0].version);
 const script="const https=require('https'),net=require('net'),tls=require('tls'),u=new URL(process.env.HTTPS_PROXY);const s=net.connect(u.port,u.hostname,()=>s.write('CONNECT api.ipify.org:443 HTTP/1.1\\r\\nHost: api.ipify.org:443\\r\\nProxy-Authorization: Basic '+Buffer.from(decodeURIComponent(u.username)+':'+decodeURIComponent(u.password)).toString('base64')+'\\r\\n\\r\\n'));let b=Buffer.alloc(0);s.on('data',function read(c){b=Buffer.concat([b,c]);if(b.indexOf('\\r\\n\\r\\n')<0)return;s.removeListener('data',read);if(!b.toString().startsWith('HTTP/1.1 200'))process.exit(2);const t=tls.connect({socket:s,servername:'api.ipify.org'},()=>{t.write('GET /?format=json HTTP/1.1\\r\\nHost: api.ipify.org\\r\\nConnection: close\\r\\n\\r\\n')});let out='';t.on('data',c=>out+=c);t.on('end',()=>console.log(out.includes('ip')?'PROXY_OK':'BAD'))});s.on('error',()=>process.exit(2));setTimeout(()=>process.exit(3),10000).unref()";
 assert.equal(await m.exec(owner,id,['node','-e',script]),'PROXY_OK');
 await gateway.stop();
 await assert.rejects(m.exec(owner,id,['node','-e',script]));
 console.log('Docker出口验收通过：运行时HTTPS请求经过容器网关；停止代理后同一路径被阻断。测试使用临时代理，未调用模型或使用真实代理凭据。');
}finally{
 await gateway?.stop();
 for(const name of [prefix+'-worker',prefix+'-gateway',upstream])await m.command(['rm','-f',name]).catch(()=>{});
 await m.command(['network','rm',prefix+'-private']).catch(()=>{});
 for(const suffix of ['home','work'])await m.command(['volume','rm',prefix+'-worker-'+suffix]).catch(()=>{});
 await rm(directory,{recursive:true,force:true});
}
