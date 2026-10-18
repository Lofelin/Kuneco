import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const bridge=fileURLToPath(new URL('../../../src/features/git/git-proxy-bridge.cjs',import.meta.url));
async function server(handler){const sockets=new Set();const server=net.createServer(s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));handler(s);});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {port:server.address().port,close:async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};}
function run(proxy,options={}){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[bridge,'git.example.test','22'],{env:{...process.env,KUNECO_GIT_PROXY_URL:proxy},stdio:['pipe','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{child.kill();reject(Error('bridge timed out'));},3000);child.stdout.on('data',b=>{out+=b;if(options.endAfterOutput)child.stdin.end();});child.stderr.on('data',b=>err+=b);child.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});});}
test('SSH bridge CONNECT uses configured proxy and forwards response remainder',async()=>{
 let request='';const proxy=await server(s=>s.once('data',b=>{request=b.toString();s.end('HTTP/1.1 200 Connection established\r\n\r\nSSH-2.0-fixture\r\n');}));
 try{const result=await run('http://alice:fixture@127.0.0.1:'+proxy.port,{endAfterOutput:true});assert.match(request,/CONNECT git.example.test:22 HTTP\/1.1/);assert.match(request,/Proxy-Authorization: Basic /);assert.equal(result.out,'SSH-2.0-fixture\r\n');assert.equal(result.code,0);}finally{await proxy.close();}
});
test('proxy rejection fails promptly without a direct fallback or credentials in errors',async()=>{
 const proxy=await server(s=>s.once('data',()=>s.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n')));
 try{const result=await run('http://alice:fixture@127.0.0.1:'+proxy.port);assert.equal(result.code,1);assert.ok(!result.err.includes('fixture'));assert.equal(result.out,'');}finally{await proxy.close();}
});
test('SOCKS5 proxy receives remote hostname without local DNS',async()=>{
 let target='';const proxy=await server(s=>{let stage=0;s.on('data',b=>{if(stage++===0)s.write(Buffer.from([5,0]));else{target=b.subarray(5,5+b[4]).toString();s.end(Buffer.concat([Buffer.from([5,0,0,1,127,0,0,1,0,22]),Buffer.from('SSH-2.0-socks\r\n')]));}});});
 try{const result=await run('socks5://127.0.0.1:'+proxy.port,{endAfterOutput:true});assert.equal(target,'git.example.test');assert.equal(result.out,'SSH-2.0-socks\r\n');assert.equal(result.code,0);}finally{await proxy.close();}
});
