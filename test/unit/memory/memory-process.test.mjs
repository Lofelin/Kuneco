import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {access,realpath} from 'node:fs/promises';
import {memoryDirectorySpawner} from '../../../src/features/memory/memory-process.mjs';
test('extraction bootstrap prepares cwd in actual worker, relays stdin and cleans empty directory',async()=>{
 const directory='/tmp/kuneco-memory-'+randomUUID();await assert.rejects(access(directory));let launch;
 const wrapped=memoryDirectorySpawner(options=>{launch=options;return spawn(options.command,options.args,{stdio:['pipe','pipe','pipe']});},directory);
 const child=wrapped({command:process.execPath,args:['-e',"let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>console.log(JSON.stringify({cwd:process.cwd(),text})));"],cwd:directory});let stdout='';child.stdout.on('data',c=>stdout+=c);child.stdin.end('provided original text');const code=await new Promise(resolve=>child.on('close',resolve));assert.equal(code,0);assert.deepEqual(JSON.parse(stdout),{cwd:(await realpath('/tmp'))+'/'+directory.split('/').at(-1),text:'provided original text'});assert.equal(launch.cwd,directory);await assert.rejects(access(directory));
});
test('bootstrap cannot create arbitrary project directories',()=>{assert.throws(()=>memoryDirectorySpawner(()=>{},'/workspace/project'),/临时目录/);});
