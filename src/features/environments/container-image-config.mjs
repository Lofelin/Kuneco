import {createHash} from 'node:crypto';
export const DEFAULT_IMAGE_CONFIG=Object.freeze({version:'22-bookworm-slim',repository:'docker.io/library/node'});
export function imageConfiguration(input={}){
 const version=input.version ?? DEFAULT_IMAGE_CONFIG.version,repository=typeof (input.repository ?? DEFAULT_IMAGE_CONFIG.repository)==='string'?(input.repository ?? DEFAULT_IMAGE_CONFIG.repository).trim():null;
 if(!['22-bookworm-slim','24-bookworm-slim'].includes(version))throw new Error('请选择支持的镜像版本');
 if(typeof repository!=='string' || repository.length>200 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?\/(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(repository))throw new Error('镜像来源需为仓库路径，例如 registry.example.com/library/node，不包含协议或密码');
 const config={version,repository};
 return {...config,baseImage:repository+':'+version,imageName:version===DEFAULT_IMAGE_CONFIG.version && repository===DEFAULT_IMAGE_CONFIG.repository?'dingtu-runtime:3-clean':'dingtu-runtime:3-'+version.split('-')[0]+'-'+createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0,10)};
}
export class ImageDownloadProgress{
 constructor(){this.layers=new Map();this.known=new Set();this.cached=new Set();}
 update(event){
  if(event.error)throw new Error('镜像下载失败：'+String(event.error).replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s@]+@/gi,'$1***@').slice(0,300));
  if(event.id && ['Pulling fs layer','Downloading','Download complete','Pull complete','Already exists','Extracting'].includes(event.status))this.known.add(event.id);
  if(event.id && event.status==='Already exists')this.cached.add(event.id);
  const detail=event.progressDetail;
  if(event.id && event.status==='Downloading' && detail && Number.isFinite(detail.total) && detail.total>0)this.layers.set(event.id,{current:Math.max(0,Math.min(detail.current || 0,detail.total)),total:detail.total});
  if(event.id && ['Download complete','Pull complete'].includes(event.status) && this.layers.has(event.id)){const layer=this.layers.get(event.id);layer.current=layer.total;}
  const entries=[...this.layers.values()],current=entries.reduce((sum,l)=>sum+l.current,0),total=entries.reduce((sum,l)=>sum+l.total,0);
  return {current,total,percent:total && [...this.known].every(id=>this.layers.has(id) || this.cached.has(id))?Math.min(100,Math.floor(current/total*100)):null};
 }
}
