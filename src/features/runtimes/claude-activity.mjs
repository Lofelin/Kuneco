// Adapt SDK events only. A content_block_stop ends arguments, not execution.
export function createClaudeActivityAdapter(){
 const blocks=new Map(),calls=new Map(),hiddenTasks=new Set();
 const call=(id,name,input,parentId)=>{
  const skill=name==='Skill',readSkill=name==='Read' && /(?:^|[/\\])SKILL\.md$/i.test(input?.file_path || '');
  const shell=name==='Bash',mcp=name.startsWith('mcp__');
  const target=skill?input?.skill:readSkill?input.file_path:shell?input?.command:input?.file_path || input?.pattern || input?.query || input?.url || '';
  const label=skill?'使用技能':readSkill?'读取技能':shell?'运行命令':name==='Read'?'读取文件':['Edit','Write'].includes(name)?'修改文件':['Agent','Task'].includes(name)?'委派任务':'调用工具';
  const value={id,type:skill?'skill_use':readSkill?'skill_read':shell?'command_execution':mcp?'mcp_tool_call':'tool_call',provider:'claude',toolName:name,icon:skill||readSkill?'book-open':shell?'terminal':mcp?'plug':['Agent','Task'].includes(name)?'bot':'activity',title:label+' · '+(target || name),status:'in_progress',input,parentId:parentId || null,...(shell?{command:input?.command || ''}:{})};
  calls.set(id,{...calls.get(id),...value});return value;
 };
 return message=>{
  if(message.skip_transcript){if(message.task_id)hiddenTasks.add(message.task_id);return [];}
  if(hiddenTasks.has(message.task_id))return [];
  const out=[],parent=message.parent_tool_use_id || null;
  if(message.type==='stream_event'){
   const event=message.event,key=`${parent || 'root'}:${event.index}`;
   if(event.type==='content_block_start' && event.content_block?.type==='tool_use'){
    const block=event.content_block;if(!block.id || !block.name)return out;
    blocks.set(key,{id:block.id,name:block.name,input:block.input || {},json:''});out.push(call(block.id,block.name,block.input || {},parent));
   }else if(event.type==='content_block_delta' && event.delta?.type==='input_json_delta'){
    const block=blocks.get(key);if(block){block.json+=event.delta.partial_json;try{block.input=JSON.parse(block.json);out.push(call(block.id,block.name,block.input,parent));}catch{/* Partial JSON is not an executable input yet. */}}
   }else if(event.type==='content_block_stop')blocks.delete(key);
  }else if(message.type==='assistant'){
   for(const block of message.message?.content || [])if(block.type==='tool_use' && block.id && block.name)out.push(call(block.id,block.name,block.input || {},parent));
  }else if(message.type==='user'){
   for(const result of message.message?.content || [])if(result.type==='tool_result' && result.tool_use_id){
    const known=calls.get(result.tool_use_id);
    out.push({...(known || {id:result.tool_use_id,type:'tool_call',provider:'claude',icon:'activity',title:'工具结果'}),status:result.is_error?'failed':'completed',output:result.content,...(result.is_error?{error:result.content}:{}),parentId:known?.parentId || parent});
   }
  }else if(message.type==='tool_progress' && message.tool_use_id){
   out.push({...calls.get(message.tool_use_id),id:message.tool_use_id,type:calls.get(message.tool_use_id)?.type || 'tool_call',provider:'claude',title:calls.get(message.tool_use_id)?.title || `调用工具 · ${message.tool_name}`,icon:calls.get(message.tool_use_id)?.icon || 'activity',status:'in_progress',durationMs:message.elapsed_time_seconds*1000,parentId:parent});
  }else if(message.type==='system' && message.subtype==='task_updated' && message.task_id){
   const known=calls.get(`task:${message.task_id}`) || {},patch=message.patch || {};
   if(patch.description)known.description=patch.description;calls.set(`task:${message.task_id}`,known);
   out.push({id:`task:${message.task_id}`,type:'agent_task',provider:'claude',icon:'bot',title:'子任务 · '+(known.description || message.task_id),...(patch.status?{status:({running:'in_progress',killed:'stopped'})[patch.status] || patch.status}:{}),...(patch.error?{error:patch.error}:{})});
  }else if(message.type==='system' && ['task_started','task_progress','task_notification'].includes(message.subtype) && message.task_id){
   if(message.description)calls.set(`task:${message.task_id}`,{description:message.description});
   out.push({id:`task:${message.task_id}`,type:'agent_task',provider:'claude',icon:'bot',title:'子任务 · '+(message.description || calls.get(`task:${message.task_id}`)?.description || message.task_id),status:message.subtype==='task_notification'?message.status:'in_progress',parentId:message.tool_use_id || parent,taskId:message.task_id,...(message.usage?.duration_ms!==undefined?{durationMs:message.usage.duration_ms}:{}),...(message.summary!==undefined?{output:message.summary}:{}),...(message.last_tool_name?{currentTool:message.last_tool_name}:{}),...(message.output_file?{outputFile:message.output_file}:{})});
  }
  return out;
 };
}
