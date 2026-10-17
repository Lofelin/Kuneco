import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {lstat,readdir,readFile,realpath,readlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

// Reject links to files outside the selected tree; never silently copy extra host data.
export async function validateProjectImport(selected){
 if(typeof selected!=='string' || !path.isAbsolute(selected))throw new Error('请选择有效目录');
 const root=await realpath(selected);if(!(await lstat(root)).isDirectory())throw new Error('请选择文件夹');
 async function visit(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
   const file=path.join(dir,entry.name);
   if(entry.isSymbolicLink()){if(path.isAbsolute(await readlink(file)))throw new Error('包含绝对符号链接，请改为目录内相对链接：'+path.relative(root,file));const target=await realpath(file);if(target!==root && !target.startsWith(root+path.sep))throw new Error('包含指向目录外的符号链接：'+path.relative(root,file));}
   else if(entry.isDirectory())await visit(file);
   else if(entry.name==='.git'){const value=await readFile(file,'utf8');if(/^gitdir:/m.test(value))throw new Error('检测到 Git worktree 或子模块引用，请先整理为独立仓库后导入，避免丢失 Git 历史');}
  }
 }
 await visit(root);return root;
}
const directoryScript=`const fs=require('fs'),p=require('path');const root=fs.realpathSync(process.argv[1]),current=fs.realpathSync(process.argv[2]||root);if(current!==root&&!current.startsWith(root+'/'))throw Error('目录超出当前环境工作区');if(!fs.statSync(current).isDirectory())throw Error('请选择目录');const entries=fs.readdirSync(current,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>({name:e.name,path:p.join(current,e.name),directory:true})).sort((a,b)=>a.name.localeCompare(b.name));console.log(JSON.stringify({directory:current,parent:current===root?root:p.dirname(current),entries}));`;
export async function browseEnvironmentProject(docker,owner,id,directory){
 const root=await docker.workingDirectory(owner,id);
 return JSON.parse(await docker.exec(owner,id,['node','-e',directoryScript,root,directory || root]));
}
export async function selectEnvironmentProject(docker,owner,id,directory){
 return (await browseEnvironmentProject(docker,owner,id,directory)).directory;
}
export async function importEnvironmentProject(docker,owner,id,selected){
 const source=await validateProjectImport(selected),{item,prefix}=await docker.get(owner,id);
 const root=await docker.workingDirectory(owner,id),parent=path.posix.join(root,'imports');
 const target=path.posix.join(parent,path.basename(source)+'-'+randomUUID().slice(0,8));
 await docker.exec(owner,id,['mkdir','-p',parent]);
 const container=item.external?.id || prefix+'-worker';
 await docker.exec(owner,id,['mkdir','-p',target]);
 if(docker.copyProject)await docker.copyProject(source,container,target);
 else await streamProjectArchive(docker,container,source,target,item.external?.endpoint || docker.endpoint);
 return target;
}
export async function streamProjectArchive(docker,container,source,target,endpoint){
 const binary=await docker.binary('docker');
 const archive=spawn('/usr/bin/tar',['-C',source,'-cf','-','.'],{stdio:['ignore','pipe','pipe']});
 const extract=spawn(binary,['--host',endpoint,'exec','-i','--user','1000:1000',container,'tar','--no-same-owner','-xf','-','-C',target],{env:{...process.env,DOCKER_HOST:'',DOCKER_CONTEXT:docker.context},stdio:['pipe','ignore','pipe']});
 const exited=(child,label)=>new Promise((resolve,reject)=>{let tail='';child.stderr.on('data',data=>tail=(tail+data).slice(-1000));child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(label+'失败：'+tail)));});
 try{await Promise.all([exited(archive,'打包文件夹'),exited(extract,'导入环境'),pipeline(archive.stdout,extract.stdin)]);}
 catch(error){archive.kill();extract.kill();throw error;}
}
