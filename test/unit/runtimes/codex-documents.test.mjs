import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {stageCodexDocuments,originalDocumentPrompt} from '../../../src/features/runtimes/codex-documents.mjs';
import {normalizeCodexInput} from '../../../src/features/runtimes/codex-images.mjs';
import {normalizeDeepSeekInput} from '../../../src/features/runtimes/deepseek-runtime.mjs';
import {readChatDocument,documentPrompt} from '../../../src/features/chat/document-attachments.mjs';
const bytes=Buffer.from('%PDF-1.7\noriginal scan bytes without a text layer');
const file={name:'扫描件.pdf',type:'application/pdf',size:bytes.length,arrayBuffer:async()=>bytes};
test('PDF import preserves original bytes without requiring a text layer',async()=>{
 const doc=await readChatDocument(file);assert.equal(doc.text,'');assert.deepEqual(Buffer.from(doc.pdfData,'base64'),bytes);
 assert.equal(documentPrompt('read',[{...doc,text:'old extracted text'}]),'read');
 const input=normalizeCodexInput({text:'',documents:[doc]});assert.equal(input.documents[0].pdfData,doc.pdfData);
 assert.throws(()=>normalizeDeepSeekInput({text:'read',documents:[doc]}),/不支持 PDF 原文件/);
});
test('Codex stages exact bytes locally and sends file references without extracted text',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'kuneco-pdf-test-'));
 try{const doc=await readChatDocument(file),files=await stageCodexDocuments([doc],{directory});assert.deepEqual(await readFile(files[0].path),bytes);assert.equal(files[0].name,file.name);assert.ok(originalDocumentPrompt('read',files).includes(files[0].path));assert.ok(!originalDocumentPrompt('read',files).includes(doc.pdfData));}finally{await rm(directory,{recursive:true,force:true});}
});
test('container staging sends bytes on stdin and only environment-local paths',async()=>{
 const calls=[],doc=await readChatDocument(file);
 const files=await stageCodexDocuments([doc],{directory:'/workspace/.kuneco-attachments/chat-a',exec:async(args,options)=>calls.push({args,options})});
 assert.ok(files[0].path.startsWith('/workspace/'));assert.equal(calls[0].options.input,doc.pdfData);
 assert.throws(()=>normalizeCodexInput({text:'read',documents:[{...doc,pdfData:undefined,text:'legacy'}]}),/重新添加/);
});
