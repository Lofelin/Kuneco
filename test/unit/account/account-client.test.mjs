import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {AccountClient,accountServerURL,directRequest} from '../../../src/features/account/account-client.mjs';

test('账号请求绕过环境代理，登录会话加密恢复、按用户配置及退出',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'account-client-'));let trapRequests=0,challenge,saved=null,revoked=false,opened=false;
 const trap=http.createServer((req,res)=>{trapRequests++;res.end('wrong proxy');});await new Promise(resolve=>trap.listen(0,'127.0.0.1',resolve));
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;res.setHeader('content-type','application/json');
  if(req.url==='/v1/auth/google/start'){challenge=JSON.parse(body).challenge;assert.equal(JSON.parse(body).returnURL,'http://127.0.0.1:45678/auth/return/'+'a'.repeat(64));res.end(JSON.stringify({flowId:'fixture',authorizationUrl:`http://127.0.0.1:${server.address().port}/v1/auth/google/authorize?flow=fixture`}));}
  else if(req.url==='/v1/auth/google/poll'){assert.equal(createHash('sha256').update(JSON.parse(body).verifier).digest('base64url'),challenge);res.end(JSON.stringify({status:'complete',token:'fixture-token'}));}
  else if(req.headers.authorization!=='Bearer fixture-token' || revoked){res.writeHead(401);res.end('{"error":"expired"}');}
  else if(req.url==='/v1/me'){res.end(JSON.stringify({id:'fixture-user',name:'Fixture',loginIp:'203.0.113.9'}));}
  else if(req.url==='/v1/me/avatar'){res.writeHead(404);res.end('{}');}
  else if(req.url==='/v1/auth/logout'){revoked=true;res.end('{"ok":true}');}
  else if(req.url==='/v1/me/proxy'){if(req.method==='PUT'){saved=JSON.parse(body);res.end('{"saved":true}');}else res.end(JSON.stringify({proxy:saved}));}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const oldProxy=process.env.HTTP_PROXY;process.env.HTTP_PROXY=`http://127.0.0.1:${trap.address().port}`;
 const storage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('encrypted:'+Buffer.from(value).toString('base64')),decryptString:value=>Buffer.from(value.toString().slice(10),'base64').toString()};
 const options={returnURL:'http://127.0.0.1:45678/auth/return/'+'a'.repeat(64),serverURL:`http://127.0.0.1:${server.address().port}`,sessionFile:path.join(directory,'session'),storage,openExternal:async()=>{opened=true;},directIP:async()=>'203.0.113.9'};
 try{
  const client=new AccountClient(options);await client.login();assert.equal(opened,true);assert.equal(client.user.id,'fixture-user');assert.equal(trapRequests,0);
  assert.ok(!(await readFile(options.sessionFile)).toString().includes('fixture-token'));
  await assert.rejects(client.saveProxy({host:'fixture'},'other-user'));
  await client.saveProxy({protocol:'http',host:'203.0.113.42',port:12323,username:'test',password:'fixture-password'},'fixture-user');assert.equal((await client.proxy()).password,'fixture-password');
  const restored=new AccountClient(options);await restored.restore();assert.equal(restored.user.id,'fixture-user');await restored.logout();assert.equal(revoked,true);assert.equal(restored.user,null);await assert.rejects(readFile(options.sessionFile));
 }finally{if(oldProxy===undefined)delete process.env.HTTP_PROXY;else process.env.HTTP_PROXY=oldProxy;await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>trap.close(resolve))]);await rm(directory,{recursive:true,force:true});}
});
test('远程账号服务只允许 HTTPS，本机 HTTP 例外；未登录禁止保存',async()=>{
 assert.throws(()=>accountServerURL('http://example.com'));assert.throws(()=>accountServerURL('https://user:secret@example.com'));assert.equal(accountServerURL('https://example.com'),'https://example.com');
 const client=new AccountClient({serverURL:'http://localhost:8787'});await assert.rejects(client.saveProxy({}));
});

test('password login persists only an encrypted session, restores the same user, and rejects a wrong password',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'password-client-'));let revoked=false;
 const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;res.setHeader('content-type','application/json');
  if(req.url==='/v1/auth/password'){const value=JSON.parse(body);if(value.password!=='fixture-password'){res.writeHead(400);res.end('{"error":"用户名或密码错误"}');return;}revoked=false;res.end('{"token":"password-session-token"}');return;}
  if(req.headers.authorization!=='Bearer password-session-token'||revoked){res.writeHead(401);res.end('{"error":"signed-out"}');return;}
  if(req.url==='/v1/me')res.end('{"id":"password-user","username":"shennong","name":"神农"}');else if(req.url==='/v1/auth/logout'){revoked=true;res.end('{}');}else{res.writeHead(404);res.end('{}');}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const settings={serverURL:`http://127.0.0.1:${server.address().port}`,sessionFile:path.join(directory,'session.bin'),storage:{isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from('encrypted:'+Buffer.from(text).toString('base64')),decryptString:data=>Buffer.from(data.toString().slice(10),'base64').toString()},openExternal:()=>{throw new Error('password login must not launch a browser');}};
 try{const client=new AccountClient(settings);await assert.rejects(client.login({username:'shennong',password:'fixture-password',confirmPassword:'different'}),/两次/);await client.login({username:'shennong',password:'fixture-password',confirmPassword:'fixture-password'});assert.equal(client.user.id,'password-user');const stored=(await readFile(settings.sessionFile)).toString();assert.ok(!stored.includes('fixture-password')&&!stored.includes('password-session-token'));const restored=new AccountClient(settings);await restored.restore();assert.equal(restored.user.id,'password-user');await restored.logout();assert.equal(restored.user,null);await assert.rejects(restored.login({username:'shennong',password:'wrong-password',confirmPassword:'wrong-password'}));assert.equal(restored.status,'signed-out');}finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});

test('offline restart restores only encrypted verified account identity; revoked sessions never restore identity',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'account-offline-'));
 const storage={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(Buffer.from(text).toString('base64')),decryptString:data=>Buffer.from(data.toString(),'base64').toString()};
 const settings={serverURL:'http://127.0.0.1:1',sessionFile:path.join(dir,'session'),storage};
 try{
  const first=new AccountClient(settings);first.token='test-token';first.profileToken='test-token';first.user={id:'verified-owner',name:'Fixture'};await first.persist();
  const offline=new AccountClient(settings);offline.request=async()=>{throw new Error('offline');};await offline.restore();assert.equal(offline.user.id,'verified-owner');assert.equal(offline.status,'offline');
  const revoked=new AccountClient(settings);revoked.request=async()=>{throw Object.assign(new Error('revoked'),{status:401});};await revoked.restore();assert.equal(revoked.user,null);assert.equal(revoked.token,null);await assert.rejects(readFile(settings.sessionFile));
  first.token='different-token';await first.persist();const unverified=new AccountClient(settings);unverified.request=offline.request;await unverified.restore();assert.equal(unverified.user,null);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('late chat GET and PUT responses reject after account or token generation changes',async()=>{
 const client=new AccountClient({serverURL:'http://localhost:8787'});client.user={id:'A'};client.token='token-A';
 let release;client.request=()=>new Promise(resolve=>release=resolve);const get=client.chats();client.user={id:'B'};client.token='token-B';client.version++;release({revision:1,payload:{sessions:[{id:'A-chat'}]}});await assert.rejects(get,/对话账号已变化/);
 client.user={id:'A'};client.token='A-first';const put=client.saveChats({revision:1,payload:{}},'A');client.token='A-second';client.version++;release({revision:2});await assert.rejects(put,/对话账号已变化/);
});
