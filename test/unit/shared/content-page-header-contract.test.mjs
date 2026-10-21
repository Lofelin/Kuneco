import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const root=new URL('../../../src/',import.meta.url);
test('static and dynamic page headers share global typography and keep feature CSS from overriding it',async()=>{
 const files=(await readdir(root,{recursive:true})).filter(name=>/\.(?:css|html|mjs|js)$/.test(name)&&!name.startsWith('vendor/'));
 const sources=await Promise.all(files.map(async name=>({name,text:await readFile(new URL(name,root),'utf8')})));
 const pageClasses=new Set(),headerClasses=new Set(['content-page-header','content-page-heading','content-page-description']);
 for(const {text} of sources.filter(file=>file.name.endsWith('.html')||!file.name.endsWith('.css')&&/class=["'][^"']*content-page-header/.test(file.text))){const doc=new JSDOM(text).window.document;for(const el of doc.querySelectorAll('.page'))for(const cls of el.classList)if(cls!=='page'&&cls!=='hidden')pageClasses.add(cls);for(const el of doc.querySelectorAll('.content-page-header'))for(const cls of el.classList)headerClasses.add(cls);}
 for(const {name,text} of sources){
  if(name==='shared/ui/ui-style.css')continue;
  for(const [,selector,body] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
   const touchesHeader=[...headerClasses].some(cls=>selector.includes('.'+cls));
   const pageTitle=[...pageClasses].some(cls=>selector.includes('.'+cls))&&/\bh[12]\b/.test(selector);
   if(pageTitle||touchesHeader&&/\bh[12]\b|content-page-description/.test(selector))assert.doesNotMatch(body,/(?:^|;)\s*(?:font(?:-size|-weight)?|line-height)\s*:/,name+': '+selector.trim());
   if(name.startsWith('features/'))assert.doesNotMatch(body,/--content-heading-[\w-]+\s*:/,name+': local heading token override');
   if(name.startsWith('features/')&&touchesHeader)assert.doesNotMatch(body,/(?:^|;)\s*(?:padding(?:-[\w-]+)?|margin(?:-[\w-]+)?|height|min-height|border(?:-[\w-]+)?|gap)\s*:/,name+': '+selector.trim());
  }
 }
});
test('memory uses one concise header description and keeps body spacing outside the header',async()=>{
 const text=await readFile(new URL('features/memory/memory-ui.mjs',root),'utf8');const template=text.match(/root\.innerHTML=`([\s\S]*?)`;/)[1];const doc=new JSDOM(template).window.document,header=doc.querySelector('.content-page-header');
 assert.equal(header.querySelector('h1').textContent,'记忆库');assert.equal(header.querySelector('.content-page-heading>.content-page-description').textContent,'让不同运行时延续偏好、约定与经验。');assert.equal(doc.querySelector('.memory-body').querySelector('h1,h2:not(.app-empty-state h2)'),null);assert.doesNotMatch(template,/同一账号|同一环境|24000|不跨设备同步/);
 const css=await readFile(new URL('features/memory/memory.css',root),'utf8');assert.doesNotMatch(css,/\.memory-page\s*\{[^}]*padding/);assert.match(css,/\.memory-body\{[^}]*padding:12px 32px 28px/);
});
