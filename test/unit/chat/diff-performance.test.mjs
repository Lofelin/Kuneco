import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {changeRows,renderFileDiffs} from '../../../src/features/chat/file-diff.mjs';
import {reviewRows,renderReviewDiff} from '../../../src/features/chat/review-diff.mjs';

test('cached rows survive mode and review rerenders but invalidate changed snapshots',()=>{
 const change={before:'before\n',after:'after\n'};
 const rows=changeRows(change);assert.equal(reviewRows(change),rows);
 change.after='next\n';assert.notEqual(changeRows(change),rows);assert.equal(changeRows(change)[1].text,'next');
 delete change.before;delete change.after;change.diff='@@ -1 +1 @@\n-a\n+b';
 const patch=changeRows(change);assert.equal(changeRows(change),patch);
 change.diff+='\n+c';assert.notEqual(changeRows(change),patch);assert.equal(changeRows(change).at(-1).text,'c');
});
test('collapsed activity does not read or render its source until opened, and retains split mode',()=>{
 const dom=new JSDOM('<main></main>'),previous=globalThis.document,previousEvent=globalThis.CustomEvent;
 globalThis.document=dom.window.document;globalThis.CustomEvent=dom.window.CustomEvent;
 try{
  let reads=0;const change={path:'big.txt',get before(){reads++;return 'same\n'.repeat(2000);},after:'changed\n'};
  const activity={changes:[change],diffMode:'split'},host=document.querySelector('main');
  renderFileDiffs(host,activity);assert.equal(reads,0);assert.equal(host.querySelectorAll('.diff-line').length,0);
  host.querySelector('summary').click();assert.ok(reads>0);assert.equal(host.querySelectorAll('pre').length,2);assert.equal(activity.diffExpanded['big.txt'],true);
  const first=host.querySelector('.diff-line');host.querySelector('summary').click();host.querySelector('summary').click();assert.equal(host.querySelector('.diff-line'),first);
 }finally{globalThis.document=previous;globalThis.CustomEvent=previousEvent;dom.window.close();}
});
test('review builds folded context only once on demand and honors restored expansion',()=>{
 const dom=new JSDOM('<main></main>'),previous=globalThis.document;globalThis.document=dom.window.document;
 try{
  const change={before:'same\n'.repeat(2000),after:'same\n'.repeat(2000)+'new\n'},host=document.querySelector('main');
  renderReviewDiff(host,change);assert.equal(host.querySelectorAll('.review-code-line').length,1);
  const toggle=host.querySelector('app-button');toggle.click();assert.equal(host.querySelectorAll('.review-code-line').length,2001);const first=host.querySelector('.context');
  toggle.click();toggle.click();assert.equal(host.querySelector('.context'),first);
  host.replaceChildren();renderReviewDiff(host,change,{expanded:{0:true}});assert.equal(host.querySelectorAll('.review-code-line').length,2001);assert.equal(host.querySelector('app-button').getAttribute('aria-expanded'),'true');
 }finally{globalThis.document=previous;dom.window.close();}
});
