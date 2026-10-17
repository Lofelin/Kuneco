import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {codexActivity,renderActivities} from '../../../src/features/runtimes/runtime-activity.mjs';import {chatViewSnapshot} from '../../../src/features/chat/chat-view-state.mjs';import {reasoningView,finishReasoning} from '../../../src/features/chat/reasoning-view.mjs';
test('real activity types retain command output, changes, image paths and failure status',()=>{
 for(const [type,icon] of [['command_execution','terminal'],['file_change','pencil'],['image_view','image'],['mcp_tool_call','plug']]){const item=codexActivity({type:'item.completed',item:{id:'one',type,status:'failed',command:'echo hello',aggregated_output:'<script>untrusted</script>',exit_code:1}});assert.equal(item.icon,icon);assert.equal(item.exitCode,1);assert.equal(item.status,'failed');}
 const action=codexActivity({type:'item.started',item:{id:'r',type:'command_execution',commandActions:[{type:'read',path:'src/app.js'}]}});assert.match(action.title,/读取文件.*src\/app.js/);assert.equal(codexActivity({type:'item.completed',item:{type:'agent_message'}}),null);
});
test('activities remain expandable and persist with image history without interpreting tool output as HTML',()=>{
 const dom=new JSDOM('<div class="bubble assistant"><div id="content"></div></div>');globalThis.document=dom.window.document;const content=document.getElementById('content');const activities=[codexActivity({type:'item.completed',item:{id:'one',type:'command_execution',command:'echo test',aggregated_output:'<script>untrusted</script>',exit_code:0}})];
 reasoningView(content,{kind:'process',activities},(node,text)=>node.textContent=text);finishReasoning(content,(node,text)=>node.textContent=text);const data=JSON.parse(JSON.stringify(chatViewSnapshot([{id:'chat',nodes:[content.parentNode]}])));assert.equal(data[0].messages[0].reasoning.activities.length,1);assert.equal(document.querySelectorAll('script').length,0);assert.match(document.querySelector('.runtime-shell-output').textContent,/<script>untrusted/);assert.match(document.querySelector('.runtime-shell-output').textContent,/退出码：0/);assert.equal(document.querySelectorAll('.runtime-activity').length,1);assert.equal(document.querySelector('.runtime-shell-label').textContent,'Shell');assert.match(document.querySelector('.runtime-shell-command').textContent,/\$ echo test/);assert.match(document.querySelector('.runtime-activity summary wa-icon').src,/square-terminal.svg$/);dom.window.close();
});

test('start event always renders running even when runtime item contains an outdated completion status',()=>{
 const start=codexActivity({type:'item.started',item:{id:'cmd',type:'command_execution',command:'sleep 8',status:'completed'}});assert.equal(start.status,'in_progress');
 const dom=new JSDOM('<div id="list"></div>');globalThis.document=dom.window.document;renderActivities(document.getElementById('list'),[start]);assert.match(document.querySelector('summary').textContent,/正在运行/);
 const complete=codexActivity({type:'item.completed',item:{id:'cmd',type:'command_execution',command:'sleep 8',status:'inProgress',exit_code:0}});assert.equal(complete.status,'completed');dom.window.close();
});

test('Shell expands automatically during execution and folds when it completes',()=>{
 const dom=new JSDOM('<div id="list"></div>');globalThis.document=dom.window.document;const list=document.getElementById('list');
 renderActivities(list,[{id:'one',type:'command_execution',title:'运行命令 · sleep 8',icon:'terminal',status:'in_progress',detail:'实时输出'}]);assert.equal(list.querySelector('details').open,true);assert.match(list.textContent,/实时输出/);
 list.replaceChildren();renderActivities(list,[{id:'one',type:'command_execution',title:'运行命令 · sleep 8',icon:'terminal',status:'completed',detail:'完成'}]);assert.equal(list.querySelector('details').open,false);dom.window.close();
});
test('completed notification does not invent success for stopped or unknown explicit outcomes',()=>{
 for(const [status,expected] of [['stopped','stopped'],['cancelled','stopped'],['interrupted','interrupted'],['futureStatus','interrupted']])assert.equal(codexActivity({type:'item.completed',item:{id:'x',type:'mcp_tool_call',status}}).status,expected);
});
