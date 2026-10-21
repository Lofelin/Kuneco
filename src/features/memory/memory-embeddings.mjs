import {Worker} from 'node:worker_threads';
import {memoryModel,memoryModelReady,installMemoryModel} from './memory-model.mjs';
export class LocalMemoryEmbeddings{
 constructor({directory,notify=()=>{}}){Object.assign(this,{directory,notify});this.ready=false;this.pending=new Map();this.sequence=0;this.progress=0;this.error='';this.installing=null;}
 async load(){this.ready=await memoryModelReady(this.directory);}
 status(){return {ready:this.ready,installing:Boolean(this.installing),progress:this.progress,error:this.error,model:memoryModel.id,dimensions:memoryModel.dimensions};}
 async install(){if(this.ready)return;if(this.installing)return this.installing;this.error='';this.installing=installMemoryModel({directory:this.directory,onProgress:value=>{if(value!==this.progress){this.progress=value;this.notify();}}}).then(()=>{this.ready=true;}).catch(error=>{this.error=error.message;throw error;}).finally(()=>{this.installing=null;this.notify();});this.notify();return this.installing;}
 async encode(texts){if(!this.ready)throw Error('本机语义模型尚未准备');if(!this.worker){const worker=this.worker=new Worker(new URL('./memory-embedding-worker.mjs',import.meta.url),{execArgv:[],workerData:{directory:this.directory}});worker.unref();worker.on('message',value=>{const pending=this.pending.get(value.id);if(!pending)return;this.pending.delete(value.id);value.error?pending.reject(Error(value.error)):pending.resolve(value.vectors);});worker.on('error',error=>this.fail(error));worker.on('exit',()=>{if(this.worker===worker){this.worker=null;this.fail(Error('语义编码进程已退出'));}});}
  const id=++this.sequence;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({id,texts});});
 }
 fail(error){this.error=error.message;for(const p of this.pending.values())p.reject(error);this.pending.clear();this.notify();}
 async close(){const worker=this.worker;this.worker=null;this.fail(Error('语义编码已停止'));await worker?.terminate();}
}
