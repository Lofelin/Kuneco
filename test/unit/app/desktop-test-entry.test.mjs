import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
const root=new URL('../../../',import.meta.url);
test('desktop automation uses the real launcher and main-page scenarios',async()=>{
 const manifest=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
 for(const [name,command] of Object.entries(manifest.scripts))if(name.startsWith('test:'))assert.doesNotMatch(command,/\belectron\b/,'direct Electron automation entry: '+name);
 for(const name of ['test:dialogs','test:ui-preview','test:chat-ui','test:turn-card'])assert.equal(manifest.scripts[name],'npm run test:desktop');
 assert.equal((await readdir(new URL('test/e2e/',root))).some(name=>name.endsWith('.cjs')),false,'legacy standalone Electron entry remains');
 const runner=await readFile(new URL('test/e2e/desktop-smoke.mjs',root),'utf8');
 assert.match(runner,/spawn\(process\.execPath,\['src\/app\/start\.mjs'/);
 assert.match(runner,/src\/index\.html/);
 for(const name of await readdir(new URL('test/e2e/scenarios/',root))){const source=await readFile(new URL('test/e2e/scenarios/'+name,root),'utf8');assert.doesNotMatch(source,/new BrowserWindow|\.loadFile\(|require\(['"]electron['"]\)|from ['"]electron['"]/,'alternate app page in '+name);}
});
