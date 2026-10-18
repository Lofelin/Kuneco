import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../../../src/index.html',import.meta.url),'utf8');
test('all static dialogs use shared shell with direct footer slots and no bespoke headers',()=>{
 const d=new JSDOM(source).window.document;assert.equal(d.querySelectorAll('wa-dialog,dialog').length,0);const dialogs=d.querySelectorAll('app-dialog');assert.equal(dialogs.length,18);assert.ok(d.getElementById('gitKeyDialog'));
 for(const dialog of dialogs){assert.equal(dialog.hasAttribute('without-header'),false,dialog.id);assert.equal(dialog.querySelector('.dialog-heading,.runtime-add-heading,.form-footer'),null,dialog.id);if(dialog.id!=='projectTransferDialog')assert.ok(dialog.querySelector(':scope > [slot=footer]'),dialog.id);assert.equal(dialog.querySelector('h2[slot=label]'),null,dialog.id);}
 const submit=d.getElementById('connect');assert.equal(submit.getAttribute('form'),'proxyForm');assert.equal(submit.closest('[slot=footer]').parentNode.id,'proxyDialog');
});
test('dynamic learning dialog uses the same shared component and footer',()=>{const ui=readFileSync(new URL('../../../src/features/automation/learning-ui.mjs',import.meta.url),'utf8');assert.match(ui,/createElement\('app-dialog'\)/);assert.doesNotMatch(ui,/wa-dialog/);assert.match(ui,/slot="footer"/);});

test('every static footer action has shared styling and a leading icon',()=>{const d=new JSDOM(source).window.document;for(const b of d.querySelectorAll('app-dialog [slot=footer] app-button,app-dialog>app-button[slot=footer]')){assert.ok(b.classList.contains('content-action'),b.id);assert.ok(b.querySelector('wa-icon[slot=start]'),b.id);}});
