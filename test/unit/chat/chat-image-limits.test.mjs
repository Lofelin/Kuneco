import test from 'node:test';import assert from 'node:assert/strict';
import {validateChatImages,CHAT_IMAGE_BUDGET} from '../../../src/features/chat/chat-image-limits.mjs';
test('image admission checks single and cumulative base64 size before insertion',()=>{
 assert.doesNotThrow(()=>validateChatImages([{size:100000,name:'small.png'}]));
 assert.throws(()=>validateChatImages([{size:64*1024*1024+1,name:'large.png'}]),/64 MiB/);
 assert.throws(()=>validateChatImages([{size:100000}],{draftBytes:CHAT_IMAGE_BUDGET-100}),/总量过大/);
 assert.throws(()=>validateChatImages(Array.from({length:6},()=>({size:64*1024*1024}))),/总量过大/);
 assert.doesNotThrow(()=>validateChatImages([{size:524288}],{usedBytes:Number.MAX_SAFE_INTEGER}));
});
test('oversize paste, drop and file picker leave the draft empty and show a warning',async()=>{
 const {JSDOM}=await import('jsdom');const {mountDeepSeekComposer}=await import('../../../src/features/runtimes/deepseek-composer.mjs');
 const dom=new JSDOM('<form id="chatForm"><div id="composeMenu"></div><div id="prompt"></div></form>');globalThis.document=dom.window.document;globalThis.window=dom.window;
 const warnings=[];const composer=mountDeepSeekComposer({context:()=>({key:'fixture',enabled:true,busy:false,chatBytes:0}),toast:text=>warnings.push(text)});
 const file={name:'too-large.png',type:'image/png',size:64*1024*1024+1};
 for(const type of ['paste','drop']){const event=new dom.window.Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,type==='paste'?'clipboardData':'dataTransfer',{value:{files:[file]}});document.getElementById(type==='paste'?'prompt':'chatForm').dispatchEvent(event);assert.ok(event.defaultPrevented);}
 const picker=document.querySelector('input[type=file]');Object.defineProperty(picker,'files',{value:[file]});picker.dispatchEvent(new dom.window.Event('change'));
 assert.equal(warnings.length,3);assert.ok(warnings.every(text=>text.includes('64 MiB')));assert.equal(composer.payload('').images.length,0);
});
