import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
export async function readArtifact(file){
 if(!path.isAbsolute(file)||file.includes('\0'))throw new Error('产物路径无效');
 if((await stat(file)).size>2*1024*1024)throw new Error('文件超过 2 MiB，暂不支持内嵌预览');
 const bytes=await readFile(file);const ext=path.extname(file).toLowerCase();
 const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}[ext];
 if(mime)return {kind:'image',dataURL:'data:'+mime+';base64,'+bytes.toString('base64')};
 if(bytes.includes(0))throw new Error('此二进制文件暂不支持预览');
 return {kind:['.html','.htm'].includes(ext)?'html':ext==='.md'?'markdown':'text',text:bytes.toString('utf8')};
}
