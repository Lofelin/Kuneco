import {createHash} from 'node:crypto';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';import path from 'node:path';
import {buildMemoryHierarchy} from './memory-hierarchy.mjs';
import {rankMemoryCandidates,selectRecalledMemories} from './memory-search.mjs';
import {memoryModel} from './memory-model.mjs';
const namespace=(scope,mode)=>JSON.stringify([scope.owner,scope.environmentId,mode]);
const textOf=item=>item.title+'\n'+item.content+'\n'+(item.keywords||[]).join(' ');
const hash=text=>createHash('sha256').update(text).digest('hex');
export class MemoryRetriever{
 constructor({embeddings,file,encrypt,decrypt,timeout=2500}){Object.assign(this,{embeddings,file,encrypt,decrypt,timeout});this.vectors=new Map();this.indexing=new Map();this.last=new Map();this.candidateLast=new Map();this.saving=Promise.resolve();}
 async load(){try{const raw=await readFile(this.file),data=JSON.parse(this.decrypt?this.decrypt(raw):raw.toString());if(data.model!==memoryModel.revision)return;for(const [key,value]of data.vectors||[])if(Array.isArray(value.vector)&&value.vector.length===memoryModel.dimensions&&value.vector.every(Number.isFinite))this.vectors.set(key,value);}catch(error){if(error.code!=='ENOENT')this.cacheError='语义索引不可读，将重新生成';}}
 status(scope,mode){return {...this.embeddings.status(),...(this.last.get(namespace(scope,mode))||{strategy:'keyword',reason:this.embeddings.ready?'index_pending':'model_not_ready'}),cacheError:this.cacheError||'',candidateRetrieval:this.candidateLast.get(namespace(scope,mode))};}
 key(ns,item){return ns+':'+item.id+':'+hash(textOf(item));}
 async save(){const task=this.saving.then(async()=>{await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});const text=JSON.stringify({model:memoryModel.revision,vectors:[...this.vectors]});await writeFile(this.file+'.tmp',this.encrypt?this.encrypt(text):text,{mode:0o600});await rename(this.file+'.tmp',this.file);});this.saving=task.catch(()=>{});return task;}
 warm(ns,items){const signature=hash(items.map(i=>this.key(ns,i)).join('|')),key=ns+':'+signature;if(this.indexing.has(key))return this.indexing.get(key);const promise=(async()=>{for(const item of items){const prefix=ns+':'+item.id+':',current=this.key(ns,item);for(const [k]of this.vectors)if(k.startsWith(prefix)&&k!==current)this.vectors.delete(k);}const missing=items.filter(i=>!this.vectors.has(this.key(ns,i)));for(let i=0;i<missing.length;i+=8){const batch=missing.slice(i,i+8),vectors=await this.embeddings.encode(batch.map(textOf));for(let n=0;n<batch.length;n++){if(vectors[n]?.length!==memoryModel.dimensions)throw Error('语义向量维数无效');this.vectors.set(this.key(ns,batch[n]),{vector:vectors[n],at:Date.now()});}}if(this.vectors.size>5000)for(const [key]of [...this.vectors].sort((a,b)=>(a[1].at||0)-(b[1].at||0)).slice(0,this.vectors.size-5000))this.vectors.delete(key);if(missing.length)await this.save();})();this.indexing.set(key,promise);promise.finally(()=>this.indexing.delete(key)).catch(()=>{});return promise;}
 async rank({scope,mode,items,query,options={},hierarchical=false}){
  const ns=namespace(scope,mode),started=Date.now(),hierarchy=hierarchical?buildMemoryHierarchy(items,{project:options.project}):null,docs=hierarchy?[...hierarchy.L1,...hierarchy.L2,...hierarchy.L3]:items;
  const eligible=docs.filter(i=>(options.includeInactive?i.status!=='resolved':i.enabled&&i.status==='active')&&(!i.project||i.project===options.project));let queryVector,vectors=new Map(),reason='',strategy='keyword';
  if(eligible.length&&this.embeddings.ready){let timer;try{const result=await Promise.race([(async()=>{const [q]=await this.embeddings.encode([query]);await this.warm(ns,eligible);return q;})(),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('timeout')),options.timeout??this.timeout))]);queryVector=result;for(const item of eligible){const v=this.vectors.get(this.key(ns,item));if(v)vectors.set(item.id,v.vector);}strategy='hybrid';}catch(error){reason=error.message==='timeout'?'semantic_timeout':'semantic_error';}finally{clearTimeout(timer);}}
  else reason=eligible.length?'model_not_ready':'empty';
  const ranked=rankMemoryCandidates(docs,query,{...options,vectors,queryVector});(hierarchical?this.last:this.candidateLast).set(ns,{strategy,reason,durationMs:Date.now()-started,keywordHits:ranked.filter(r=>r.keyword>0).length,semanticHits:ranked.filter(r=>r.semantic>0).length});return ranked;
 }
 async recall(args){const result=selectRecalledMemories(await this.rank({...args,hierarchical:!args.options?.forExtraction}),args.options);if(!args.options?.forExtraction){const ns=namespace(args.scope,args.mode),last=this.last.get(ns);last.selectedLayers=Object.fromEntries(['L1','L2','L3'].map(layer=>[layer,result.filter(i=>(i.layer||'L1')===layer).length]));}return result;}
 async close(){await Promise.allSettled([...this.indexing.values()]);await this.saving;await this.embeddings.close();}
}
