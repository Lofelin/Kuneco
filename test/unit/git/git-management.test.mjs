import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readGitInfo} from '../../../src/features/git/git-management.mjs';
const exec=promisify(execFile);
test('environment keys persist, stay isolated, and expose only public material',async()=>{
 const homes=await Promise.all([1,2].map(()=>mkdtemp(path.join(tmpdir(),'kuneco-git-'))));
 try{
  const execute=home=>args=>exec(args[0],args.slice(1),{env:{...process.env,HOME:home}}).then(r=>r.stdout);
  const empty=await readGitInfo(execute(homes[0]));assert.equal(empty.publicKey,'');
  const first=await readGitInfo(execute(homes[0]),{generate:true});assert.match(first.publicKey,/^ssh-ed25519 /);
  const privateBefore=await readFile(path.join(homes[0],'.ssh/id_ed25519'));
  assert.deepEqual(await readGitInfo(execute(homes[0]),{generate:true}),first);
  assert.deepEqual(await readFile(path.join(homes[0],'.ssh/id_ed25519')),privateBefore);
  assert.equal((await stat(path.join(homes[0],'.ssh/id_ed25519'))).mode&0o777,0o600);
  assert.ok(!JSON.stringify(first).includes('PRIVATE KEY'));
  const second=await readGitInfo(execute(homes[1]),{generate:true});assert.notEqual(first.publicKey,second.publicKey);
 }finally{await Promise.all(homes.map(home=>rm(home,{recursive:true,force:true})));}
});
