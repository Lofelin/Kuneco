import {readTextSnapshot} from './file-snapshot.mjs';
import {scanSkillCatalog,deepSeekSkills} from './context-catalog.mjs';
import {readdir,readFile,realpath,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {spawn} from 'node:child_process';

const MAX_OUTPUT=32000;
const within=(root,file)=>file===root || file.startsWith(root+path.sep);
const text=(value,name,max=50000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(name+' 无效');return value;};
const schema=(name,description,properties,required)=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
export async function createDeepSeekTools({cwd,home=homedir(),signal,onActivity=()=>{}}){
 const root=await realpath(cwd);const catalog=deepSeekSkills((await scanSkillCatalog({cwd:root,home})).entries);const skills=new Map(catalog.map(s=>[s.name,s]));
 const definitions=[
  schema('Skill','Load a named skill and follow its instructions using the available tools. Completion means instructions were loaded; subsequent commands have separate results. Available skills: '+JSON.stringify(catalog.map(({name,description})=>({name,description}))),{skill:{type:'string'},args:{type:'string'}},['skill']),
  schema('Read','Read a UTF-8 text file in the current project. Paths are relative to '+root+'.',{path:{type:'string'}},['path']),
  schema('Write','Write UTF-8 text to a file in the current project. Only perform changes requested by the user; parent directory must exist.',{path:{type:'string'},content:{type:'string'}},['path','content']),
  schema('Bash','Execute a shell command in the current project inside this environment container. Run only actions authorized by the user. Do not automatically retry commands with side effects. Inherit the current environment network route.',{command:{type:'string'},timeout_ms:{type:'integer',minimum:100,maximum:120000}},['command'])
 ];
 async function projectFile(value,write=false){const requested=path.resolve(root,text(value,'path',4096));let resolved;try{resolved=await realpath(requested);}catch(error){if(!write||error.code!=='ENOENT')throw error;resolved=path.join(await realpath(path.dirname(requested)),path.basename(requested));}if(!within(root,resolved))throw new Error('文件路径超出当前项目');return resolved;}
 async function bash(input,progress){
  const command=text(input.command,'command');const timeout=input.timeout_ms??120000;if(!Number.isInteger(timeout)||timeout<100||timeout>120000)throw new Error('timeout_ms 无效');
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
   const child=spawn('/bin/bash',['-c',command],{cwd:root,env:process.env,detached:true,stdio:['ignore','pipe','pipe']});
   let output='',truncated=false,timedOut=false,flush,killTimer;
   const kill=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}killTimer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},500);};
   const abort=()=>kill();signal?.addEventListener('abort',abort,{once:true});
   const timer=setTimeout(()=>{timedOut=true;kill();},timeout);
   const collect=chunk=>{if(output.length>=MAX_OUTPUT){truncated=true;return;}if(chunk.length>MAX_OUTPUT-output.length)truncated=true;if(output.length<MAX_OUTPUT)output+=chunk.slice(0,MAX_OUTPUT-output.length);else truncated=true;if(!flush)flush=setTimeout(()=>{flush=null;progress(output);},100);};
   child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',collect);child.stderr.on('data',collect);
   const cleanup=()=>{clearTimeout(timer);clearTimeout(flush);signal?.removeEventListener('abort',abort);};
   child.once('error',error=>{cleanup();clearTimeout(killTimer);reject(error);});
   child.once('close',(code,termination)=>{cleanup();if(!signal?.aborted&&!timedOut)clearTimeout(killTimer);const value={output:output+(truncated?'\n（输出已截断）':''),exitCode:code,...(termination?{signal:termination}:{}),...(timedOut?{error:'命令执行超时'}:{})};resolve(value);});
   if(signal?.aborted)abort();
  });
 }
 return {definitions,async execute(call){
  signal?.throwIfAborted();const name=call.function?.name;let input;
  const activity={id:call.id,provider:'deepseek',toolName:name,type:name==='Skill'?'skill_use':name==='Bash'?'command_execution':'tool_call',icon:name==='Skill'?'book-open':name==='Bash'?'terminal':name==='Write'?'pencil':'book-open',status:'in_progress'};
  const started=Date.now();
  try{input=JSON.parse(call.function.arguments||'{}');if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('工具参数必须是对象');
   activity.input=input;activity.title=({Skill:'使用技能',Bash:'运行命令',Read:'读取文件',Write:'修改文件'})[name]+' · '+(input.skill||input.command||input.path||name);if(name==='Bash')activity.command=input.command;
   onActivity(activity);let result;
   if(name==='Skill'){const skill=skills.get(text(input.skill,'skill',80));if(!skill||!catalog.includes(skill))throw new Error('技能不存在：'+input.skill);const source=await readFile(skill.file,'utf8');if(source.length>65536)throw new Error('技能文件过大');result={skill:skill.name,baseDirectory:path.dirname(skill.file),instructions:source,note:'技能指令已加载；请按指令继续执行，实际操作结果由后续工具返回。'};}
   else if(name==='Read'){const file=await projectFile(input.path);if((await stat(file)).size>MAX_OUTPUT)throw new Error('文件过大，请使用 Bash 按范围读取');result={path:file,content:await readFile(file,'utf8')};}
   else if(name==='Write'){const file=await projectFile(input.path,true);if(typeof input.content!=='string'||input.content.length>200000)throw new Error('content 无效或过大');signal?.throwIfAborted();const before=await readTextSnapshot(file);await writeFile(file,input.content);const after=await readTextSnapshot(file);result={path:file,writtenBytes:Buffer.byteLength(input.content),changes:[before.available&&after.available?{path:file,before:before.text,after:after.text}:{path:file,unavailable:before.reason||after.reason}]};}
   else if(name==='Bash')result=await bash(input,output=>onActivity({...activity,output,durationMs:Date.now()-started}));
   else throw new Error('未知工具：'+name);
   const failed=Boolean(result.error)||name==='Bash'&&result.exitCode!==0;
   onActivity({...activity,status:signal?.aborted?'stopped':failed?'failed':'completed',output:name==='Bash'?result.output:result,...(result.changes?{changes:result.changes}:{}),...(name==='Bash'?{exitCode:result.exitCode}:{}),...(result.error?{error:result.error}:{}),durationMs:Date.now()-started});
   return JSON.stringify({...result,...(signal?.aborted?{error:'执行已停止，不要自动重试'}:{})});
  }catch(error){const message=String(error.message).slice(0,2000);onActivity({...activity,title:activity.title||'调用工具 · '+(name||'未知工具'),status:signal?.aborted?'stopped':'failed',error:message,output:message,durationMs:Date.now()-started});return JSON.stringify({error:message});}
 }};
}
