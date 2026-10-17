import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {mountAssistantImagePreviews} from '../../../src/features/chat/assistant-image-preview.mjs';
test('assistant local image becomes one clickable preview and remains associated with its environment',async()=>{
 const dom=new JSDOM('<div id="chat"><div class="bubble assistant"><div class="markdown-body" data-raw-text="reply"><p><code>/workspace/file/图片.jpg</code></p><a href="https://example.com">图片来源</a></div></div></div>');globalThis.document=dom.window.document;globalThis.MutationObserver=dom.window.MutationObserver;let opened,calls=0;const scope={owner:'one',environmentId:'env'};const stop=mountAssistantImagePreviews({root:document.getElementById('chat'),context:()=>scope,read:async value=>{calls++;assert.equal(value.environmentId,'env');return {name:'图片.jpg',dataURL:'data:image/jpeg;base64,fixture'}},preview:image=>opened=image});
 await new Promise(r=>setTimeout(r,20));assert.equal(document.querySelectorAll('.assistant-image-preview').length,1);document.querySelector('.assistant-image-preview').click();assert.equal(opened.name,'图片.jpg');assert.equal(calls,1);assert.equal(document.querySelector('a').textContent,'图片来源');stop();dom.window.close();
});
test('late image read from another conversation is discarded even within the same environment',async()=>{
 const dom=new JSDOM('<div id="chat"><div class="bubble assistant"><div class="markdown-body" data-raw-text="reply"><code>/workspace/output.png</code></div></div></div>');globalThis.document=dom.window.document;globalThis.MutationObserver=dom.window.MutationObserver;
 let scope={owner:'one',environmentId:'env',chatId:'a'},finish;
 const stop=mountAssistantImagePreviews({root:document.getElementById('chat'),context:()=>scope,read:()=>new Promise(resolve=>finish=resolve),preview:()=>assert.fail('must not expose stale image')});
 scope={...scope,chatId:'b'};finish({name:'output.png',dataURL:'data:image/png;base64,fixture'});
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(document.querySelectorAll('.assistant-image-preview').length,0);stop();dom.window.close();
});
