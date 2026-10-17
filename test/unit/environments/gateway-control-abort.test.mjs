import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import net from 'node:net';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(){
 const dir=await mkdtemp(path.join(tmpdir(),'kuneco-control-test-'));
 // Execute the real control entrypoint, changing only its import and test port.
 const source=(await readFile(new URL('../../../docker/runtime/gateway.mjs',import.meta.url),'utf8'))
  .replace("'./proxy.mjs'",JSON.stringify(new URL('../../../src/features/proxy/proxy.mjs',import.meta.url).href))
  .replace("server.listen(9091,'127.0.0.1');","server.listen(0,'127.0.0.1',()=>console.log(server.address().port));");
 await writeFile(path.join(dir,'gateway.mjs'),source);
 const child=spawn(process.execPath,[path.join(dir,'gateway.mjs')],{stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',c=>errors+=c);
 const exited=new Promise(resolve=>child.once('exit',resolve));
 try{
  const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('control fixture did not start')),3000);child.stdout.once('data',c=>{clearTimeout(timer);resolve(Number(c.toString().trim()));});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('control fixture exited: '+errors));});});
  const request=body=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,method:'POST',agent:false},res=>{let data='';res.on('data',c=>data+=c);res.once('error',reject);res.once('end',()=>resolve({code:res.statusCode,data}));});req.once('error',reject);req.setTimeout(1000,()=>req.destroy(new Error('control fixture request timeout')));req.end(body);});
  return {child,port,request,errors:()=>errors,async close(){if(child.exitCode===null){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),1000);await exited;clearTimeout(timer);}await rm(dir,{recursive:true,force:true});}};
 }catch(error){child.kill('SIGKILL');await exited;await rm(dir,{recursive:true,force:true});throw error;}
}
test('aborted, malformed and oversized control bodies do not terminate the gateway',async()=>{
 const f=await fixture();let socket;
 try{
  socket=net.connect({host:'127.0.0.1',port:f.port});socket.on('error',()=>{});await new Promise(resolve=>socket.once('connect',resolve));
  socket.write('POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 10000\r\n\r\n{"action":');
  await wait(25);socket.destroy();await wait(75);
  assert.equal(f.child.exitCode,null,f.errors());
  assert.equal((await f.request('{invalid')).code,500);
  assert.equal((await f.request('x'.repeat(70000))).code,413);
  const status=await f.request(JSON.stringify({action:'status'}));assert.equal(status.code,200);assert.equal(JSON.parse(status.data).state,'blocked');
  assert.equal(f.child.exitCode,null);assert.equal(f.errors(),'');
 }finally{socket?.destroy();await f.close();}
});
