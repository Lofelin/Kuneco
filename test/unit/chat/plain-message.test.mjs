import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {renderPlainMessage,textRanges,visibleTextRange,PLAIN_MESSAGE_PAGE_SIZE} from '../../../src/features/chat/plain-message.mjs';
import {chatViewSnapshot} from '../../../src/features/chat/chat-view-state.mjs';
test('large messages scroll continuously with bounded DOM and intact history',async()=>{
 const win=new JSDOM('<div class="bubble user"><div class="message-content"></div></div>',{pretendToBeVisual:true}).window,doc=win.document;
 const node=doc.querySelector('.message-content'),original='calibration '.repeat(850000)+'END';renderPlainMessage(node,original);
 assert.equal(node.dataset.rawText,original);assert.ok(node.textContent.length<PLAIN_MESSAGE_PAGE_SIZE+100);
 const toggle=node.querySelector('.long-message-toggle'),body=node.querySelector('.long-message-body');
 assert.equal(toggle.getAttribute('aria-expanded'),'false');toggle.click();
 assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.equal(node.querySelector('.long-message-navigation'),null);
 assert.ok(body.textContent.length<20000);
 body.scrollTop=1e9;body.dispatchEvent(new win.Event('scroll'));
 await new Promise(r=>win.requestAnimationFrame(()=>win.requestAnimationFrame(r)));
 assert.ok(body.textContent.endsWith('END'));assert.ok(body.textContent.length<20000);
 toggle.click();assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.ok(node.textContent.length<PLAIN_MESSAGE_PAGE_SIZE+100);
 assert.equal(chatViewSnapshot([{id:'test',nodes:[doc.querySelector('.bubble')]}])[0].messages[0].text,original);
 win.close();
});
test('chunks preserve every character including Unicode; viewport includes neighboring chunks',()=>{
 const text=('hello 🌍\n'+'x'.repeat(4001)).repeat(3),ranges=textRanges(text);
 assert.equal(ranges.map(([a,b])=>text.slice(a,b)).join(''),text);
 assert.deepEqual(visibleTextRange([100,100,100,100,100],220,50),{start:1,end:4});
});
test('ordinary messages stay plain text without controls or HTML interpretation',()=>{
 const node=new JSDOM('<div></div>').window.document.querySelector('div');renderPlainMessage(node,'<script>literal</script>');assert.equal(node.textContent,'<script>literal</script>');assert.equal(node.children.length,0);
});
