import test from 'node:test';import assert from 'node:assert/strict';
import{parseAuthStatus,detectAIAuth}from'../src/ai-auth.mjs';
import{execFileSync}from'node:child_process';
test('登录态解析不返回账号信息和密钥，未知结果不放行',()=>{
 assert.equal(parseAuthStatus('cc',{stdout:JSON.stringify({loggedIn:true,email:'private',token:'secret'})}).state,'signed-in');
 assert.equal(parseAuthStatus('cc',{stdout:'{"loggedIn":false}',code:1}).state,'signed-out');
 assert.deepEqual(parseAuthStatus('codex',{stderr:'Logged in using ChatGPT'}),{state:'signed-in',method:'ChatGPT'});
 assert.equal(parseAuthStatus('codex',{stderr:'Not logged in',code:1}).state,'signed-out');
 assert.equal(parseAuthStatus('codex',{stderr:'Logged in',code:2}).state,'unknown');
 assert.equal(parseAuthStatus('cc',{stdout:'invalid'}).state,'unknown');
});
test('真实Codex状态命令在网络隔离下可读取，不调用模型',async()=>{
 const executable=execFileSync('/usr/bin/which',['codex'],{encoding:'utf8'}).trim();
 const result=await detectAIAuth({engine:'codex',executable});assert.ok(['signed-in','signed-out'].includes(result.state));console.log('Codex local auth:',JSON.stringify(result));
});
