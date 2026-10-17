import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile,access} from 'node:fs/promises';

const root=new URL('../../../',import.meta.url);
test('source root stays an entry point and relative module imports resolve after moves',async()=>{
 const files=await readdir(new URL('src/',root),{withFileTypes:true});
 assert.deepEqual(files.filter(f=>f.isFile()).map(f=>f.name),['index.html']);
 for(const name of await readdir(new URL('src/',root),{recursive:true})){
  if(name.startsWith('vendor/')||!/[.](mjs|cjs|js)$/.test(name))continue;
  const file=new URL('src/'+name,root),source=await readFile(file,'utf8');
  for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*|\brequire\(\s*|\bimport\(\s*)['"]([.][.]?\/[^'"]+)['"]/g)){
   await assert.doesNotReject(access(new URL(match[1],file)),name+' -> '+match[1]);
   const target=new URL(match[1],file).pathname;
   if(name.startsWith('shared/'))assert.doesNotMatch(target,/\/src\/(features|app)\//,name);
   if(name.startsWith('features/'))assert.doesNotMatch(target,/\/src\/app\//,name);
  }
 }
});
