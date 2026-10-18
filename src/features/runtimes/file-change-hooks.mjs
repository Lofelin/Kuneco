import path from 'node:path';
export function createFileChangeHooks({cwd,snapshot,onActivity}){
 const before=new Map();
 const pre=async input=>{if(!input.tool_use_id||typeof input.tool_input?.file_path!=='string')return {};const file=path.resolve(input.cwd||cwd,input.tool_input.file_path);try{before.set(input.tool_use_id,{file,value:await snapshot(file)});}catch{before.set(input.tool_use_id,{file,value:{available:false,reason:'无法读取修改前快照'}});}return {};};
 const post=async input=>{const previous=before.get(input.tool_use_id);before.delete(input.tool_use_id);if(!previous)return {};let after;try{after=await snapshot(previous.file);}catch{after={available:false,reason:'无法读取修改后快照'};}const change=previous.value.available&&after.available?{path:previous.file,before:previous.value.text,after:after.text,beforeExists:previous.value.exists,afterExists:after.exists}:{path:previous.file,unavailable:previous.value.reason||after.reason};onActivity({id:input.tool_use_id,provider:'claude',type:'tool_call',toolName:input.tool_name,icon:'pencil',title:'修改文件 · '+previous.file,status:'completed',changes:[change]});return {};};
 const failure=async input=>{before.delete(input.tool_use_id);return {};};
 return {PreToolUse:[{matcher:'Edit|Write',hooks:[pre]}],PostToolUse:[{matcher:'Edit|Write',hooks:[post]}],PostToolUseFailure:[{matcher:'Edit|Write',hooks:[failure]}]};
}
