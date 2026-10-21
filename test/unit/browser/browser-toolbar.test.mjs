import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountBrowserToolbar} from '../../../src/features/browser/browser-toolbar.mjs';
test('ask-mode fallback stays compact and only offers one-time approval',async()=>{
 const dom=new JSDOM('<div class="browser-toolbar"></div><wa-dropdown id="browserMoreMenu"></wa-dropdown>'),calls=[];
 const view=mountBrowserToolbar({document:dom.window.document,api:{browserLibrary:async(...args)=>calls.push(args)},library:{},getState:()=>({tabs:[]}),isBrowser:()=>false,onBounds(){},onAnnotation(){},onError:e=>{throw e;}});
 view.handleEvent('browserPrompt',{id:'agent',title:'智能体浏览器权限',description:'允许访问 example.com？'});
 const prompt=dom.window.document.querySelector('app-dialog');assert.ok(prompt.classList.contains('browser-dialog-compact'));const buttons=[...prompt.querySelectorAll('[slot=footer] app-button')];assert.deepEqual(buttons.map(b=>b.textContent),['拒绝','允许本次']);
 buttons[1].click();await new Promise(r=>setImmediate(r));assert.deepEqual(calls,[['answer',{id:'agent',allow:true}]]);dom.window.close();
});
