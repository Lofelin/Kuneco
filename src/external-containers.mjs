import {access,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
export const containerKey=(endpoint,id)=>digest(endpoint+'\n'+id);
const claimFile=(manager,key)=>path.join(manager.directory,'external-claims',key);
export async function listExternalContainers(manager,owner){
 if(!owner)throw new Error('请先登录');
 const endpoints=new Map([[manager.endpoint,'应用引擎']]);
 for(const [file,label] of [[path.join(homedir(),'.docker','run','docker.sock'),'Docker Desktop'],['/var/run/docker.sock','Docker'],[path.join(homedir(),'.colima','default','docker.sock'),'Colima']])try{await access(file);endpoints.set('unix://'+file,label);}catch{}
 try{const rows=await manager.command(['context','ls','--format','{{json .}}']);for(const row of rows.split('\n')){try{const item=JSON.parse(row);if(item.DockerEndpoint?.startsWith('unix://')){await access(item.DockerEndpoint.slice(7));if(!endpoints.has(item.DockerEndpoint))endpoints.set(item.DockerEndpoint,item.Name);}}catch{}}}catch{}
 const results=[],seen=new Set(),ownPrefix='dingtu-'+digest(owner).slice(0,12)+'-';
 for(const [endpoint,engine] of endpoints){try{
  const rows=await manager.command(['ps','-a','--no-trunc','--format','{{json .}}'],{endpoint,timeout:8000});
  for(const row of rows.split('\n')){try{const item=JSON.parse(row);if(!/^[a-f0-9]{64}$/.test(item.ID))continue;
   const name=String(item.Names);if(name.startsWith('dingtu-') && (!name.startsWith(ownPrefix)||name.endsWith('-gateway')))continue;
   // Engine aliases can expose the same Docker daemon twice.
   if(seen.has(item.ID))continue;seen.add(item.ID);
   const key=containerKey(endpoint,item.ID);let claim;try{claim=await readFile(claimFile(manager,digest(item.ID)),'utf8');}catch{}
   if(claim && claim!==digest(owner))continue;
   results.push({key,id:item.ID,name,image:item.Image || '',running:item.State==='running',engine,endpoint});
  }catch{}}
 }catch{}}
 return results;
}
export async function inspectExternal(manager,owner,key){
 const item=(await listExternalContainers(manager,owner)).find(item=>item.key===key);if(!item)throw new Error('该容器已不可用或属于其他账号，请重新选择');
 const raw=JSON.parse(await manager.command(['inspect',item.id],{endpoint:item.endpoint}))[0];
 return {...item,workingDirectory:raw.Config?.WorkingDir?.startsWith('/')?raw.Config.WorkingDir:'/',networkMode:raw.HostConfig?.NetworkMode || 'default'};
}
export async function claimExternal(manager,owner,item){
 const file=claimFile(manager,digest(item.id));await mkdir(path.dirname(file),{recursive:true,mode:0o700});
 try{await writeFile(file,digest(owner),{flag:'wx',mode:0o600});return true;}catch(error){if(error.code!=='EEXIST')throw error;if(await readFile(file,'utf8')!==digest(owner))throw new Error('该容器已关联其他账号');return false;}
}
export async function releaseExternal(manager,owner,item){const file=claimFile(manager,digest(item.id));try{if(await readFile(file,'utf8')===digest(owner))await rm(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
