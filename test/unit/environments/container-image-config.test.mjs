import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {imageConfiguration,ImageDownloadProgress} from '../../../src/features/environments/container-image-config.mjs';
import {DockerEnvironments} from '../../../src/features/environments/docker-environments.mjs';

test('image versions and sources validate and produce distinct stable runtime tags',()=>{
 assert.equal(imageConfiguration().imageName,'dingtu-runtime:3-clean');
 const a=imageConfiguration({version:'24-bookworm-slim',repository:'registry.example.com/team/node'});
 assert.equal(a.baseImage,'registry.example.com/team/node:24-bookworm-slim');
 assert.notEqual(a.imageName,imageConfiguration().imageName);assert.deepEqual(a,imageConfiguration(a));
 for(const repository of ['https://registry.example.com/node','user:secret@host/node','--privileged','host/node;rm','host/../node',99])assert.throws(()=>imageConfiguration({repository}));
 assert.throws(()=>imageConfiguration({version:'latest'}));
});

test('download progress aggregates real known layer bytes, including completed and cached layers',()=>{
 const p=new ImageDownloadProgress();assert.equal(p.update({status:'Pulling fs layer',id:'a'}).percent,null);
 assert.deepEqual(p.update({id:'a',status:'Downloading',progressDetail:{current:20,total:100}}),{current:20,total:100,percent:20});
 assert.deepEqual(p.update({id:'b',status:'Downloading',progressDetail:{current:100,total:200}}),{current:120,total:300,percent:40});
 assert.equal(p.update({id:'a',status:'Download complete'}).current,200);
 assert.equal(p.update({id:'c',status:'Already exists'}).total,300);
 assert.throws(()=>p.update({error:'connection failed'}),/镜像下载失败/);
});

test('Unix engine download streams split JSON progress and refuses remote failure',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-pull-')),socket=path.join(directory,'docker.sock');
 let fail=false;
 const server=http.createServer((req,res)=>{
  assert.equal(req.method,'POST');assert.ok(req.url.includes('fromImage=docker.io%2Flibrary%2Fnode'));
  res.writeHead(200,{'Content-Type':'application/json'});
  if(fail){res.end('{"error":"not found"}\n');return;}
  const line=JSON.stringify({id:'layer',status:'Downloading',progressDetail:{current:50,total:100}})+'\n';
  res.write(line.slice(0,20));setTimeout(()=>res.end(line.slice(20)+'{"id":"layer","status":"Pull complete"}\n'),10);
 });
 await new Promise(resolve=>server.listen(socket,resolve));
 const manager=new DockerEnvironments({sourceRoot:process.cwd()});manager.endpoint='unix://'+socket;
 try{
  const events=[];await manager.pullBaseImage(imageConfiguration(),value=>events.push(value));
  assert.equal(events[0].percent,50);assert.equal(events.at(-1).percent,100);assert.equal(events.at(-1).complete,true);
  fail=true;await assert.rejects(manager.pullBaseImage(imageConfiguration(),()=>{}),/not found/);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});

test('image configuration is account scoped and newly created containers pin their selected runtime image',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-image-'));
 const manager=new DockerEnvironments({directory,sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()});
 try{
  await manager.configureImage('one',{version:'24-bookworm-slim',repository:'docker.io/library/node'});
  const one=await manager.create('one','one'),two=await manager.create('two','two');
  assert.notEqual((await manager.get('one',one)).item.imageName,(await manager.get('two',two)).item.imageName);
  assert.equal((await manager.load('two')).imageConfig,undefined);
  await manager.configureImage('one',{version:'22-bookworm-slim'});
  assert.notEqual((await manager.get('one',one)).item.imageName,'dingtu-runtime:3-clean');
 }finally{await rm(directory,{recursive:true,force:true});}
});
