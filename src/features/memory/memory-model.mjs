import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import path from 'node:path';
export const memoryModel={id:'Xenova/paraphrase-multilingual-MiniLM-L12-v2',revision:'2c4055b12046f11709e9df2c122e59ffbdc2f900',dimensions:384,files:[
 {name:'config.json',size:673},
 {name:'tokenizer.json',size:17082913,sha256:'b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441'},
 {name:'tokenizer_config.json',size:496},
 {name:'special_tokens_map.json',size:280},
 {name:'onnx/model_quantized.onnx',size:118308126,sha256:'66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc'}
]};
export async function memoryModelReady(directory){try{const manifest=JSON.parse(await readFile(path.join(directory,'ready.json'),'utf8'));if(manifest.revision!==memoryModel.revision)return false;for(const f of memoryModel.files)if((await stat(path.join(directory,memoryModel.id,f.name))).size!==f.size)return false;return true;}catch{return false;}}
// Only static model asset URLs are requested. No memory or query is accepted here.
export async function installMemoryModel({directory,signal,onProgress=()=>{}}){
 let received=0;const total=memoryModel.files.reduce((n,f)=>n+f.size,0);
 for(const f of memoryModel.files){
  signal?.throwIfAborted();const target=path.join(directory,memoryModel.id,f.name);await mkdir(path.dirname(target),{recursive:true,mode:0o700});
  const response=await fetch('https://huggingface.co/'+memoryModel.id+'/resolve/'+memoryModel.revision+'/'+f.name,{signal});if(!response.ok)throw Error('语义模型下载失败（'+response.status+'）');
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>f.size)throw Error('语义模型文件大小不符');chunks.push(chunk);onProgress(Math.round((received+size)/total*100));}
  const data=Buffer.concat(chunks);if(size!==f.size||f.sha256&&createHash('sha256').update(data).digest('hex')!==f.sha256)throw Error('语义模型文件校验失败');await writeFile(target+'.tmp',data,{mode:0o600});await rename(target+'.tmp',target);received+=size;
 }
 await writeFile(path.join(directory,'ready.json.tmp'),JSON.stringify({id:memoryModel.id,revision:memoryModel.revision}),{mode:0o600});await rename(path.join(directory,'ready.json.tmp'),path.join(directory,'ready.json'));onProgress(100);
}
