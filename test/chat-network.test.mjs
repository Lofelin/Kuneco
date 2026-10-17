import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {chatNetworkMode,directChatEnvironment,createDirectChatSpawner} from '../src/chat-network.mjs';
import {runCodex} from '../src/codex-runner.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('legacy chats require proxy and direct mode clears inherited proxies',async()=>{
 assert.equal(chatNetworkMode({}),'proxy');assert.equal(chatNetworkMode({networkMode:'direct'}),'direct');
 const env=directChatEnvironment({HTTP_PROXY:'http://invalid',https_proxy:'http://invalid',ALL_PROXY:'http://invalid',NODE_OPTIONS:'--invalid',PATH:process.env.PATH});
 assert.equal(env.HTTP_PROXY,undefined);assert.equal(env.https_proxy,undefined);assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.NO_PROXY,'*');
 assert.throws(()=>createDirectChatSpawner(()=>false)({command:process.execPath}),/环境不可用/);
});
test('direct Codex launches without a gateway and reaches local fixture without proxy credentials',async()=>{
 const server=http.createServer((_req,res)=>res.end('direct response'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const directory=await mkdtemp(path.join(tmpdir(),'chat-direct-'));
 try{
  const executable=path.join(directory,'codex');
  await writeFile(executable,'#!/usr/bin/env node\n'+`let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',async()=>{if(process.env.HTTP_PROXY||input!=='fixture only')process.exit(3);const text=await fetch('http://127.0.0.1:${server.address().port}').then(r=>r.text());console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:2}}));});`,{mode:0o700});
  const events=[];await runCodex({executable,project:directory,prompt:'fixture only',gateway:{status:{mode:'direct',state:'ready'}},spawnProcess:createDirectChatSpawner(),useLocalModel:false,onEvent:(type,value)=>events.push({type,value})});
  assert.ok(events.some(event=>event.type==='text' && event.value==='direct response\n'));
 }finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});

test('automatic mode prefers a verified ready proxy and otherwise selects direct for the next request',async()=>{
 const {chatRequestRoute}=await import('../src/chat-network.mjs');
 assert.equal(chatRequestRoute({networkMode:'auto'},{state:'ready'}),'proxy');
 for(const status of [undefined,{state:'blocked'},{state:'checking'}])assert.equal(chatRequestRoute({networkMode:'auto'},status),'direct');
 assert.equal(chatRequestRoute({networkMode:'proxy'},{state:'blocked'}),'proxy');
 assert.equal(chatRequestRoute({networkMode:'direct'},{state:'ready'}),'direct');
});
