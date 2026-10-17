import {readFile,stat} from 'node:fs/promises';
export async function readTextSnapshot(file){
 try{const info=await stat(file);if(!info.isFile()||info.size>65536)return {available:false,reason:'文件非普通文本文件或超过 64 KiB'};const bytes=await readFile(file);if(bytes.length>65536||bytes.includes(0))return {available:false,reason:'文件过大或为二进制'};return {available:true,exists:true,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};}
 catch(e){return e.code==='ENOENT'?{available:true,exists:false,text:''}:{available:false,reason:'无法读取文件快照'};}
}
