import {parentPort,workerData} from 'node:worker_threads';
import {env,pipeline} from '@huggingface/transformers';
import {memoryModel} from './memory-model.mjs';
env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath=workerData.directory;
// Inference is deliberately offline even if an upstream default changes.
globalThis.fetch=async()=>{throw Error('本机语义编码禁止网络请求');};
let extractor,queue=Promise.resolve();
parentPort.on('message',message=>{queue=queue.then(async()=>{try{extractor??=await pipeline('feature-extraction',memoryModel.id,{local_files_only:true,dtype:'q8',device:'cpu',session_options:{intraOpNumThreads:2,interOpNumThreads:1}});const output=await extractor(message.texts,{pooling:'mean',normalize:true,truncation:true,max_length:256});parentPort.postMessage({id:message.id,vectors:output.tolist()});}catch(error){parentPort.postMessage({id:message.id,error:error.message});}});});
