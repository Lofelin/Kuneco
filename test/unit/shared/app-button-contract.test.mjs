import test from 'node:test';import assert from 'node:assert/strict';import {readdir,readFile} from 'node:fs/promises';
test('business buttons use the shared app-button in templates and factories',async()=>{
 for(const name of await readdir(new URL('../../../src/',import.meta.url),{recursive:true})){if(!/\.(mjs|js|html)$/.test(name)||name==='shared/ui/app-button.mjs'||name.startsWith('vendor/'))continue;const text=await readFile(new URL('../../../src/'+name,import.meta.url),'utf8');assert.doesNotMatch(text,/<\/?(?:wa-button|button)(?:\s|>)/,name);assert.doesNotMatch(text,/create(?:Element|UI)\(['"](?:wa-button|button)['"]\)/,name);}
});
