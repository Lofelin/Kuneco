import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {mountDeepSeekComposer} from '../src/deepseek-composer.mjs';
test('DeepSeek attachment and thinking drafts are scoped and URL images retain detail',()=>{
 const dom=new JSDOM('<form id="chatForm"><textarea id="prompt"></textarea><div id="composeMenu"></div><button id="composeAdd"></button><select id="sessionNetworkMode"></select></form>',{url:'https://dingtu.test'});globalThis.document=dom.window.document;let key='owner:env:chat',enabled=true;const ui=mountDeepSeekComposer({context:()=>({key,enabled,busy:false}),toast:assert.fail});ui.render();const toggle=document.getElementById('deepseekThinking');assert.equal(toggle.localName,'app-button');assert.equal(toggle.getAttribute('aria-pressed'),'true');toggle.onclick();assert.equal(ui.payload('').thinking,'disabled');assert.equal(toggle.getAttribute('aria-pressed'),'false');toggle.onclick();assert.equal(ui.payload('').thinking,'enabled');
 document.querySelectorAll('#composeMenu wa-dropdown-item')[1].onclick();document.getElementById('deepseekImageURL').value='file:///secret';document.getElementById('deepseekImageSave').onclick();assert.match(document.getElementById('deepseekImageError').textContent,/链接/);document.getElementById('deepseekImageURL').value='https://example.com/image.png';document.getElementById('deepseekImageDetail').value='low';document.getElementById('deepseekImageSave').onclick();assert.equal(ui.payload('hello').images[0].detail,'low');
 key='other:env:chat';ui.render();assert.equal(ui.payload('').images.length,0);key='owner:env:chat';ui.render();assert.equal(ui.payload('').images.length,1);const chip=document.querySelector('.deepseek-image-chip');chip.onclick();const preview=document.getElementById('deepseekImagePreview');assert.equal(preview.open,true);assert.equal(preview.querySelector('wa-dropdown[slot=label] app-button').textContent,'图像');assert.ok(preview.querySelector('[aria-label="下载图片"]'));assert.ok(preview.querySelector('[aria-label="关闭图片预览"]'));assert.equal(preview.querySelector('img').src,'https://example.com/image.png');preview.open=false;chip.onkeydown({key:'Enter',target:chip,preventDefault(){}});assert.equal(preview.open,true);let stopped=false;chip.querySelector('app-button').onclick({stopPropagation(){stopped=true}});assert.equal(stopped,true);assert.equal(ui.payload('').images.length,0);ui.clear();assert.equal(ui.payload('').images.length,0);enabled=false;ui.render();assert.equal(document.getElementById('deepseekThinking').hidden,true);dom.window.close();
});

test('DeepSeek attachment menu icons exist in packaged assets',async()=>{
 const {access}=await import('node:fs/promises');for(const name of ['image','link','x','check','atom'])await access(new URL('../src/assets/icons/'+name+'.svg',import.meta.url));
});

test('thinking choice survives composer recreation and remains scoped by account environment and chat',()=>{
 const dom=new JSDOM('',{url:'https://dingtu.test'});globalThis.document=dom.window.document;let key='A:env1:chat1';
 const mount=()=>{document.body.innerHTML='<form id="chatForm"><div id="composeMenu"></div><button id="composeAdd"></button><textarea id="prompt"></textarea></form>';const ui=mountDeepSeekComposer({context:()=>({key,enabled:true,busy:false}),toast:assert.fail});ui.render();return ui;};
 let ui=mount();document.getElementById('deepseekThinking').onclick();assert.equal(ui.payload('').thinking,'disabled');
 ui=mount();assert.equal(ui.payload('').thinking,'disabled');assert.equal(document.getElementById('deepseekThinking').getAttribute('aria-pressed'),'false');
 for(const other of ['B:env1:chat1','A:env2:chat1','A:env1:chat2']){key=other;ui=mount();assert.equal(ui.payload('').thinking,'enabled');}
 key='A:env1:chat1';ui=mount();assert.equal(ui.payload('').thinking,'disabled');document.getElementById('deepseekThinking').onclick();ui=mount();assert.equal(ui.payload('').thinking,'enabled');dom.window.close();
});

test('Codex composer supports pasted images and scopes drafts without DeepSeek controls',async()=>{
 const dom=new JSDOM('<form id="chatForm"><textarea id="prompt"></textarea><div id="composeMenu"></div></form>',{url:'https://dingtu.test'});globalThis.document=dom.window.document;
 globalThis.FileReader=dom.window.FileReader;
 let key='owner:env:codex-chat';const ui=mountDeepSeekComposer({context:()=>({key,enabled:true,engine:'codex',busy:false}),toast:assert.fail});ui.render();
 assert.equal(document.getElementById('deepseekAddImages').hidden,false);
 assert.equal(document.getElementById('deepseekThinking').hidden,true);
 assert.equal(document.querySelectorAll('#composeMenu wa-dropdown-item')[1].hidden,true);
 const file=new dom.window.File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')],'screenshot.png',{type:'image/png'});
 const paste=new dom.window.Event('paste',{cancelable:true});Object.defineProperty(paste,'clipboardData',{value:{files:[file]}});document.getElementById('prompt').dispatchEvent(paste);
 for(let i=0;i<30&&!ui.payload('').images.length;i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(ui.payload('').images.length,1);assert.equal(document.querySelectorAll('.deepseek-image-chip').length,1);
 key='owner:other-env:codex-chat';ui.render();assert.equal(ui.payload('').images.length,0);
 key='owner:env:codex-chat';ui.render();assert.equal(ui.payload('').images.length,1);ui.clear();assert.equal(ui.payload('').images.length,0);dom.window.close();
});
