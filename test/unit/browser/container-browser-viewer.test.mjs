import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
test('viewer hides the uninitialized image, shows shared centered state, and only reveals decoded frames',async()=>{
 const html=await readFile(new URL('../../../src/features/browser/container-browser-viewer.html',import.meta.url),'utf8'),code=await readFile(new URL('../../../src/features/browser/container-browser-viewer.js',import.meta.url),'utf8');
 const dom=new JSDOM(html,{runScripts:'outside-only'});let receive;dom.window.containerBrowser={onFrame:fn=>receive=fn,input(){}};dom.window.eval(code);const d=dom.window.document,screen=d.getElementById('screen'),state=d.getElementById('viewerState');assert.ok(screen.hidden);assert.ok(state.classList.contains('app-empty-state'));assert.equal(state.hidden,false);assert.ok(d.querySelector('link[href="../../shared/ui/ui-style.css"]'));
 receive('jpeg');assert.ok(screen.hidden);screen.dispatchEvent(new dom.window.Event('load'));assert.equal(screen.hidden,false);assert.equal(state.hidden,true);screen.dispatchEvent(new dom.window.Event('error'));assert.equal(screen.hidden,true);assert.equal(state.hidden,false);assert.match(state.textContent,/暂未收到网页画面/);dom.window.close();
});
