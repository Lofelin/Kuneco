import {readdir,readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {spawn} from 'node:child_process';
const inside=(root,file)=>file===root||file.startsWith(root+path.sep);
export async function scanSkillCatalog({cwd,home=homedir()}){
 const root=await realpath(cwd),entries=[],warnings=[];
 for(const [scope,base] of [['user',home],['project',root]])for(const location of ['.codex/skills','.agents/skills','.claude/skills']){
  const directory=path.join(base,location);let files;try{files=await readdir(directory,{withFileTypes:true});}catch(e){if(e.code!=='ENOENT')warnings.push(directory+'：'+e.code);continue;}
  for(const entry of files.sort((a,b)=>a.name.localeCompare(b.name)).slice(0,100)){
   if(!entry.isDirectory())continue;try{const file=await realpath(path.join(directory,entry.name,'SKILL.md'));if(!inside(await realpath(directory),file))continue;if((await stat(file)).size>65536){warnings.push(file+'：技能文件超过 64 KiB');continue;}
    const source=await readFile(file,'utf8'),front=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)?.[1]||'';
    const field=key=>{const lines=front.split(/\r?\n/),index=lines.findIndex(line=>line.startsWith(key+':'));if(index<0)return;const value=lines[index].slice(key.length+1).trim();if(/^[>|][-+]?$/.test(value)){const body=[];for(let i=index+1;i<lines.length&&(/^[ \t]/.test(lines[i])||!lines[i]);i++)body.push(lines[i].trim());return body.join(value[0]==='>'?' ':'\n').trim();}return value.replace(/^["']|["']$/g,'');};const name=field('name')||entry.name;if(!/^[a-zA-Z0-9_-]{1,80}$/.test(name)){warnings.push(file+'：技能名称无效');continue;}
    entries.push({name,description:(field('description')||name).slice(0,500),file,path:file,scope,location,invocable:field('user-invocable')!=='false'});
   }catch(e){if(e.code!=='ENOENT')warnings.push(directory+'/'+entry.name+'：'+e.code);}
  }
 }
 return {entries:[...new Map(entries.map(s=>[s.path,s])).values()],warnings};
}
export function deepSeekSkills(entries){return [...new Map(entries.map(s=>[s.name,s])).values()].slice(0,100);}
async function codexSkills(cwd,executable){
 return new Promise((resolve,reject)=>{const child=spawn(executable||'codex',['app-server','--listen','stdio://'],{cwd,stdio:['pipe','pipe','pipe']});let buffer='',done=false;
  const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);child.stdin.end();child.kill();err?reject(err):resolve(value);};
  const timer=setTimeout(()=>finish(new Error('Codex 技能列表读取超时')),10000);const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
  child.on('error',()=>finish(new Error('Codex 运行时不可用')));child.on('close',()=>{if(!done)finish(new Error('Codex 未返回技能列表'));});child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>2000000)return finish(new Error('Codex 技能列表过大'));let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let e;try{e=JSON.parse(line);}catch{continue;}if(e.id===1){if(e.error)return finish(new Error(e.error.message));send({method:'initialized'});send({id:2,method:'skills/list',params:{cwds:[cwd],forceReload:true}});}if(e.id===2)finish(e.error?new Error(e.error.message):null,e.result);}});
  send({id:1,method:'initialize',params:{clientInfo:{name:'kuneco',title:'Kuneco',version:'0.1.0'},capabilities:{experimentalApi:false}}});
 });
}
export async function listChatContext({cwd,engine,kind='skills',query='',home=homedir(),executable}){
 const root=await realpath(cwd);
 if(kind==='files'){
  const files=[],queue=[root];let visited=0,truncated=false;const ignored=new Set(['.git','node_modules','.next','dist','build','.cache','.codex','.claude','.agents']);
  while(queue.length&&visited<3000){const dir=queue.shift();let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{continue;}for(const e of entries.sort((a,b)=>a.name.localeCompare(b.name))){if(++visited>3000){truncated=true;break;}if(e.isSymbolicLink()||ignored.has(e.name)||/^\.env(?:\.|$)|credentials|^id_rsa|^id_ed25519/i.test(e.name))continue;const file=path.join(dir,e.name);if(e.isDirectory()){if(path.relative(root,file).split(path.sep).length<7)queue.push(file);}else if(e.isFile()&&path.relative(root,file).toLowerCase().includes(query.toLowerCase())){files.push({name:e.name,path:file,description:path.relative(root,file),enabled:true});if(files.length>=100){truncated=true;queue.length=0;break;}}}}
  return {items:files,warnings:truncated?['仅显示前 100 个匹配项或前 3000 个扫描条目，请输入更具体的路径。']:[],root};
 }
 const catalog=await scanSkillCatalog({cwd:root,home});let items;
 if(engine==='deepseek'){const selected=deepSeekSkills(catalog.entries);items=catalog.entries.map(s=>({...s,enabled:selected.includes(s)&&s.invocable,reason:!s.invocable?'技能禁止手动调用':!selected.includes(s)?'被同名技能覆盖或超出运行时注册上限':''}));}
 else if(engine==='cc')items=catalog.entries.map(s=>({...s,enabled:s.location==='.claude/skills'&&s.invocable,reason:s.location!=='.claude/skills'?'Claude Code 不从此目录加载技能':!s.invocable?'技能禁止手动调用':''}));
 else if(engine==='codex'){
  const result=await codexSkills(root,executable);const native=result.data?.flatMap(x=>x.skills||[])||[];items=native.map(s=>({...s,enabled:s.enabled!==false,path:s.path,reason:s.enabled===false?'运行时已禁用此技能':''}));
  for(const s of catalog.entries)if(!items.some(n=>n.path===s.path))items.push({...s,enabled:false,reason:'当前 Codex 运行时未加载此技能'});
  catalog.warnings.push(...(result.data||[]).flatMap(x=>(x.errors||[]).map(e=>e.message||String(e))));
 }else items=catalog.entries.map(s=>({...s,enabled:false,reason:'当前运行时不支持技能'}));
 return {root,items:items.filter(s=>(s.name+' '+s.description).toLowerCase().includes(query.toLowerCase())),warnings:catalog.warnings};
}

export function reconcileClaudeSkills(items,commands){
 const selected=new Map();for(const item of items)if(item.location==='.claude/skills'&&item.invocable)selected.set(item.name,item);
 const names=new Set(commands.map(c=>c.name));const result=items.map(item=>({...item,enabled:names.has(item.name)&&selected.get(item.name)===item,reason:!names.has(item.name)?'当前 Claude 运行时未加载此技能':selected.get(item.name)!==item?'当前运行时使用其他目录中的同名技能':''}));
 for(const command of commands)if(!selected.has(command.name))result.push({name:command.name,description:command.description,path:null,scope:'runtime',enabled:true});
 return result;
}
