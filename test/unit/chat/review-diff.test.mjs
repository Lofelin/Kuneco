import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {groupReviewRows,renderReviewDiff,reviewRows} from '../../../src/features/chat/review-diff.mjs';
test('review folds long unchanged runs without losing original line numbers',()=>{
 const before=Array.from({length:25},(_,i)=>'line '+i).join('\n')+'\n';const rows=reviewRows({before,after:before+'added\n'}),groups=groupReviewRows(rows);
 assert.equal(groups[0].foldable,true);assert.equal(groups[0].rows.length,25);assert.equal(groups[1].rows[0].next,26);
});
test('context fold toggles and code is rendered as inert text',()=>{
 const dom=new JSDOM('<main></main>');const previous=global.document;global.document=dom.window.document;
 try{const host=document.querySelector('main'),before='same\n'.repeat(9);let changed;renderReviewDiff(host,{before,after:before+'<img onerror=alert(1)>\n'},{onToggle:(k,v)=>changed=[k,v]});
 const button=host.querySelector('app-button');assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(host.querySelector('img'),null);button.click();assert.equal(button.getAttribute('aria-expanded'),'true');assert.deepEqual(changed,['0',true]);assert.equal(host.querySelector('.addition .review-line-number').textContent,'10');
 }finally{global.document=previous;dom.window.close();}
});
