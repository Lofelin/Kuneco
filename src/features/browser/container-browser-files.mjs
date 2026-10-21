import {EventEmitter} from 'node:events';

// Scripts run only inside the account/environment browser container. No file
// bytes or host paths cross the desktop process. /workspace is a named volume.
export const containerFileScript=String.raw`
const fs=require('fs'),p=require('path'),crypto=require('crypto');
const [action,raw]=process.argv.slice(1),data=JSON.parse(raw);
function workspace(value){if(typeof value!=='string'||value.includes('\0')||!p.isAbsolute(value))throw Error('请输入容器内绝对路径');const target=p.normalize(value);if(target!=='/workspace'&&!target.startsWith('/workspace/'))throw Error('仅支持当前环境 /workspace 内的文件');return target;}
function directory(value){const target=workspace(value),parts=target.split('/').slice(2);let fd=fs.openSync('/workspace',fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{for(const part of parts){const child='/proc/self/fd/'+fd+'/'+part;try{fs.mkdirSync(child,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}let next;try{next=fs.openSync(child,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);}catch{throw Error('文件目录无效或包含符号链接');}fs.closeSync(fd);fd=next;}if(fs.realpathSync('/proc/self/fd/'+fd)!==target)throw Error('保存目录已变化');return fd;}catch(error){fs.closeSync(fd);throw error;}}
if(action==='upload'){
 const source=workspace(data.path),fd=fs.openSync(source,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const real=fs.realpathSync('/proc/self/fd/'+fd),stat=fs.fstatSync(fd);if(!real.startsWith('/workspace/')||!stat.isFile())throw Error('请选择当前环境中的普通文件');if(stat.size>512*1024*1024)throw Error('上传文件不能超过 512 MB');
 const dir='/home/browser/uploads/'+crypto.randomUUID();fs.mkdirSync(dir,{recursive:true,mode:0o700});const dest=p.join(dir,p.basename(source));fs.copyFileSync('/proc/self/fd/'+fd,dest,fs.constants.COPYFILE_EXCL);fs.chmodSync(dest,0o400);process.stdout.write(JSON.stringify(dest));}finally{fs.closeSync(fd);}
}else if(action==='save'){
 if(!/^[a-f0-9-]{36}$/i.test(data.guid))throw Error('无效下载标识');const target=workspace(data.path),dir=p.dirname(target),source='/home/browser/downloads/'+data.guid;
 const fd=fs.openSync(source,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{if(!fs.fstatSync(fd).isFile())throw Error('下载文件类型无效');const parent=directory(dir);
 try{if(fs.realpathSync('/proc/self/fd/'+parent)!==dir)throw Error('保存目录已变化');const anchored='/proc/self/fd/'+parent,temp=p.join(anchored,'.kuneco-'+crypto.randomUUID()+'.part');
 try{fs.copyFileSync('/proc/self/fd/'+fd,temp,fs.constants.COPYFILE_EXCL);fs.chmodSync(temp,0o600);fs.linkSync(temp,p.join(anchored,p.basename(target)));}finally{fs.rmSync(temp,{force:true});}fs.unlinkSync(source);process.stdout.write(JSON.stringify(target));}finally{fs.closeSync(parent);}}finally{fs.closeSync(fd);}
}else if(action==='cleanup'){
 for(const dir of ['/home/browser/downloads','/home/browser/uploads']){fs.mkdirSync(dir,{recursive:true,mode:0o700});for(const name of fs.readdirSync(dir)){if(/^[a-f0-9-]{36}(?:\.crdownload)?$/i.test(name))fs.rmSync(p.join(dir,name),{recursive:true,force:true});}}
}else if(action==='remove'){
 if(!/^[a-f0-9-]{36}$/i.test(data.guid))throw Error('无效下载标识');for(const suffix of ['','.crdownload'])fs.rmSync('/home/browser/downloads/'+data.guid+suffix,{force:true});
}else throw Error('未知容器文件操作');
`;
export async function runContainerFile(engine,action,data){engine.assertCurrent();const result=await engine.manager.command(['exec','--user','1000:1000',engine.name,'node','-e',containerFileScript,action,JSON.stringify(data)],{timeout:300000});if(action!=='save')engine.assertCurrent();return result?JSON.parse(result):null;}
class ContainerDownload extends EventEmitter {
 constructor(files,event,wc){super();Object.assign(this,{files,event,wc,containerNative:true,received:0,total:0,state:'progressing',destination:'',finished:false});this.destinationReady=new Promise(resolve=>this.resolveDestination=resolve);}
 getFilename(){return this.event.suggestedFilename||'download';}getURL(){return this.event.url;}getReceivedBytes(){return this.received;}getTotalBytes(){return this.total;}getSavePath(){return this.destination;}isPaused(){return false;}canResume(){return false;}
 setSavePath(value){if(!value.startsWith('/workspace/')||value.includes('\0'))throw Error('下载仅支持当前环境 /workspace 内的路径');this.destination=value;this.resolveDestination(value);}
 pause(){throw Error('容器下载暂不支持暂停，请取消后重新下载');}resume(){throw Error('容器下载暂不支持续传');}
 cancel(){if(this.saving)return false;if(this.finished)return;this.finished=true;this.resolveDestination(false);void this.files.engine.command('Browser.cancelDownload',{guid:this.event.guid}).catch(()=>{});void runContainerFile(this.files.engine,'remove',{guid:this.event.guid}).catch(()=>{});this.emit('done',{},'cancelled');this.files.items.delete(this.event.guid);}
 async progress(event){if(this.finished||this.saving)return;if(event.receivedBytes>512*1024*1024||event.totalBytes>512*1024*1024){this.failure='下载文件不能超过 512 MB';this.cancel();return;}this.received=event.receivedBytes;this.total=event.totalBytes;this.emit('updated',{},'progressing');if(event.state==='inProgress')return;
 if(event.state!=='completed'){this.cancel();return;}
 const destination=await this.destinationReady;if(!destination||this.finished)return;
 try{this.saving=true;this.emit('updated',{},'saving');await runContainerFile(this.files.engine,'save',{guid:this.event.guid,path:destination});if(this.finished)return;this.finished=true;this.emit('done',{},'completed');}catch(error){this.failure=error.message;this.finished=true;this.emit('done',{},'interrupted');void runContainerFile(this.files.engine,'remove',{guid:this.event.guid}).catch(()=>{});}finally{this.files.items.delete(this.event.guid);}
 }
}
export class ContainerBrowserFiles {
 constructor(engine,{findContents,onDownload}){Object.assign(this,{engine,findContents,onDownload});this.items=new Map();this.listener=event=>{void this.handle(event).catch(()=>{});};engine.on('event',this.listener);engine.once('closed',()=>{for(const item of this.items.values())item.cancel();engine.off('event',this.listener);});}
 async enable(){await runContainerFile(this.engine,'cleanup',{});await this.engine.command('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:'/home/browser/downloads',eventsEnabled:true});}
 async upload(contents,details,path){const destination=await runContainerFile(this.engine,'upload',{path});if(contents.destroyed)throw Error('标签已关闭');await this.engine.command('DOM.setFileInputFiles',{backendNodeId:details.backendNodeId,files:[destination]},details.cdpSessionId||contents.sessionId);}
 async handle({method,params}){if(method==='Browser.downloadWillBegin'){
  const wc=this.findContents(params.frameId);if(this.items.size>=3||!wc||!wc.allowed(wc.getURL())||!/^https?:|^blob:/.test(params.url)){await this.engine.command('Browser.cancelDownload',{guid:params.guid});void runContainerFile(this.engine,'remove',{guid:params.guid}).catch(()=>{});return;}
  const item=new ContainerDownload(this,params,wc);this.items.set(params.guid,item);try{this.onDownload(item,wc);}catch{item.cancel();}
 }else if(method==='Browser.downloadProgress')await this.items.get(params.guid)?.progress(params);}
}
