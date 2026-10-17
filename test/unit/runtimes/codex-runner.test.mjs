import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {runCodex,codexArguments} from '../../../src/features/runtimes/codex-runner.mjs';
const gateway={port:1234,url:'http://workspace:fake@127.0.0.1:1234'};
test('Codex参数只读、禁用外部工具、提示走stdin，会话按id恢复',()=>{
  const args=codexArguments({project:'/tmp/project with spaces',sessionId:'thread-fixture'});
  assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));assert.ok(!args.includes('--ignore-user-config'));assert.ok(!args.includes('--disable'));assert.ok(!args.includes('--sandbox'));assert.ok(args.includes('web_search="live"'));assert.ok(!args.includes('web_search="disabled"'));
  assert.deepEqual(args.slice(-3),['resume','thread-fixture','-']);
});
test('Codex JSON事件读取、分段回复和完成判断',async()=>{
  const events=[];let gotPrompt;
  await runCodex({executable:'fixture',project:process.cwd(),prompt:'你好',gateway,onEvent:(...args)=>events.push(args),spawnProcess:options=>{
    assert.equal(options.env.HTTPS_PROXY,gateway.url);assert.equal(options.env.NO_PROXY,'');
    const code=`let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-session'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'fixture reply'}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,output_tokens:20,cached_input_tokens:60}}));});`;
    const child=spawn(process.execPath,['-e',code],{stdio:['pipe','pipe','pipe']});gotPrompt=options.args.at(-1);return child;
  }});
  assert.equal(gotPrompt,'-');assert.deepEqual(events,[['session','fixture-session'],['text','fixture reply\n'],['usage',{input_tokens:100,output_tokens:20,cached_input_tokens:60}]]);
});
test('Codex错误、异常退出和取消不会被当成成功',async()=>{
  for(const fixture of ['console.log(JSON.stringify({type:"turn.failed"}));','process.exit(2)']) {
    await assert.rejects(runCodex({executable:'fixture',project:process.cwd(),prompt:'test',gateway,onEvent:()=>{},spawnProcess:()=>spawn(process.execPath,['-e',fixture],{stdio:['pipe','pipe','pipe']})}));
  }
  const controller=new AbortController();
  const running=runCodex({executable:'fixture',project:process.cwd(),prompt:'test',gateway,signal:controller.signal,onEvent:()=>{},spawnProcess:options=>spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:options.signal,stdio:['pipe','pipe','pipe']})});
  controller.abort();await assert.rejects(running);
});
test('用户配置模型作为明确参数保留，瞬时重连告警不会把最终成功误报失败',async()=>{
  assert.equal(codexArguments({project:'/tmp',model:'configured-model'})[codexArguments({project:'/tmp',model:'configured-model'}).indexOf('--model')+1],'configured-model');
  await runCodex({executable:'fixture',project:process.cwd(),prompt:'test',gateway,onEvent:()=>{},spawnProcess:()=>spawn(process.execPath,['-e',`process.stdin.resume();console.log(JSON.stringify({type:'error',message:'Reconnecting... 503 temporary failure'}));console.log(JSON.stringify({type:'turn.completed'}));`],{stdio:['pipe','pipe','pipe']})});
});


test('Codex exposes returned process summaries, commentary and search activity separately from final output',async()=>{
 const events=[];const fixture=[{type:'item.completed',item:{type:'reasoning',text:'检查用户附加图片'}},{type:'item.completed',item:{type:'agent_message',phase:'commentary',text:'我查看一下图片。'}},{type:'item.started',item:{type:'web_search',query:'reference'}},{type:'item.completed',item:{type:'agent_message',text:'这是最终回答。'}},{type:'turn.completed'}];
 await runCodex({executable:'fixture',project:process.cwd(),prompt:'看图',gateway,useLocalModel:false,onEvent:(...e)=>events.push(e),spawnProcess:()=>spawn(process.execPath,['-e',`process.stdin.resume();for(const event of ${JSON.stringify(fixture)})console.log(JSON.stringify(event));`],{stdio:['pipe','pipe','pipe']})});
 assert.deepEqual(events.filter(e=>e[0]==='process').map(e=>e[1].text),['检查用户附加图片','我查看一下图片。']);assert.deepEqual(events.filter(e=>e[0]==='text'),[['text','这是最终回答。\n']]);
});
