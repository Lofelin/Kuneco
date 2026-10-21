import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {mountBrowserAccessControl} from '../../../src/features/browser/browser-access-ui.mjs';
test('composer permission picker saves only the selected chat, restores mode and disables during a run',async()=>{
 const dom=new JSDOM('<wa-dropdown id="add"></wa-dropdown>'),d=dom.window.document,calls=[],scope={owner:'a',environmentId:'env'};let current={id:'one'},busy=false;
 const view=mountBrowserAccessControl({anchor:d.getElementById('add'),api:{sessionBrowserAccess:async value=>{calls.push(value);return {mode:value.mode};}},getScope:()=>scope,getSession:()=>current,isBusy:()=>busy,onError:e=>{throw e;}});
 assert.equal(d.getElementById('browserAccessTrigger').textContent,'请求批准');d.querySelector('wa-dropdown-item[value=full]').click();await new Promise(r=>setImmediate(r));assert.deepEqual(calls,[{...scope,chatId:'one',mode:'full'}]);assert.equal(current.browserAccessMode,'full');assert.equal(d.getElementById('browserAccessTrigger').textContent,'完全访问');current={id:'two'};view.render();assert.equal(d.getElementById('browserAccessTrigger').textContent,'请求批准');busy=true;view.render();assert.equal(d.getElementById('browserAccessTrigger').disabled,true);dom.window.close();
});
