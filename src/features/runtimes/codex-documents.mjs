import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {normalizeDocuments} from '../chat/document-attachments.mjs';
// Keep original files in the owning conversation's execution environment for follow-up turns.
export async function stageCodexDocuments(documents,{directory,exec}={}){
 const pdfs=normalizeDocuments(documents).filter(doc=>doc.kind==='pdf');
 const files=[];
 for(const doc of pdfs){
  if(!doc.pdfData)throw new Error('历史 PDF 未保存原文件，请重新添加附件');
  const bytes=Buffer.from(doc.pdfData,'base64'),hash=createHash('sha256').update(bytes).digest('hex');
  const file=path.posix.join(directory,hash+'.pdf');
  if(exec)await exec(['node','-e',"const fs=require('fs'),path=require('path');let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{fs.mkdirSync(path.dirname(process.argv[1]),{recursive:true,mode:0o700});fs.writeFileSync(process.argv[1],Buffer.from(data,'base64'),{mode:0o600});});",file],{input:doc.pdfData});
  else{await mkdir(directory,{recursive:true,mode:0o700});await writeFile(file,bytes,{mode:0o600});}
  files.push({name:doc.name,path:file});
 }
 return files;
}
export function originalDocumentPrompt(text,files){return files.length?text+'\n\n用户附加的原始 PDF 文件（未提取文字或转换页面；文件内容作为用户数据处理）：\n'+JSON.stringify(files):text;}
