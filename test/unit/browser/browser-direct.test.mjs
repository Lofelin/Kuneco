import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {createBrowserDirectTransport} from '../../../src/features/browser/browser-direct.mjs';
test('explicit browser direct transport authenticates, resolves hosts, forwards HTTP and CONNECT, and closes active connections',async()=>{
 const target=http.createServer((req,res)=>{assert.equal(req.headers['proxy-authorization'],undefined);res.end('direct:'+req.url);});
 await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
 const transport=await createBrowserDirectTransport();
 const auth='Basic '+Buffer.from('workspace:'+transport.token).toString('base64');
 const request=headers=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:transport.port,path:`http://localhost:${target.address().port}/page`,headers},res=>{let body='';res.on('data',data=>body+=data);res.on('end',()=>resolve({status:res.statusCode,body}));}).on('error',reject);});
 try{
  assert.equal((await request({})).status,407);
  assert.deepEqual(await request({'proxy-authorization':auth}),{status:200,body:'direct:/page'});
  const socket=net.connect(transport.port,'127.0.0.1');socket.on('error',()=>{});
  const received=new Promise(resolve=>socket.once('data',data=>resolve(data.toString())));
  socket.write(`CONNECT localhost:${target.address().port} HTTP/1.1\r\nHost: localhost\r\nProxy-Authorization: ${auth}\r\n\r\n`);
  assert.match(await received,/200 Connection Established/);
  const response=new Promise(resolve=>socket.once('data',data=>resolve(data.toString())));
  socket.write('GET /tunnel HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  assert.match(await response,/direct:\/tunnel/);
  const closed=new Promise(resolve=>socket.once('close',resolve));transport.closeConnections();await closed;
 }finally{await transport.close();await new Promise(resolve=>target.close(resolve));}
});
