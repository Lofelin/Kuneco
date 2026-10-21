import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
async function sources(dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){if(['vendor','node_modules','dist'].includes(entry.name))continue;const file=dir+'/'+entry.name;if(entry.isDirectory())result.push(...await sources(file));else if(/\.(?:mjs|js|html)$/.test(file))result.push(file);}return result;}
test('settings rows use switches for boolean preferences in static and dynamic settings',async()=>{
 const html=await readFile('src/index.html','utf8'),doc=new JSDOM(html).window.document;
 assert.ok(doc.querySelectorAll('.settings-body .notification-setting-row').length>0,'settings rows must be found');
 assert.equal(doc.querySelectorAll('.settings-body .notification-setting-row wa-checkbox,.settings-body .notification-setting-row input[type=checkbox]').length,0);
 const violations=[];
 for(const file of await sources('src')){
  if(!/(?:settings|preferences)[^/]*\.(?:mjs|js)$/.test(file))continue;
  const code=await readFile(file,'utf8');
  // Catch direct, helper-based and conditional dynamic construction, but allow
  // selectors that include checkbox for disabling unrelated dialog controls.
  if(/<(?:wa-checkbox|input\b[^>]*type=["']checkbox)/.test(code)||/(?:createElement|\bel|\belement)\([^;\n]*?["']wa-checkbox["']/.test(code))violations.push(file);
 }
 assert.deepEqual(violations,[],'Boolean settings must use wa-switch; form/multiple-selection controls belong outside preference factories.');
});
