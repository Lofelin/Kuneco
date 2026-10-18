import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPreferenceStore} from '../../../src/features/preferences/preference-store.mjs';
import {environmentDefaults,normalizeEnvironmentPreferences} from '../../../src/shared/environment-preferences.mjs';
import {mountEnvironmentSettings} from '../../../src/features/environments/environment-settings.mjs';
test('environment preferences validate and survive reload',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'kuneco-environment-settings-'));t.after(()=>rm(directory,{recursive:true,force:true}));const file=path.join(directory,'preferences.json'),store=createPreferenceStore(file);
 await store.load();await store.save({environmentLogRetentionDays:30,environmentHealthDebug:false,environmentHealthInterval:10});
 const restored=await createPreferenceStore(file).load();assert.equal(restored.environmentLogRetentionDays,30);assert.equal(restored.environmentHealthDebug,false);assert.equal(restored.environmentHealthInterval,10);
 await assert.rejects(store.save({environmentLogMaxEntries:-1}));assert.deepEqual(normalizeEnvironmentPreferences({environmentLogMaxEntries:-1}),environmentDefaults);
});
test('settings controls save typed values, recover failures, and use manual cleanup API',async()=>{
 const dom=new JSDOM('<section></section>'),host=dom.window.document.querySelector('section');let prefs={...environmentDefaults},cleaned=false;
 const settings=mountEnvironmentSettings({host,getPreferences:()=>prefs,save:async patch=>{if(patch.environmentHealthInterval===30)throw Error('offline');prefs={...prefs,...patch};},api:{dockerEnvironments:async action=>{assert.equal(action,'logsCleanup');cleaned=true;return {removed:2};}}});
 settings.render(true);const change=async(key,value)=>{const c=host.querySelector('#'+key);if(typeof value==='boolean')c.checked=value;else c.value=String(value);c.dispatchEvent(new dom.window.Event('change'));await new Promise(r=>setTimeout(r,0));};
 await change('environmentHealthDebug',false);assert.equal(prefs.environmentHealthDebug,false);await change('environmentLogRetentionDays',30);assert.equal(prefs.environmentLogRetentionDays,30);
 await change('environmentHealthInterval',30);assert.equal(host.querySelector('#environmentHealthInterval').value,'3');assert.match(host.textContent,/offline/);
 host.querySelector('app-button').click();await new Promise(r=>setTimeout(r,0));assert.ok(cleaned);assert.match(host.textContent,/已清理 2/);dom.window.close();
});
