import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {createDeepSeekTools} from '../../../src/features/runtimes/deepseek-tools.mjs';
import {configureDeepSeek,runDeepSeekCLI,readDeepSeekStream} from '../../../src/features/runtimes/deepseek-runtime.mjs';
import {recoverDeepSeekMessages} from '../../../src/features/runtimes/deepseek-history-recovery.mjs';
const call=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const fixture=async()=>{const root=await mkdtemp(path.join(tmpdir(),'kuneco-tools-'));await mkdir(path.join(root,'.claude/skills/check'),{recursive:true});await writeFile(path.join(root,'.claude/skills/check/SKILL.md'),'---\nname: check\ndescription: Run local check\n---\nRun printf REAL_TOOL_OK');return root;};

test('SSE assembles interleaved tool argument fragments and refuses truncated execution',async()=>{
 const response=new PassThrough(),result=readDeepSeekStream(response);
 const frame=value=>'data: '+JSON.stringify({choices:[value]})+'\n\n';
 response.end(frame({delta:{tool_calls:[{index:1,id:'b',type:'function',function:{name:'Bash',arguments:'{"command":'}},{index:0,id:'s',type:'function',function:{name:'Skill',arguments:'{"skill":'}}]}})+frame({delta:{tool_calls:[{index:0,function:{arguments:'"check"}'}},{index:1,function:{arguments:'"pwd"}'}}]}})+frame({delta:{},finish_reason:'tool_calls'})+'data: [DONE]\n\n');
 const value=await result;assert.deepEqual(value.choices[0].message.tool_calls,[call('s','Skill',{skill:'check'}),call('b','Bash',{command:'pwd'})]);
 const broken=new PassThrough(),failure=readDeepSeekStream(broken);broken.end(frame({delta:{tool_calls:[{index:0,id:'s',function:{name:'Bash',arguments:'{'}}]},finish_reason:'length'})+'data: [DONE]\n\n');await assert.rejects(failure,/未执行/);
});

test('real Skill load, project read/write, shell failure and path boundary emit truthful events',async()=>{
 const root=await fixture(),events=[];
 try{const tools=await createDeepSeekTools({cwd:root,home:root,onActivity:e=>events.push(e)});
  assert.match(tools.definitions[0].function.description,/check/);
  const skill=JSON.parse(await tools.execute(call('s','Skill',{skill:'check'})));assert.match(skill.instructions,/REAL_TOOL_OK/);assert.equal(events.at(-1).type,'skill_use');assert.equal(events.at(-1).status,'completed');
  await tools.execute(call('w','Write',{path:'value.txt',content:'actual value'}));assert.equal(await readFile(path.join(root,'value.txt'),'utf8'),'actual value');
  assert.equal(JSON.parse(await tools.execute(call('r','Read',{path:'value.txt'}))).content,'actual value');
  await symlink('/etc',path.join(root,'outside'));assert.match(JSON.parse(await tools.execute(call('x','Read',{path:'outside/hosts'}))).error,/超出/);
  const result=JSON.parse(await tools.execute(call('b','Bash',{command:'printf REAL_TOOL_OK; exit 7'})));assert.equal(result.output,'REAL_TOOL_OK');assert.equal(result.exitCode,7);assert.equal(events.at(-1).status,'failed');assert.equal(events.at(-1).provider,'deepseek');
  assert.equal(JSON.parse(await tools.execute(call('n','Skill',{skill:'missing'}))).error,'技能不存在：missing');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('stopping Bash kills its process group before delayed side effects',async()=>{
 const root=await fixture(),controller=new AbortController(),events=[];
 try{const tools=await createDeepSeekTools({cwd:root,home:root,signal:controller.signal,onActivity:e=>events.push(e)});const pending=tools.execute(call('b','Bash',{command:'sleep 1; printf leaked > should-not-exist'}));setTimeout(()=>controller.abort(),80);await pending;assert.equal(events.at(-1).status,'stopped');await new Promise(r=>setTimeout(r,1100));await assert.rejects(readFile(path.join(root,'should-not-exist')),e=>e.code==='ENOENT');}
 finally{await rm(root,{recursive:true,force:true});}
});

test('real executor loops Skill then Bash, preserves reasoning and tool results, sums usage',async()=>{
 const root=await fixture(),directory=path.join(root,'config'),sessionId='12345678-1234-1234-1234-123456789012',events=[];
 try{await configureDeepSeek(directory,{apiKey:'fixture-key'},async()=>({data:[{id:'deepseek-flash'}]}));let round=0;
 const request=async(_p,_k,_r,body)=>{assert.equal(body.tools.length,4);if(round===1){assert.equal(body.messages.at(-2).reasoning_content,'choose skill');assert.equal(body.messages.at(-1).role,'tool');assert.match(body.messages.at(-1).content,/REAL_TOOL_OK/);}if(round===2){assert.match(body.messages.at(-1).content,/REAL_TOOL_OK/);assert.equal(body.messages.at(-2).reasoning_content,'run command');}const replies=[{content:'',reasoning_content:'choose skill',tool_calls:[call('s','Skill',{skill:'check'})]},{content:'',reasoning_content:'run command',tool_calls:[call('b','Bash',{command:'printf REAL_TOOL_OK'})]},{content:'Done',reasoning_content:'verified'}];const reply=replies[round++];return {choices:[{message:reply,finish_reason:reply.tool_calls?'tool_calls':'stop'}],usage:{total_tokens:10}};};
 const result=await runDeepSeekCLI('chat',{sessionId,prompt:'Run check',project:root},{directory,request,onActivity:e=>events.push(e)});assert.equal(result.text,'Done');assert.equal(result.usage.total_tokens,30);assert.equal(round,3);assert.equal(events.at(-1).output,'REAL_TOOL_OK');
 const history=JSON.parse(await readFile(path.join(directory,sessionId+'.json'),'utf8'));assert.equal(history.at(-1).reasoning_content,'verified');assert.equal(history.filter(m=>m.role==='tool').length,2);assert.deepEqual(recoverDeepSeekMessages([],history).map(m=>m.text),['Run check','Done']);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('network failure after a side effect retains its result and does not replay it',async()=>{
 const root=await fixture(),directory=path.join(root,'config'),sessionId='12345678-1234-1234-1234-123456789012';
 try{await configureDeepSeek(directory,{apiKey:'fixture-key'},async()=>({data:[{id:'deepseek-flash'}]}));let count=0;
 await assert.rejects(runDeepSeekCLI('chat',{sessionId,prompt:'write once',project:root},{directory,request:async(_p,_k,route)=>{if(route==='/models')return {data:[]};if(count++)throw new Error('offline');return {choices:[{message:{reasoning_content:'once',tool_calls:[call('b','Bash',{command:'printf once >> marker'})]},finish_reason:'tool_calls'}]};}}),/offline/);
 assert.equal(await readFile(path.join(root,'marker'),'utf8'),'once');await runDeepSeekCLI('chat',{sessionId,prompt:'status',project:root},{directory,request:async(_p,_k,_r,body)=>{assert.equal(body.messages.at(-2).role,'tool');return {choices:[{message:{content:'already executed'},finish_reason:'stop'}]};}});assert.equal(await readFile(path.join(root,'marker'),'utf8'),'once');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('large command output is explicitly truncated and timeout is a failure',async()=>{
 const root=await fixture(),events=[];
 try{const tools=await createDeepSeekTools({cwd:root,home:root,onActivity:e=>events.push(e)});const result=JSON.parse(await tools.execute(call('large','Bash',{command:'head -c 40000 /dev/zero | tr "\\0" x'})));assert.match(result.output,/输出已截断/);assert.ok(result.output.length<32100);await tools.execute(call('timeout','Bash',{command:'sleep 5',timeout_ms:100}));assert.equal(events.at(-1).status,'failed');assert.match(events.at(-1).error,/超时/);}
 finally{await rm(root,{recursive:true,force:true});}
});

test('aborting a running tool checkpoints stopped result and never requests another model round',async()=>{
 const root=await fixture(),directory=path.join(root,'config'),controller=new AbortController(),sessionId='12345678-1234-1234-1234-123456789012';let requests=0;
 try{await configureDeepSeek(directory,{apiKey:'fixture-key'},async()=>({data:[{id:'deepseek-flash'}]}));await assert.rejects(runDeepSeekCLI('chat',{sessionId,prompt:'stop',project:root},{directory,signal:controller.signal,onActivity:e=>{if(e.status==='in_progress')setTimeout(()=>controller.abort(),50);},request:async(_p,_k,route)=>{if(route==='/models')return {data:[]};requests++;return {choices:[{message:{tool_calls:[call('b','Bash',{command:'sleep 5'})]},finish_reason:'tool_calls'}]};}}));assert.equal(requests,1);const history=JSON.parse(await readFile(path.join(directory,sessionId+'.json'),'utf8'));assert.match(history.at(-1).content,/已停止/);}
 finally{await rm(root,{recursive:true,force:true});}
});
