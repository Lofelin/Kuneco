import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountScrollFade, scrollFadeEdges} from '../../../src/shared/ui/scroll-fade.mjs';

test('edges remain clear without overflow and fade only hidden content, including RTL offsets', () => {
  assert.deepEqual(scrollFadeEdges({position:0,extent:80,viewport:100}), {start:0,end:0});
  assert.deepEqual(scrollFadeEdges({position:0,extent:300,viewport:100}), {start:0,end:24});
  assert.deepEqual(scrollFadeEdges({position:8,extent:300,viewport:100}), {start:8,end:24});
  assert.deepEqual(scrollFadeEdges({position:200,extent:300,viewport:100}), {start:24,end:0});
  assert.deepEqual(scrollFadeEdges({position:-200,extent:300,viewport:100}), {start:24,end:0});
  assert.deepEqual(scrollFadeEdges({position:300,extent:300,viewport:100}), {start:24,end:0});
  assert.deepEqual(scrollFadeEdges({position:199.625,extent:300,viewport:100}), {start:24,end:0});
});

test('content changes, scrolling, hidden reveal and teardown update the same scroller', async () => {
  const dom = new JSDOM('<div><span>first</span></div>', {pretendToBeVisual:true});
  const element = dom.window.document.querySelector('div');
  let extent = 300, viewport = 100;
  Object.defineProperties(element, {scrollHeight:{get:()=>extent},clientHeight:{get:()=>viewport}});
  const tick = () => new Promise(resolve => dom.window.requestAnimationFrame(() => dom.window.requestAnimationFrame(resolve)));
  const fade = mountScrollFade(element);
  assert.equal(mountScrollFade(element),fade);
  await tick();
  assert.equal(element.style.getPropertyValue('--scroll-fade-end'),'24px');
  element.scrollTop=200;element.dispatchEvent(new dom.window.Event('scroll'));await tick();
  assert.equal(element.style.getPropertyValue('--scroll-fade-start'),'24px');
  assert.equal(element.style.getPropertyValue('--scroll-fade-end'),'0px');
  extent=80;element.firstChild.textContent='short';await tick();
  assert.equal(element.style.getPropertyValue('--scroll-fade-start'),'0px');
  viewport=0;extent=300;fade.refresh();await tick();
  assert.equal(element.style.getPropertyValue('--scroll-fade-end'),'0px');
  viewport=100;element.scrollTop=0;fade.refresh();await tick();
  assert.equal(element.style.getPropertyValue('--scroll-fade-end'),'24px');
  fade.destroy();assert.equal(element.hasAttribute('data-scroll-fade'),false);
  assert.equal(element.style.getPropertyValue('--scroll-fade-end'),'');
  dom.window.close();
});
