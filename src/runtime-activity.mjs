export function codexActivity(event){
 if(!['item.started','item.updated','item.completed'].includes(event.type) || !event.item)return null;
 const item=event.item,type=item.type;
 if(['agent_message','reasoning','user_message'].includes(type))return null;
 const rawStatus=event.type==='item.started'?'in_progress':event.type==='item.completed'?(item.status==='failed' || item.status==='declined'?'failed':'completed'):(item.status || 'in_progress');
 const status=rawStatus==='inProgress'?'in_progress':rawStatus==='declined'?'failed':rawStatus;
 const labels={command_execution:['terminal','运行命令'],file_change:['pencil','修改文件'],web_search:['search','搜索网页'],webSearch:['search','搜索网页'],mcp_tool_call:['plug','调用工具'],image_view:['image','查看图片'],image_viewer:['image','查看图片'],image_generation:['image','生成图片'],collab_tool_call:['bot','协作任务']};
 let [icon,label]=labels[type] || ['activity',item.name || type || '运行时活动'];
 const action=item.commandActions?.[0];if(action?.type==='read'){icon='book-open';label='读取文件';}else if(action?.type==='search'){icon='search';label='搜索文件';}else if(action?.type==='listFiles'){icon='folder';label='列出文件';}
 const target=action?.path || item.command || item.query || item.tool || item.path || item.name || '';
 return {id:String(item.id || type),type,command:item.command || '',icon,title:label+(target?' · '+target:''),status,detail:item.aggregated_output || item.output || item.result || item.error || item.changes || item.arguments || '',exitCode:item.exit_code};
}

export function renderActivities(container,activities=[]){
 if(!activities.length)return;
 const list=document.createElement('div');list.className='runtime-activities';
 for(const activity of activities){
  const row=document.createElement('details');row.className='runtime-activity';row.dataset.status=activity.status;
  const summary=document.createElement('summary'),icon=document.createElement('wa-icon'),title=document.createElement('span'),arrow=document.createElement('wa-icon');
  icon.src='assets/icons/'+(activity.icon==='terminal'?'square-terminal':activity.icon)+'.svg';
  const parts=activity.title.split(' · '),operation=parts.shift(),target=parts.join(' · ');
  const verb=({'运行命令':'运行','读取文件':'读取','搜索文件':'搜索','搜索网页':'搜索','列出文件':'列出','修改文件':'修改','调用工具':'调用','查看图片':'查看','生成图片':'生成','协作任务':'执行'})[operation] || operation;
  title.textContent=(activity.status==='in_progress'?'正在'+verb:activity.status==='failed'?verb+'失败':'已'+verb)+(target?' '+target:'');
  arrow.src='assets/icons/chevron-right.svg';arrow.className='runtime-activity-chevron';arrow.setAttribute('aria-hidden','true');
  summary.append(icon,title,arrow);row.append(summary);
  const shell=activity.type==='command_execution';if(shell)row.open=activity.status==='in_progress';
  const panel=document.createElement('div');panel.className=shell?'runtime-shell':'runtime-activity-detail';
  const heading=document.createElement('div');heading.className='runtime-shell-label';heading.textContent=shell?'Shell':'详情';panel.append(heading);
  const body=document.createElement('pre'),code=document.createElement('code');
  if(shell){const command=activity.command || activity.title.split(' · ').slice(1).join(' · ');if(command){const prompt=document.createElement('span');prompt.className='runtime-shell-command';prompt.textContent='$ '+command+'\n';code.append(prompt);}}
  const output=document.createElement('span');output.className='runtime-shell-output';output.textContent=(typeof activity.detail==='string'?activity.detail:JSON.stringify(activity.detail,null,2)) || (activity.status==='in_progress'?'等待输出…':'运行时未返回详情');code.append(output);
  if(activity.exitCode!==undefined){const exit=document.createElement('span');exit.className='runtime-shell-exit';exit.textContent='\n\n退出码：'+activity.exitCode;code.append(exit);}
  body.append(code);if(shell && activity.status==='in_progress')queueMicrotask(()=>body.scrollTop=body.scrollHeight);panel.append(body);row.append(panel);list.append(row);
 }
 container.append(list);
}
