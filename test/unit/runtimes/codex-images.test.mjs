import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {normalizeCodexInput,stageCodexImages} from '../../../src/features/runtimes/codex-images.mjs';
import {codexArguments} from '../../../src/features/runtimes/codex-runner.mjs';
const dataURL='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('Codex accepts image-only input, rejects URLs, and preserves text input',()=>{
 assert.equal(normalizeCodexInput({text:'',images:[{dataURL}]}).images.length,1);
 assert.equal(normalizeCodexInput('hello').text,'hello');
 assert.throws(()=>normalizeCodexInput({text:'hello',images:[{url:'https://example.com/a.png'}]}),/本地图片/);
 assert.throws(()=>normalizeCodexInput({text:'',images:[]}),/请输入/);
});
test('image attachments reach both new and resumed CLI turns without entering stdin text',()=>{
 for(const sessionId of [undefined,'session-fixture']){
  const args=codexArguments({project:'/tmp',sessionId,images:['/tmp/a b.png','/tmp/c.png']});
  assert.deepEqual(args.slice(-5),['--image','/tmp/a b.png','--image','/tmp/c.png','-']);
  if(sessionId)assert.ok(args.indexOf('resume')<args.indexOf('--image'));
 }
});
test('local and execution-environment staging round-trip bytes and remove temporary files',async()=>{
 for(const remote of [false,true]){
  const calls=[];
  const exec=remote?(args,options={})=>new Promise((resolve,reject)=>{
   calls.push(args);
   const child=execFile(process.execPath,args.slice(1),(error,out)=>error?reject(error):resolve(out));
   child.stdin.end(options.input);
  }):undefined;
  const staged=await stageCodexImages(normalizeCodexInput({text:'',images:[{dataURL}]}).images,{exec});
  assert.deepEqual(await readFile(staged.paths[0]),Buffer.from(dataURL.split(',')[1],'base64'));
  await staged.cleanup();await assert.rejects(access(staged.paths[0]));
  if(remote)assert.equal(calls.length,3);
 }
});
