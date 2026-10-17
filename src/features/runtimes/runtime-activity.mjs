import {renderFileDiffs} from '../chat/file-diff.mjs';
export function codexActivity(event){
 if(!['item.started','item.updated','item.completed'].includes(event.type) || !event.item)return null;
 const item=event.item,type=item.type;
 if(['agent_message','reasoning','user_message'].includes(type) || !item.id)return null;
 let status;
 if(event.type==='item.started')status='in_progress';
 else if(type==='error' || item.status==='failed' || item.status==='declined' || item.error || item.success===false || Number.isFinite(item.exit_code) && item.exit_code!==0)status='failed';
 else if(['stopped','cancelled','canceled'].includes(item.status))status='stopped';
 else if(event.type==='item.completed')status=!item.status || ['completed','in_progress','inProgress'].includes(item.status)?'completed':'interrupted';
 else status=item.status==='inProgress'?'in_progress':item.status || 'in_progress';
 const labels={command_execution:['terminal','运行命令'],file_change:['pencil','修改文件'],web_search:['search','搜索网页'],webSearch:['search','搜索网页'],mcp_tool_call:['plug','调用工具'],image_view:['image','查看图片'],image_viewer:['image','查看图片'],image_generation:['image','生成图片'],collab_tool_call:['bot','协作任务'],dynamic_tool_call:['plug','调用工具'],subagent_activity:['bot','子任务'],plan:['list','任务计划'],todo_list:['list','任务计划'],error:['activity','运行时错误']};
 let [icon,label]=labels[type] || ['activity',item.name || type || '运行时活动'];
 const action=item.commandActions?.[0];if(action?.type==='read'){icon='book-open';label='读取文件';}else if(action?.type==='search'){icon='search';label='搜索文件';}else if(action?.type==='listFiles'){icon='folder';label='列出文件';}
 const skillRead=action?.type==='read' && /(?:^|[/\\])SKILL\.md$/i.test(action.path || '');if(skillRead){icon='book-open';label='读取技能';}
 const target=action?.path || item.command || item.query || item.tool || item.path || item.name || '';
 return {id:String(item.id),type:skillRead?'skill_read':type,provider:'codex',...(type==='file_change'&&status==='completed'?{changes:item.changes}:{}),...(Number.isFinite(item.durationMs)?{durationMs:item.durationMs}:{}),toolName:item.tool || item.name || type,server:item.server,command:item.command || '',icon,title:label+(target?' · '+target:''),status,
  ...(item.arguments!==undefined?{input:item.arguments}:item.command?{input:{command:item.command}}:item.prompt?{input:{prompt:item.prompt}}:{}),
  ...(item.aggregated_output!==undefined?{output:item.aggregated_output}:item.output!==undefined?{output:item.output}:item.result!==undefined?{output:item.result}:item.changes!==undefined?{output:item.changes}:item.contentItems!=null?{output:item.contentItems}:item.agentsStates?{output:item.agentsStates}:item.text?{output:item.text}:item.items!==undefined?{output:item.items}:item.message!==undefined?{output:item.message}:{}),
  ...(item.error?{error:item.error}:{}),...(item.sender_thread_id?{parentId:item.sender_thread_id}:{}),...(item.receiver_thread_ids?{receivers:item.receiver_thread_ids}:{}),
  detail:item.aggregated_output || item.output || item.result || item.error || item.changes || '',exitCode:item.exit_code};
}

const printable=value=>typeof value==='string'?value:JSON.stringify(value,null,2);
const statuses={in_progress:'执行中',completed:'已完成',failed:'失败',stopped:'已停止',interrupted:'状态未确认',pending:'等待中',paused:'已暂停'};
export function renderActivities(container,activities=[]){
 if(!activities.length)return;
 const list=document.createElement('div');list.className='runtime-activities';
 for(const activity of activities){
  const row=document.createElement('details');row.className='runtime-activity';row.dataset.status=activity.status;row.dataset.activityId=activity.id || '';
  const summary=document.createElement('summary'),icon=document.createElement('wa-icon'),title=document.createElement('span'),status=document.createElement('span'),arrow=document.createElement('wa-icon');
  icon.src='assets/icons/'+(activity.icon==='terminal'?'square-terminal':activity.icon || 'activity')+'.svg';
  const parts=(activity.title || activity.toolName || '工具调用').split(' · '),operation=parts.shift(),target=parts.join(' · ');
  const verb=({'运行命令':'运行','读取文件':'读取','搜索文件':'搜索','搜索网页':'搜索','列出文件':'列出','修改文件':'修改','调用工具':'调用','查看图片':'查看','生成图片':'生成','协作任务':'执行','使用技能':'使用技能','读取技能':'读取技能','委派任务':'委派任务','子任务':'执行子任务'})[operation] || operation;
  title.className='runtime-activity-title';title.textContent=(activity.status==='in_progress'?'正在'+verb:activity.status==='failed'?verb+'失败':activity.status==='stopped'?'已停止'+verb:activity.status==='interrupted'?verb+'状态未确认':activity.status==='pending'?'等待'+verb:activity.status==='paused'?'已暂停'+verb:activity.status==='completed'?'已'+verb:verb)+(target?' '+target:'');title.title=title.textContent;
  status.className='runtime-activity-status';status.textContent=(statuses[activity.status] || '状态未知')+(Number.isFinite(activity.durationMs)?' · '+(activity.durationMs/1000).toFixed(1)+' 秒':'');
  arrow.src='assets/icons/chevron-right.svg';arrow.className='runtime-activity-chevron';arrow.setAttribute('aria-hidden','true');summary.append(icon,title,status,arrow);row.append(summary);
  const shell=activity.type==='command_execution';row.open=activity.userExpanded ?? (shell && activity.status==='in_progress');
  summary.addEventListener('click',()=>{activity.userExpanded=!row.open;row.dispatchEvent(new CustomEvent('reasoning-toggle',{bubbles:true}));});
  const panel=document.createElement('div');panel.className=shell?'runtime-shell':'runtime-activity-detail';
  const heading=document.createElement('div');heading.className='runtime-shell-label';heading.textContent=shell?'Shell':activity.type==='skill_use'?'技能调用':activity.type==='skill_read'?'技能文件':activity.type==='agent_task'?'子任务':'工具调用';panel.append(heading);
  const meta=[activity.provider==='claude'?'Claude':activity.provider==='codex'?'Codex':activity.provider==='deepseek'?'DeepSeek':null,activity.server,activity.toolName].filter(Boolean);
  const parent=activities.find(item=>item.id===activity.parentId);if(activity.parentId)meta.push(parent?'来自：'+parent.title:'子任务内调用');
  if(meta.length){const node=document.createElement('div');node.className='runtime-activity-meta';node.textContent=meta.join(' · ');panel.append(node);}
  const section=(label,value,className='')=>{
   if(value===undefined || value===null)return;
   const caption=document.createElement('div');caption.className='runtime-activity-caption';caption.textContent=label;
   const pre=document.createElement('pre'),code=document.createElement('code');code.className=className;
   const text=printable(value) ?? '';code.textContent=text.length>120000?text.slice(0,120000)+'\n（内容较长，仅展示前 120000 个字符）':text;
   pre.append(code);panel.append(caption,pre);return code;
  };
  if(shell){
   const command=activity.command || activity.input?.command || target;if(command)section('命令','$ '+command,'runtime-shell-command');
  }else section('参数',activity.input);
  if(activity.progress)section('进度',activity.progress);
  if(activity.currentTool)section('当前工具',activity.currentTool);
  const output=activity.changes?.length?'已获取文件变更信息，请展开下方差异预览。':activity.output ?? activity.detail;
  const result=section('结果',output!==undefined && output!==''?output:activity.status==='in_progress'?'等待输出…':'运行时未返回结果内容','runtime-shell-output');
  if(activity.error!==undefined)section('错误',activity.error);
  if(activity.outputFile)section('结果文件',activity.outputFile);
  if(activity.receivers?.length)section('参与会话',activity.receivers);
  if(Number.isFinite(activity.exitCode)){const exit=document.createElement('div');exit.className='runtime-shell-exit';exit.textContent='退出码：'+activity.exitCode;result?.append(document.createTextNode('\n\n'+exit.textContent));}
  renderFileDiffs(panel,activity);
  row.append(panel);list.append(row);
 }
 container.append(list);
}
