import {reasoningView,finishReasoning} from '../../../src/features/chat/reasoning-view.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {readDeepSeekStream} from '../../../src/features/runtimes/deepseek-runtime.mjs';
test('reasoning renders expanded incrementally before the response finishes and respects manual collapse',async()=>{
 const source=await readFile(new URL('../../../src/app/renderer.js',import.meta.url),'utf8');
 const handler=source.slice(source.indexOf("  if(type==='ccReasoning')"),source.indexOf("  if (type === 'ccText')"));
 const {document}=new JSDOM('<div id="chat"><div class="bubble"><div class="bubble-label">DeepSeek</div><div id="reply"></div></div></div>').window;
 globalThis.document=document;
 const reply=document.getElementById('reply');
 const render=new Function('document','reply','$','updateChatMessage','data','type','reasoningView','chatScroll={canFollow:()=>true,follow(){}}',handler);
 const response=new PassThrough();let completed=false;
 const pending=readDeepSeekStream(response,()=>{},text=>render(document,reply,id=>document.getElementById(id),(body,text)=>{body.dataset.rawText=text;body.textContent=text;},text,'ccReasoning',reasoningView)).then(()=>completed=true);
 response.write('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'第一段'}}]})+'\n\n');
 await new Promise(resolve=>setImmediate(resolve));
 const details=document.querySelector('details');assert.ok(details.open);assert.equal(document.querySelector('.bubble-label'),null);assert.equal(details.querySelectorAll('.reasoning-dots>span').length,3);assert.equal(details.lastChild.textContent,'第一段');assert.equal(completed,false);
 details.open=false;
 response.write('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'第二段'}}]})+'\n\n');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(details.lastChild.textContent,'第一段第二段');assert.equal(details.open,false);assert.equal(completed,false);
 response.end('data: [DONE]\n\n');await pending;
 const markdown=(body,text)=>{body.dataset.rawText=text;body.textContent=text;};finishReasoning(reply,markdown);
 assert.match(details.querySelector('summary').textContent,/已思考 .* 秒/);assert.equal(details.querySelector('.reasoning-dots'),null);
 const saved=JSON.parse(JSON.stringify({text:reply.parentNode.messageReasoning.text,durationMs:reply.parentNode.messageReasoning.durationMs}));
 const restored=document.createElement('div'),answer=document.createElement('div');restored.append(answer);document.getElementById('chat').append(restored);
 const history=reasoningView(answer,{...saved,complete:true},markdown);assert.equal(history.open,false);assert.equal(history.lastChild.textContent,'第一段第二段');assert.match(history.querySelector('summary').textContent,/已思考/);history.open=true;assert.equal(history.lastChild.textContent,'第一段第二段');

});
test('DeepSeek waiting status is independent of deep thinking toggle and retains duration without reasoning text',async()=>{
 const source=await readFile(new URL('../../../src/app/renderer.js',import.meta.url),'utf8'),submit=source.slice(source.indexOf('async function sendChatMessage('),source.indexOf('function applyChatMerge('));
 const dom=new JSDOM('<div id="chat"></div>');globalThis.document=dom.window.document;
 for(const engine of ['deepseek','codex']){
  const form={},prompt={value:'hello'},nodes=[],render=(node,text)=>node.textContent=text;
  let pending;const action=fn=>(pending=fn());const bubble=role=>{const block=document.createElement('div'),content=document.createElement('div');block.className='bubble '+role;block.append(content);document.getElementById('chat').append(block);nodes.push(content);return content;};
  new Function('$','action','selectedEngine','deepseekComposer','api','chatSessions','activeChatId','renderSessionList','bubble','reasoningView','updateChatMessage','reply','saveChatView','chatRuns','updateSendButton','withChatView','dispatchWorkspaceEvent','insightPanel={maintaining:()=>false,refresh:()=>{}},contextPicker={close(){}}','chatScroll={jump(){}}',submit)(id=>id==='chatForm'?form:prompt,action,engine,{payload:text=>({text,thinking:'disabled'}),clear(){}},{cc:async()=>{}},[],'chat',()=>{},bubble,reasoningView,render,null,()=>{},new Map(),()=>{},(_id,fn)=>fn(),()=>{});
  form.onsubmit({preventDefault(){}});await pending;
  const content=nodes.at(-1);assert.equal(Boolean(content.parentNode.querySelector('details')),true);
  if(engine==='codex'){finishReasoning(content,render);assert.match(content.parentNode.querySelector('summary').textContent,/用时 .* 秒/);}
  if(engine==='deepseek'){finishReasoning(content,render);const state=content.parentNode.messageReasoning;assert.equal(state.text,'');assert.match(content.parentNode.querySelector('details').textContent,/模型未返回思考过程/);assert.ok(Number.isFinite(state.durationMs));const restored=document.createElement('div');document.body.append(restored);const answer=document.createElement('div');restored.append(answer);assert.match(reasoningView(answer,{...state,complete:true},render).textContent,/已完成 · 等待/);assert.equal(state.thinkingMs,0);}
 }
 dom.window.close();
});

test('user expansion wins over completion, stopped history survives and timers are cleared',async()=>{
 const {window}=new JSDOM('<div class="bubble assistant"><div id="reply"></div></div>');globalThis.document=window.document;globalThis.CustomEvent=window.CustomEvent;
 const render=(node,text)=>node.textContent=text,reply=document.getElementById('reply');
 const details=reasoningView(reply,{text:'first'},render);
 details.querySelector('summary').click();assert.equal(details.open,false);
 reasoningView(reply,{text:'second'},render);assert.equal(details.open,false);
 details.querySelector('summary').click();assert.equal(details.open,true);
 finishReasoning(reply,render,'answering');assert.equal(details.open,true);
 finishReasoning(reply,render,'stopped');finishReasoning(reply,render);
 assert.equal(reply.parentNode.messageReasoning.phase,'stopped');assert.equal(reply.parentNode.messageReasoning.timer,null);assert.equal(details.open,true);
 assert.match(details.querySelector('summary').textContent,/已停止/);assert.equal(details.querySelector('.reasoning-dots'),null);
 window.close();
});
