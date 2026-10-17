import {readFile,mkdtemp,writeFile,copyFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
// Gateway images contain code only. Worker images, volumes and credentials are untouched.
export async function gatewayImage(manager,baseImage,engine){
 if(!['native','gost'].includes(engine))throw new Error('未知代理内核');
 if(!/^[a-zA-Z0-9][a-zA-Z0-9./:@_-]*$/.test(baseImage))throw new Error('无效网关基础镜像');
 const base=JSON.parse(await manager.command(['image','inspect','--format','{{json .}}',baseImage]));
 const files=['src/features/proxy/proxy.mjs','src/features/proxy/gost-sidecar.mjs','docker/runtime/gateway.mjs','docker/runtime/control.mjs'];
 const contents=await Promise.all(files.map(file=>readFile(path.join(manager.sourceRoot,file))));
 const binary=engine==='gost'?path.join(manager.sourceRoot,'vendor','gost','linux_'+base.Architecture,'gost'):null;
 let binaryBytes;if(binary){try{binaryBytes=await readFile(binary);}catch{throw new Error('缺少GOST容器内核，请先运行 node scripts/setup/install-gost.mjs linux_'+base.Architecture);}}
 const hash=createHash('sha256').update(base.Id).update(engine);for(const data of contents)hash.update(data);if(binaryBytes)hash.update(binaryBytes);
 const tag='kuneco-gateway:'+hash.digest('hex').slice(0,20);
 try{await manager.command(['image','inspect',tag]);return tag;}catch{}
 const dir=await mkdtemp(path.join(tmpdir(),'kuneco-gateway-build-'));
 try{
  for(let i=0;i<files.length;i++)await writeFile(path.join(dir,path.basename(files[i])),contents[i]);
  if(binary)await copyFile(binary,path.join(dir,'gost'));
  await writeFile(path.join(dir,'Dockerfile'),`FROM ${baseImage}\nWORKDIR /opt/dingtu\nCOPY proxy.mjs gost-sidecar.mjs gateway.mjs control.mjs ./\n${binary?'COPY gost /usr/local/bin/gost\nRUN chmod 755 /usr/local/bin/gost\n':''}`);
  await manager.command(['build','-t',tag,dir],{timeout:120000});return tag;
 }finally{await rm(dir,{recursive:true,force:true});}
}
