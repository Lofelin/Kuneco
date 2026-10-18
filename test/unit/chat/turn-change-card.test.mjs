import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {renderTurnChangeCard} from '../../../src/features/chat/turn-change-card.mjs';

function setup() {
 const dom = new JSDOM('<div id="host"></div>');
 dom.window.customElements.define('app-button', class extends dom.window.HTMLElement {
  get disabled() {return this.hasAttribute('disabled');}
  set disabled(value) {this.toggleAttribute('disabled', Boolean(value));}
  get loading() {return this.hasAttribute('loading');}
  set loading(value) {this.toggleAttribute('loading', Boolean(value));}
 });
 return dom.window.document.querySelector('#host');
}
function fixture(count = 5) {
 return {id:'turn-1', files:Array.from({length:count}, (_, index) => ({path:`src/example-${index}.mjs`,added:index+1,removed:index})),added:15,removed:10,undo:{available:true}};
}
test('turn card shows three files, expands remaining files, and retains expansion only for the same turn', () => {
 const host=setup(),turn=fixture();renderTurnChangeCard(host,turn);
 assert.equal(host.dataset.turnId,'turn-1');assert.equal(host.querySelectorAll('li').length,3);
 assert.match(host.querySelector('.turn-change-title').textContent,/已编辑 5 个文件/);
 assert.equal(host.querySelector('.turn-change-expand').textContent,'再显示 2 个文件');
 host.querySelector('.turn-change-expand').click();assert.equal(host.querySelectorAll('li').length,5);assert.equal(host.querySelector('.turn-change-expand').getAttribute('aria-expanded'),'true');
 renderTurnChangeCard(host,turn);assert.equal(host.querySelectorAll('li').length,5);
 host.querySelector('.turn-change-expand').click();assert.equal(host.querySelectorAll('li').length,3);
 host.querySelector('.turn-change-expand').click();renderTurnChangeCard(host,{...turn,id:'turn-2'});assert.equal(host.querySelectorAll('li').length,3);
 renderTurnChangeCard(host,fixture(2));assert.equal(host.querySelector('.turn-change-expand'),null);assert.equal(host.querySelector('table'),null);assert.equal(host.querySelector('button'),null);
});
test('known zero counts remain accurate and unknown or invalid statistics are never invented as zero', () => {
 const host=setup(),turn=fixture(1);turn.added=undefined;turn.removed=0;turn.files[0].added=null;turn.files[0].removed=-1;
 renderTurnChangeCard(host,turn);
 assert.equal(host.querySelector('.turn-change-summary .turn-change-added').textContent,'+?');
 assert.equal(host.querySelector('.turn-change-summary .turn-change-removed').textContent,'−0');
 assert.equal(host.querySelector('.turn-change-file .turn-change-added').getAttribute('aria-label'),'新增行数未知');
 assert.equal(host.querySelector('.turn-change-file .turn-change-removed').textContent,'−?');
 turn.added=15;turn.removed=10;renderTurnChangeCard(host,turn);assert.equal(host.querySelector('.turn-change-summary .turn-change-added').textContent,'+15');assert.equal(host.querySelector('.turn-change-summary .turn-change-removed').textContent,'−10');
});
test('review callbacks distinguish all changes from a file and long paths remain exact accessible text', () => {
 const host=setup(),turn=fixture(1),reviews=[];
 const path='src/'+('目录/<long>&'.repeat(40))+'.mjs';turn.files[0].path=path;
 renderTurnChangeCard(host,turn,{onReview:value=>reviews.push(value)});
 host.querySelector('[data-action=review]').click();host.querySelector('.turn-change-file').click();assert.deepEqual(reviews,[undefined,path]);
 assert.equal(host.querySelector('.turn-change-file').title,path);assert.equal(host.querySelector('.turn-change-path').textContent,path);assert.equal(host.querySelector('.turn-change-path').children.length,0);
 assert.equal(host.querySelector('.turn-change-file').getAttribute('aria-label'),'查看文件变更：'+path);
});
test('undo only fires for supported idle turns and exposes the reason for each disabled state', () => {
 const host=setup(),turn=fixture();let undos=0;
 const render=options=>renderTurnChangeCard(host,turn,{onUndo:()=>undos++,...options});
 render();host.querySelector('[data-action=undo]').click();assert.equal(undos,1);
 for(const options of [{running:true},{undoState:{pending:true}}]) {
  render(options);const undo=host.querySelector('[data-action=undo]');assert.equal(undo.disabled,true);undo.click();assert.equal(undos,1);assert.ok(host.ownerDocument.getElementById(undo.getAttribute('aria-describedby')).textContent);
 }
 turn.undo={available:false,reason:'未记录回合开始时的文件快照。'};render();let undo=host.querySelector('[data-action=undo]');assert.equal(undo.title,turn.undo.reason);assert.equal(undo.disabled,true);undo.click();assert.equal(undos,1);
 turn.undo={available:true,revertedAt:'2026-10-18T10:00:00Z'};render();undo=host.querySelector('[data-action=undo]');assert.equal(undo.textContent,'已撤销');assert.equal(undo.disabled,true);undo.click();assert.equal(undos,1);
 turn.undo={available:true};render({undoState:{error:'快照发生变化，请检查文件。'}});assert.match(host.querySelector('[role=status]').textContent,/快照发生变化/);
});
test('read-only or empty cards never expose enabled actions without a handler', () => {
 const host=setup();renderTurnChangeCard(host,fixture());assert.equal(host.querySelector('[data-action=undo]').disabled,true);assert.equal(host.querySelector('[data-action=review]').disabled,true);assert.equal(host.querySelector('.turn-change-file').disabled,true);
 renderTurnChangeCard(host,fixture(0),{onReview(){}});assert.equal(host.querySelectorAll('li').length,0);assert.equal(host.querySelector('[data-action=review]').disabled,true);assert.equal(host.querySelector('.turn-change-expand'),null);
});
