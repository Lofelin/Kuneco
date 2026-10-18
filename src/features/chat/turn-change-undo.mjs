import {constants} from 'node:fs';
import {lstat,realpath,open,unlink,rename,link} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const MAX_FILES=100,MAX_BYTES=20*1024*1024;
const fail=(code,message)=>Object.assign(new Error(message),{code});
const missing=error=>error.code==='ENOENT';

/** Undo a server-owned batch only while every file still matches its after snapshot. */
export async function undoTurnChanges({root,files}={}){
 const applied=[],backups=[],recovery=[],rollback={restored:[],conflicts:[],errors:[]};
 let base,entries;
 async function safeLocation(target){
  const relative=path.relative(base,target);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw fail('UNSAFE_PATH','文件路径超出项目目录');
  let cursor=base;
  // Check the root again as well as every parent immediately before each operation.
  for(const part of ['',...relative.split(path.sep).slice(0,-1)]){
   if(part)cursor=path.join(cursor,part);
   const stat=await lstat(cursor);
   if(stat.isSymbolicLink()||!stat.isDirectory())throw fail('UNSAFE_PATH','项目目录或文件父目录不是普通目录');
   if(await realpath(cursor)!==cursor)throw fail('UNSAFE_PATH','文件路径含符号链接');
  }
 }
 async function read(entry){
  await safeLocation(entry.target);
  let stat;
  try{stat=await lstat(entry.target);}catch(error){if(missing(error))return {exists:false,text:'',mode:null};throw error;}
  if(stat.isSymbolicLink()||!stat.isFile())throw fail('UNSAFE_PATH','只能撤销普通文件，不能撤销符号链接');
  if(stat.size>MAX_BYTES)throw fail('CONFLICT','当前文件已超过快照大小限制');
  const handle=await open(entry.target,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const actual=await handle.stat();
   if(actual.dev!==stat.dev||actual.ino!==stat.ino)throw fail('CONFLICT','文件在读取时发生变化');
   const bytes=await handle.readFile();
   if(bytes.length>MAX_BYTES)throw fail('CONFLICT','当前文件已超过快照大小限制');
   return {exists:true,text:bytes.toString('utf8'),bytes,mode:actual.mode&0o7777};
  }finally{await handle.close();}
 }
 function matches(actual,exists,text){return actual.exists===exists&&(!exists||actual.bytes.equals(Buffer.from(text,'utf8')));}
 async function expect(entry,exists,text){const actual=await read(entry);if(!matches(actual,exists,text))throw fail('CONFLICT',`文件已有后续修改：${entry.path}`);return actual;}
 async function replace(entry,expectedExists,expectedText,nextExists,nextText,mode){
  const actual=await expect(entry,expectedExists,expectedText);
  const temporary=path.join(path.dirname(entry.target),`.kuneco-undo-${randomUUID()}.tmp`);
  let created=false,captured=null;
  try{
   if(nextExists){
    await safeLocation(entry.target);
    const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,mode??actual.mode??0o666);created=true;
    try{await handle.writeFile(nextText,'utf8');if(mode!=null||actual.mode!=null)await handle.chmod(mode??actual.mode);await handle.sync();}finally{await handle.close();}
   }
   await expect(entry,expectedExists,expectedText);
   await safeLocation(entry.target);
   if(expectedExists){
    const backup=path.join(path.dirname(entry.target),`.kuneco-undo-${randomUUID()}.backup`);
    await rename(entry.target,backup);
    captured={path:entry.path,backup};backups.push(captured);
    // Validate the captured inode, not a pathname that another process can replace.
    await expect({...entry,target:backup},true,expectedText);
   }
   if(nextExists){
    await safeLocation(entry.target);
    try{await link(temporary,entry.target);}catch(error){if(error.code==='EEXIST')throw fail('CONFLICT',`文件已有后续修改：${entry.path}`);throw error;}
   }else await expect(entry,false,'');
  }catch(error){
   if(captured){
    try{
     await safeLocation(entry.target);
     // Keep every captured inode: an editor may still hold and write its old fd.
     const saved=await lstat(captured.backup);
     if(!saved.isFile()||saved.isSymbolicLink())throw fail('UNSAFE_PATH','捕获内容不是普通文件');
     await link(captured.backup,entry.target);
    }catch(restoreError){recovery.push({...captured,message:restoreError.message});}
   }
   throw error;
  }finally{if(created)await unlink(temporary).catch(()=>{});}
 }

 try{
  if(typeof root!=='string'||!path.isAbsolute(root))throw fail('INVALID_BATCH','必须提供项目绝对目录');
  const normalized=path.resolve(root),rootStat=await lstat(normalized);
  if(rootStat.isSymbolicLink()||!rootStat.isDirectory())throw fail('UNSAFE_PATH','项目目录必须是普通目录');
  base=await realpath(normalized);
  if(base!==normalized)throw fail('UNSAFE_PATH','项目目录不能经过符号链接');
  if(!Array.isArray(files)||!files.length||files.length>MAX_FILES)throw fail('INVALID_BATCH','撤销批次数量必须为 1 至 100 个文件');
  let bytes=0;const seen=new Set();
  entries=files.map(file=>{
   if(!file||typeof file.path!=='string'||!file.path||file.path.includes('\0')||typeof file.before!=='string'||typeof file.after!=='string'||typeof file.beforeExists!=='boolean'||typeof file.afterExists!=='boolean')throw fail('INVALID_BATCH','缺少完整文件快照或存在性元数据');
   if((!file.beforeExists&&file.before!=='')||(!file.afterExists&&file.after!=='')||(!file.beforeExists&&!file.afterExists))throw fail('INVALID_BATCH','文件快照与存在性元数据不一致');
   bytes+=Buffer.byteLength(file.before)+Buffer.byteLength(file.after);
   if(bytes>MAX_BYTES)throw fail('INVALID_BATCH','撤销快照总量超过 20 MiB');
   const target=path.resolve(base,file.path),relative=path.relative(base,target);
   if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw fail('UNSAFE_PATH','文件路径超出项目目录');
   if(seen.has(target))throw fail('INVALID_BATCH','撤销批次含重复文件');seen.add(target);
   return {...file,target};
  });
  for(const entry of entries)await expect(entry,entry.afterExists,entry.after);
  for(const entry of entries){
   const actual=await expect(entry,entry.afterExists,entry.after);
   await replace(entry,entry.afterExists,entry.after,entry.beforeExists,entry.before,actual.mode);
   applied.push({...entry,mode:actual.mode});
  }
  return {ok:true,restored:applied.length,backups,recovery};
 }catch(error){
  for(const entry of applied.reverse()){
   try{await replace(entry,entry.beforeExists,entry.before,entry.afterExists,entry.after,entry.mode);rollback.restored.push(entry.path);}
   catch(undoError){if(undoError.code==='CONFLICT'||undoError.code==='UNSAFE_PATH')rollback.conflicts.push(entry.path);else rollback.errors.push({path:entry.path,message:undoError.message});}
  }
  return {ok:false,code:error.code||'UNDO_FAILED',message:error.message,rollback,backups,recovery};
 }
}
