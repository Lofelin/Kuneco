import {readFile,mkdtemp,writeFile,copyFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
// Gateway images contain code only. Worker images, volumes and credentials are untouched.
export async function gatewayImage(manager,baseImage,engine){
 if(!['native','gost','mihomo'].includes(engine))throw new Error('未知代理内核');
 if(!/^[a-zA-Z0-9][a-zA-Z0-9./:@_-]*$/.test(baseImage))throw new Error('无效网关基础镜像');
 const base=JSON.parse(await manager.command(['image','inspect','--format','{{json .}}',baseImage]));
 const files=['src/features/proxy/proxy.mjs','src/features/proxy/gost-sidecar.mjs','src/features/proxy/mihomo-sidecar.mjs','src/features/proxy/subscription-node.mjs','src/features/proxy/request-lifecycle.mjs','docker/runtime/gateway.mjs','docker/runtime/control.mjs'];
 const contents=await Promise.all(files.map(file=>readFile(path.join(manager.sourceRoot,file))));
 const binary=engine!=='native'?path.join(manager.sourceRoot,'vendor',engine,'linux_'+base.Architecture,engine):null;
 let binaryBytes;if(binary){try{binaryBytes=await readFile(binary);}catch{throw new Error('缺少容器代理内核，请先运行对应安装脚本，平台 linux_'+base.Architecture);}}
 const hash=createHash('sha256').update(base.Id).update(engine);for(const data of contents)hash.update(data);if(binaryBytes)hash.update(binaryBytes);
 const tag='kuneco-gateway:'+hash.digest('hex').slice(0,20);
 try{await manager.command(['image','inspect',tag]);return tag;}catch{}
 const dir=await mkdtemp(path.join(tmpdir(),'kuneco-gateway-build-'));
 try{
  for(let i=0;i<files.length;i++)await writeFile(path.join(dir,path.basename(files[i])),contents[i]);
  if(binary)await copyFile(binary,path.join(dir,engine));
  await writeFile(path.join(dir,'Dockerfile'),`FROM ${base.Id}\nWORKDIR /opt/dingtu\nCOPY proxy.mjs gost-sidecar.mjs mihomo-sidecar.mjs subscription-node.mjs request-lifecycle.mjs gateway.mjs control.mjs ./\n${binary?`COPY ${engine} /usr/local/bin/${engine}\nRUN chmod 755 /usr/local/bin/${engine}\n`:''}`);
  await manager.command(['build','-t',tag,dir],{timeout:120000});return tag;
 }finally{await rm(dir,{recursive:true,force:true});}
}
