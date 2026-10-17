import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountCompositionGuard} from '../../../src/features/chat/composition-guard.mjs';

function setup() {
  const dom = new JSDOM('<wa-textarea></wa-textarea>');
  const input = dom.window.document.querySelector('wa-textarea');
  const guard = mountCompositionGuard(input);
  const composition = type => input.dispatchEvent(new dom.window.CompositionEvent(type, {bubbles:true}));
  const key = (name, options = {}) => {
    const event = new dom.window.KeyboardEvent(options.type || 'keydown', {key:name, bubbles:true, cancelable:true, ...options});
    input.dispatchEvent(event);
    return event;
  };
  return {dom, input, guard, composition, key};
}

test('IME confirmation never submits or chooses a suggestion, and following Enter works', () => {
  const {input, guard, composition, key} = setup();
  let selected = 0, submitted = 0;
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !guard.isComposing(event)) selected++; }, true);
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !guard.isComposing(event)) submitted++; });
  composition('compositionstart');
  const confirming = key('Enter', {isComposing:true});
  composition('compositionend');
  key('Enter', {repeat:true});
  assert.equal(confirming.defaultPrevented, false, 'native IME confirmation remains intact');
  assert.deepEqual([selected, submitted], [0, 0]);
  key('Enter', {type:'keyup'});
  key('Enter');
  assert.deepEqual([selected, submitted], [1, 1]);
  guard.destroy();
});

test('compositionend before Enter is blocked without a 500 ms cooldown', async () => {
  const {guard, composition, key} = setup();
  composition('compositionstart');
  composition('compositionend');
  const confirming = key('Enter');
  assert.equal(guard.isComposing(confirming), true);
  key('Enter', {type:'keyup'});
  assert.equal(guard.isComposing(key('Enter')), false);
  composition('compositionstart');
  composition('compositionend');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(guard.isComposing(key('Enter')), false, 'pointer/text confirmation does not swallow a later Enter');
  guard.destroy();
});

test('legacy 229 and editor Escape respect composition; independent inputs do not share state', () => {
  const a = setup(), b = setup();
  assert.equal(a.guard.isComposing(a.key('Enter', {keyCode:229})), true);
  assert.equal(b.guard.isComposing(b.key('Enter')), false);
  a.composition('compositionstart');
  assert.equal(a.guard.isComposing(a.key('Escape')), true);
  a.composition('compositionend');
  a.key('Escape', {type:'keyup'});
  assert.equal(a.guard.isComposing(a.key('Escape')), false);
  a.guard.destroy(); b.guard.destroy();
});

test('Web Awesome shadow input events reach the shared host guard; blur clears stuck state', () => {
  const {dom, input, guard} = setup();
  assert.equal(mountCompositionGuard(input), guard);
  const native = dom.window.document.createElement('textarea');
  input.attachShadow({mode:'open'}).append(native);
  native.dispatchEvent(new dom.window.CompositionEvent('compositionstart', {bubbles:true, composed:true}));
  const event = new dom.window.KeyboardEvent('keydown', {key:'Enter', bubbles:true, composed:true});
  native.dispatchEvent(event);
  assert.equal(guard.isComposing(event), true);
  native.dispatchEvent(new dom.window.FocusEvent('blur', {composed:true}));
  const next = new dom.window.KeyboardEvent('keydown', {key:'Enter', bubbles:true, composed:true});
  native.dispatchEvent(next);
  assert.equal(guard.isComposing(next), false);
  guard.destroy();
  assert.notEqual(mountCompositionGuard(input), guard);
});
