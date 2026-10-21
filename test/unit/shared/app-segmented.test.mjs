import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAppSegmented} from '../../../src/shared/ui/app-segmented.mjs';
import {mountPreferenceSettings} from '../../../src/features/preferences/preference-settings.mjs';
import {preferenceDefaults} from '../../../src/shared/preferences.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('segmented options retain values, safe labels and decorative semantic icons',()=>{
 const dom=new JSDOM(),doc=dom.window.document,group=createAppSegmented(doc,[[1,'<small>','type'],[2,'中','type'],[3,'大','type']]);
 assert.equal(group.localName,'wa-radio-group');assert.equal(group.orientation,'horizontal');assert.equal(group.children.length,3);
 assert.equal(group.children[0].value,'1');assert.equal(group.querySelector('small'),null);
 for(const option of group.children){assert.equal(option.appearance,'button');assert.equal(option.querySelector('wa-icon').getAttribute('aria-hidden'),'true');}
 dom.window.close();
});
test('preference segmented values save as numbers and restore actual state on failure',async()=>{
 const dom=new JSDOM('<main></main>'),host=dom.window.document.querySelector('main');let preferences={...preferenceDefaults},fail=false;const saved=[];
 const view=mountPreferenceSettings({host,getPreferences:()=>preferences,save:async patch=>{saved.push(patch);if(fail)throw Error('offline');preferences={...preferences,...patch};}});
 view.render();
 const size=host.querySelector('#preference-chatFontSize');assert.equal(size.value,'14');
 size.value='18';size.dispatchEvent(new dom.window.Event('change'));assert.equal(size.disabled,true);await tick();assert.deepEqual(saved[0],{chatFontSize:18});assert.equal(size.value,'18');assert.equal(size.disabled,false);assert.equal(host.querySelector('.preference-save-status').textContent,'');
 fail=true;size.value='12';size.dispatchEvent(new dom.window.Event('change'));await tick();assert.equal(size.value,'18');assert.match(host.textContent,/保存失败/);
 const width=host.querySelector('#preference-chatWidth');assert.equal(width.querySelectorAll('wa-icon').length,3);assert.equal(width.value,'wide');dom.window.close();
});
