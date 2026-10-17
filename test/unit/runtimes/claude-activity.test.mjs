import test from 'node:test';import assert from 'node:assert/strict';
import {createClaudeActivityAdapter} from '../../../src/features/runtimes/claude-activity.mjs';
import {mergeRuntimeActivity} from '../../../src/features/runtimes/activity-state.mjs';
import {codexActivity,renderActivities} from '../../../src/features/runtimes/runtime-activity.mjs';
import {JSDOM} from 'jsdom';
test('Claude streaming Skill input is paired with its real result, not the end of its input block',()=>{
 const adapt=createClaudeActivityAdapter();let rows=[];const apply=m=>{for(const a of adapt(m))rows=mergeRuntimeActivity(rows,a,1000);};
 apply({type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'skill-1',name:'Skill',input:{}}}});
 for(const partial_json of ['{"skill":','"pdf","args":"read"}'])apply({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json}}});
 apply({type:'stream_event',event:{type:'content_block_stop',index:0}});assert.equal(rows[0].status,'in_progress');assert.equal(rows[0].input.skill,'pdf');assert.equal(rows[0].type,'skill_use');
 apply({type:'assistant',message:{content:[{type:'tool_use',id:'skill-1',name:'Skill',input:{skill:'pdf',args:'read'}}]}});assert.equal(rows.length,1);
 apply({type:'user',message:{content:[{type:'tool_result',tool_use_id:'skill-1',is_error:false,content:[{type:'text',text:'loaded'}]}]}});
 assert.equal(rows[0].status,'completed');assert.equal(rows[0].input.args,'read');assert.equal(rows[0].output[0].text,'loaded');
 apply({type:'tool_progress',tool_use_id:'skill-1',tool_name:'Skill',elapsed_time_seconds:9});assert.equal(rows[0].status,'completed');
});
test('Claude child tools and tasks retain association and terminal failures, hidden maintenance is omitted',()=>{
 const adapt=createClaudeActivityAdapter();
 const read=adapt({type:'assistant',parent_tool_use_id:'agent-1',message:{content:[{type:'tool_use',id:'read-1',name:'Read',input:{file_path:'/tmp/skill/SKILL.md'}}]}})[0];assert.equal(read.type,'skill_read');assert.equal(read.parentId,'agent-1');
 const error=adapt({type:'user',parent_tool_use_id:'agent-1',message:{content:[{type:'tool_result',tool_use_id:'read-1',is_error:true,content:'Permission denied'}]}})[0];assert.equal(error.status,'failed');assert.equal(error.input.file_path,'/tmp/skill/SKILL.md');
 adapt({type:'system',subtype:'task_started',task_id:'task-1',tool_use_id:'agent-1',description:'核对数据'});
 const result=adapt({type:'system',subtype:'task_notification',task_id:'task-1',tool_use_id:'agent-1',status:'stopped',summary:'Stopped',output_file:'/tmp/output'})[0];assert.equal(result.status,'stopped');assert.equal(result.parentId,'agent-1');assert.match(result.title,/核对数据/);
 assert.deepEqual(adapt({type:'system',subtype:'task_started',task_id:'hidden',skip_transcript:true}),[]);
});
test('MCP server, tool, arguments and structured results stay separate and render as text',()=>{
 const start=codexActivity({type:'item.started',item:{id:'mcp-1',type:'mcp_tool_call',server:'files',tool:'read',arguments:{path:'<script>x</script>'},status:'in_progress'}});
 let rows=mergeRuntimeActivity([],start,1000);
 rows=mergeRuntimeActivity(rows,codexActivity({type:'item.completed',item:{id:'mcp-1',type:'mcp_tool_call',server:'files',tool:'read',arguments:start.input,result:{content:[{type:'text',text:'<img src=x onerror=alert(1)>'}],structured_content:{count:3}},status:'completed'}}),3500);
 assert.equal(rows[0].durationMs,2500);assert.equal(rows[0].server,'files');assert.equal(rows[0].output.structured_content.count,3);
 const {window}=new JSDOM('<div id="list"></div>');globalThis.document=window.document;globalThis.CustomEvent=window.CustomEvent;
 const root=document.getElementById('list');renderActivities(root,rows);root.querySelector('summary').click();assert.equal(rows[0].userExpanded,true);
 rows=mergeRuntimeActivity(rows,{id:'mcp-1',status:'in_progress'},4000);root.replaceChildren();renderActivities(root,rows);
 assert.equal(root.querySelector('details').open,true);assert.equal(root.querySelectorAll('script,img').length,0);assert.match(root.textContent,/参数/);assert.match(root.textContent,/结果/);assert.match(root.textContent,/2.5 秒/);window.close();
});
test('task patches preserve real pending, paused and stopped states without claiming completion',()=>{
 const adapt=createClaudeActivityAdapter();let rows=[];
 for(const status of ['pending','running','paused','killed']){
  const event=adapt({type:'system',subtype:'task_updated',task_id:'task-2',patch:{status,description:'Review'}})[0];rows=mergeRuntimeActivity(rows,event,1000);
  assert.equal(rows[0].status,({running:'in_progress',killed:'stopped'})[status] || status);
 }
 const {window}=new JSDOM('<div></div>');globalThis.document=window.document;
 for(const status of ['pending','paused','unknown']){const root=document.createElement('div');renderActivities(root,[{id:'x',title:'调用工具 · read',status}]);assert.doesNotMatch(root.querySelector('summary').textContent,/已调用/);}
 window.close();
});
