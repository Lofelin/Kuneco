import path from 'node:path';
import {mkdir,rm} from 'node:fs/promises';

export function createContainerDownloads({docker,directory}) {
 const run=(scope,source,args=[],options={})=>docker.exec(scope.owner,scope.environmentId,['node','-e',source,...args],options);
 return {
  async directory(scope){return run(scope,"require('fs').mkdirSync('/workspace/Download',{recursive:true});process.stdout.write('/workspace/Download')");},
  async save(scope,source,target){
   if(!path.posix.isAbsolute(target)||target.includes('\0'))throw Error('请输入容器内的绝对路径');
   // Stream into a private sibling, then link atomically without overwriting existing files.
   await run(scope,`const fs=require('fs'),p=require('path'),{pipeline}=require('stream/promises');(async()=>{const target=process.argv[1],tmp=target+'.'+require('crypto').randomUUID()+'.part';fs.mkdirSync(p.dirname(target),{recursive:true});try{await pipeline(process.stdin,fs.createWriteStream(tmp,{flags:'wx',mode:0o600}));fs.linkSync(tmp,target);}finally{fs.rmSync(tmp,{force:true});}})().catch(e=>{console.error(e.message);process.exitCode=1;});`,[target],{inputFile:source,timeout:300000});
  },
  async export(scope,target,id){
   const local=path.join(directory,id,path.posix.basename(target));await mkdir(path.dirname(local),{recursive:true,mode:0o700});
   const {prefix,item}=await docker.get(scope.owner,scope.environmentId);
   try{await docker.command(['cp',(item.external?.id||prefix+'-worker')+':'+target,local],{...(item.external?{endpoint:item.external.endpoint}:{}),timeout:300000});return local;}catch(error){await rm(path.dirname(local),{recursive:true,force:true});throw error;}
  }
 };
}
