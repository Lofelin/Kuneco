import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,stat,chmod,symlink,mkdir,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {undoTurnChanges} from '../../../src/features/chat/turn-change-undo.mjs';

async function fixture(t){const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'kuneco-undo-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
const change=(name,before,after,beforeExists=true,afterExists=true)=>({path:name,before,after,beforeExists,afterExists});

test('restores modified, created, deleted and empty files while retaining current permissions',async t=>{
 const root=await fixture(t);await writeFile(path.join(root,'modified'),'after');await chmod(path.join(root,'modified'),0o640);await writeFile(path.join(root,'created'),'');await writeFile(path.join(root,'empty-before'),'nonempty');
 const result=await undoTurnChanges({root,files:[change('modified','before','after'),change('created','','',false,true),change('deleted','restored','',true,false),change('empty-before','','nonempty')]});
 assert.equal(result.ok,true);assert.equal(result.restored,4);assert.equal(result.backups.length,3);assert.deepEqual(result.recovery,[]);assert.equal(await readFile(path.join(root,'modified'),'utf8'),'before');assert.equal((await stat(path.join(root,'modified'))).mode&0o777,0o640);assert.equal(await readFile(path.join(root,'deleted'),'utf8'),'restored');assert.equal(await readFile(path.join(root,'empty-before'),'utf8'),'');await assert.rejects(stat(path.join(root,'created')),{code:'ENOENT'});assert.equal((await readdir(root)).some(name=>name.endsWith('.tmp')),false);
});

test('prechecks all snapshots before writing and rejects subsequent edits on repeated undo',async t=>{
 const root=await fixture(t);await writeFile(path.join(root,'a'),'after');await writeFile(path.join(root,'b'),'external');
 const result=await undoTurnChanges({root,files:[change('a','before','after'),change('b','before','after')]});assert.equal(result.code,'CONFLICT');assert.equal(await readFile(path.join(root,'a'),'utf8'),'after');assert.deepEqual(result.rollback.restored,[]);
 await writeFile(path.join(root,'b'),'after');assert.equal((await undoTurnChanges({root,files:[change('b','before','after')]})).ok,true);await writeFile(path.join(root,'b'),'later edit');assert.equal((await undoTurnChanges({root,files:[change('b','before','after')]})).code,'CONFLICT');assert.equal(await readFile(path.join(root,'b'),'utf8'),'later edit');
});

test('empty existing files and absent files cannot be interchanged',async t=>{
 const root=await fixture(t);await writeFile(path.join(root,'present'),'');assert.equal((await undoTurnChanges({root,files:[change('present','before','',true,false)]})).code,'CONFLICT');assert.equal((await undoTurnChanges({root,files:[change('absent','','',false,true)]})).code,'CONFLICT');assert.equal(await readFile(path.join(root,'present'),'utf8'),'');
});

test('rejects links, linked parents, root links, out-of-root paths and non-files',async t=>{
 const root=await fixture(t);await writeFile(path.join(root,'real'),'after');await symlink('real',path.join(root,'link'));await mkdir(path.join(root,'dir'));await writeFile(path.join(root,'dir','file'),'after');await symlink('dir',path.join(root,'linked-dir'));await symlink(root,path.join(root,'root-link'));
 for(const name of ['link','linked-dir/file','../outside','dir','.']){const result=await undoTurnChanges({root,files:[change(name,'before','after')]});assert.equal(result.ok,false,name);assert.equal(result.code,'UNSAFE_PATH',name);}
 assert.equal((await undoTurnChanges({root:path.join(root,'root-link'),files:[change('real','before','after')]})).code,'UNSAFE_PATH');assert.equal(await readFile(path.join(root,'real'),'utf8'),'after');
});

test('rejects incomplete, duplicate, contradictory or oversized server snapshots',async t=>{
 const root=await fixture(t);
 const invalid=[[],[{path:'a',before:'',after:''}], [{path:'a',before:null,after:'',beforeExists:true,afterExists:true}], [change('a','unexpected','',false,true)], [change('a','','',false,false)], [change('a','',''),change('./a','','')],Array.from({length:101},(_,i)=>change(String(i),'','')), [change('a','x'.repeat(20*1024*1024+1),'')]];
 for(const files of invalid){const result=await undoTurnChanges({root,files});assert.equal(result.code,'INVALID_BATCH');}
 assert.equal((await undoTurnChanges({root:'.',files:[change('a','','')]})).code,'INVALID_BATCH');assert.deepEqual(await readdir(root),[]);
});

test('failed execution compensates completed writes and preserves external edits during rollback',async t=>{
 const {default:fs}=await import('node:fs');const {syncBuiltinESMExports}=await import('node:module');
 const original=fs.promises.rename;
 for(const externalEdit of [false,true]){
  const root=await fixture(t);await writeFile(path.join(root,'a'),'after-a');await writeFile(path.join(root,'b'),'after-b');
  fs.promises.rename=async(source,target)=>{
   if(source===path.join(root,'b')){if(externalEdit)await writeFile(path.join(root,'a'),'external edit');throw Object.assign(new Error('simulated disk failure'),{code:'EIO'});}
   return original(source,target);
  };syncBuiltinESMExports();
  try{
   const result=await undoTurnChanges({root,files:[change('a','before-a','after-a'),change('b','before-b','after-b')]});assert.equal(result.ok,false);assert.equal(result.code,'EIO');assert.equal(await readFile(path.join(root,'b'),'utf8'),'after-b');
   assert.equal(await readFile(path.join(root,'a'),'utf8'),externalEdit?'external edit':'after-a');assert.deepEqual(result.rollback.restored,externalEdit?[]:['a']);assert.deepEqual(result.rollback.conflicts,externalEdit?['a']:[]);assert.equal((await readdir(root)).some(name=>name.endsWith('.tmp')),false);
  }finally{fs.promises.rename=original;syncBuiltinESMExports();}
 }
});

test('captures and rejects a last-moment edit without losing its contents, including file removal',async t=>{
 const {default:fs}=await import('node:fs');const {syncBuiltinESMExports}=await import('node:module');const original=fs.promises.rename;
 for(const beforeExists of [true,false]){
  const root=await fixture(t),target=path.join(root,'a');await writeFile(target,'after');
  fs.promises.rename=async(source,destination)=>{if(source===target)await writeFile(target,'external late edit');return original(source,destination);};syncBuiltinESMExports();
  try{
   const result=await undoTurnChanges({root,files:[change('a',beforeExists?'before':'','after',beforeExists,true)]});
   assert.equal(result.code,'CONFLICT');assert.equal(await readFile(target,'utf8'),'external late edit');assert.equal(await readFile(result.backups[0].backup,'utf8'),'external late edit');assert.deepEqual(result.recovery,[]);
  }finally{fs.promises.rename=original;syncBuiltinESMExports();}
 }
});

test('publishing never overwrites a concurrently created target and reports preserved recovery content',async t=>{
 const {default:fs}=await import('node:fs');const {syncBuiltinESMExports}=await import('node:module');const original=fs.promises.link;
 const root=await fixture(t),target=path.join(root,'a');await writeFile(target,'after');
 fs.promises.link=async(source,destination)=>{if(source.endsWith('.tmp')&&destination===target)await writeFile(target,'new external file');return original(source,destination);};syncBuiltinESMExports();
 try{
  const result=await undoTurnChanges({root,files:[change('a','before','after')]});assert.equal(result.code,'CONFLICT');assert.equal(await readFile(target,'utf8'),'new external file');assert.equal(result.recovery.length,1);assert.equal(result.recovery[0].path,'a');assert.equal(await readFile(result.recovery[0].backup,'utf8'),'after');
 }finally{fs.promises.link=original;syncBuiltinESMExports();}
});

test('keeps captured original inodes for late writes through already open editor handles',async t=>{
 const {open}=await import('node:fs/promises');const root=await fixture(t),target=path.join(root,'a');await writeFile(target,'after');const handle=await open(target,'r+');
 try{
  const result=await undoTurnChanges({root,files:[change('a','before','after')]});assert.equal(result.ok,true);await handle.truncate(0);await handle.writeFile('late editor write');assert.equal(await readFile(target,'utf8'),'before');assert.equal(await readFile(result.backups[0].backup,'utf8'),'late editor write');
 }finally{await handle.close();}
});
