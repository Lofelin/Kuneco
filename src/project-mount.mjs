import path from 'node:path';
import {homedir} from 'node:os';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {validateProjectImport} from './project-files.mjs';
import {workerArguments} from './docker-environments.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function mountLocalProject(docker,owner,id,selected,{configFile=path.join(homedir(),'.colima','dingtu','colima.yaml'),manifestFile=path.join(docker.directory,'project-mounts.json')}={}){
 const source=await validateProjectImport(selected),{item,prefix}=await docker.get(owner,id);
 if(item.external)throw new Error('已有外部容器请在其原配置中添加挂载；此入口仅管理Kuneco创建的环境');
 if(/[,:\n\r]/.test(source))throw new Error('挂载路径不能包含逗号、冒号或换行');
 const worker=prefix+'-worker',gateway=prefix+'-gateway';
 const running=(await docker.command(['ps','--format','{{.Names}}'])).split('\n').filter(Boolean);
 if(running.some(name=>name!==worker && name!==gateway))throw new Error('接入本机目录需要重启引擎，请先停止其他运行中的环境或容器');

 let manifest={paths:[],configHash:null};try{manifest=JSON.parse(await readFile(manifestFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const config=await readFile(configFile,'utf8');
 if(manifest.configHash?hash(config)!==manifest.configHash:!/^mounts:\s*(?:null|\[\])\s*$/m.test(config))throw new Error('引擎挂载配置已在应用外更改，请先核对配置，避免覆盖已有共享目录');
 const mounts=item.projectMounts || [],existing=mounts.find(m=>m.source===source);
 if(existing)return existing.target;
 const target='/workspace/projects/'+path.basename(source)+'-'+randomUUID().slice(0,8),next=[...mounts,{source,target}];
 // This is the only point that changes host access; the UI explains it before selection.
 const colima=await docker.binary('colima'),env={...process.env,PATH:path.dirname(colima)+':'+(process.env.PATH || '/usr/bin:/bin')};
 if(!manifest.paths.includes(source)){
  await docker.engineProcess(colima,['stop','dingtu'],{timeout:120000,env});
  const paths=[...manifest.paths,source];
  try{await docker.engineProcess(colima,['start','dingtu','--activate=false',...paths.flatMap(p=>['--mount',p+':w'])],{timeout:600000,env});}
  catch(error){await docker.engineProcess(colima,['start','dingtu','--activate=false',...(manifest.paths.length?manifest.paths.flatMap(p=>['--mount',p+':w']):['--mount','none'])],{timeout:600000,env}).catch(()=>{});throw error;}
  await mkdir(docker.directory,{recursive:true});await writeFile(manifestFile,JSON.stringify({paths,configHash:hash(await readFile(configFile,'utf8'))}),{mode:0o600});
 }
 await docker.command(['start',gateway]);
 const info=JSON.parse(await docker.command(['inspect',worker]))[0],network=info.HostConfig.NetworkMode;
 const gatewayIP=await docker.command(['inspect','--format',`{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,gateway]);
 const oldEnv=Object.fromEntries(info.Config.Env.map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)];}));
 const backup=worker+'-before-mount-'+randomUUID().slice(0,8);
 await docker.command(['stop','-t','3',worker]);await docker.command(['rename',worker,backup]);
 try{
  await docker.command(workerArguments({name:worker,network,gatewayIP,proxyURL:oldEnv.HTTP_PROXY,image:item.imageName,projectMounts:next}));
  await docker.update(owner,id,{projectMounts:next});
 }catch(error){
  await docker.command(['rm','-f',worker]).catch(()=>{});await docker.command(['rename',backup,worker]);await docker.command(['start',worker]);throw error;
 }
 await docker.command(['rm',backup]); // Volumes are deliberately retained.
 return target;
}
