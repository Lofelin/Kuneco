import {normalizeDocuments} from '../chat/document-attachments.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeDeepSeekInput} from './deepseek-runtime.mjs';

export function normalizeCodexInput(value){
 const documents=normalizeDocuments(typeof value==='object'?value.documents:[]);
 const input=normalizeDeepSeekInput(typeof value==='object'?{...value,documents:[],text:value.text|| (documents.length?'请查看附件。':'')}:value);
 for(const doc of documents)if(doc.kind==='pdf'&&!doc.pdfData)throw new Error('历史 PDF 未保存原文件，请重新添加附件');
 input.documents=documents;
 if(input.images.some(image=>image.url))throw new Error('Codex 请使用本地图片、粘贴或拖入图片');
 return input;
}

// Materialize only inside the selected execution environment. Never pass host paths to Docker.
export async function stageCodexImages(images,{exec}={}){
 if(!images.length)return {paths:[],cleanup:async()=>{}};
 let directory;
 const cleanup=async()=>{if(!directory)return;if(exec)await exec(['node','-e',"require('fs').rmSync(process.argv[1],{recursive:true,force:true})",directory]);else await rm(directory,{recursive:true,force:true});};
 try{
  directory=exec?(await exec(['node','-e',"process.stdout.write(require('fs').mkdtempSync('/tmp/dingtu-images-'))"])).trim():await mkdtemp(path.join(tmpdir(),'dingtu-images-'));
  const paths=[];
  for(const [i,image] of images.entries()){
   const [,format,data]=/^data:image\/(png|jpeg|gif|webp);base64,(.+)$/.exec(image.dataURL);
   const file=path.posix.join(directory,`${i}.${format}`);
   if(exec)await exec(['node','-e',"let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>require('fs').writeFileSync(process.argv[1],Buffer.from(s,'base64'),{mode:0o600}));",file],{input:data});
   else await writeFile(file,Buffer.from(data,'base64'),{mode:0o600});
   paths.push(file);
  }
  return {paths,cleanup};
 }catch(error){await cleanup().catch(()=>{});throw error;}
}
