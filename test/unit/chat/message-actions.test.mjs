import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountMessageActions,openMessageEditor} from '../../../src/features/chat/message-actions.mjs';
import {chatViewSnapshot} from '../../../src/features/chat/chat-view-state.mjs';
test('assistant actions copy the latest streamed reply without an edit action or polluting saved history',()=>{
 const dom=new JSDOM('<div class="bubble assistant"><div class="message-content" data-raw-text=""></div></div>');const block=dom.window.document.querySelector('.bubble'),content=block.firstChild;let copied;
 block.messageCreatedAt='2026-10-17T18:27:00Z';const bar=mountMessageActions(block,{text:()=>content.dataset.rawText,createdAt:block.messageCreatedAt,onCopy:value=>copied=value});
 assert.equal(bar.querySelectorAll('app-button').length,1);assert.equal(chatViewSnapshot([{id:'a',nodes:[block]}])[0].messages.length,0);
 content.dataset.rawText='完整回复';content.textContent='完整回复';bar.querySelector('app-button').click();assert.equal(copied,'完整回复');const saved=chatViewSnapshot([{id:'a',nodes:[block]}])[0].messages[0];assert.equal(saved.text,'完整回复');assert.equal(saved.createdAt,block.messageCreatedAt);dom.window.close();
});
test('message actions copy only message text and preserve text, images and time through persistence',()=>{
 const dom=new JSDOM('<div class="bubble user"><div class="message-content">你好</div></div>');
 const block=dom.window.document.querySelector('.bubble');block.messageCreatedAt='2026-10-17T18:27:22Z';block.messageImages=[{url:'https://example.com/image.png'}];let copied,edits=0,busy=false;
 const bar=mountMessageActions(block,{text:'你好',createdAt:block.messageCreatedAt,onCopy:text=>copied=text,onEdit:()=>edits++,canEdit:()=>!busy});
 bar.querySelector('[aria-label="复制消息"]').click();assert.equal(copied,'你好');
 bar.querySelector('[aria-label="编辑消息"]').click();assert.equal(edits,1);busy=true;bar.querySelector('[aria-label="编辑消息"]').click();assert.equal(edits,1);
 const saved=chatViewSnapshot([{id:'a',nodes:[block]}])[0].messages[0];assert.equal(saved.text,'你好');assert.equal(saved.createdAt,block.messageCreatedAt);assert.deepEqual(saved.images,block.messageImages);
 dom.window.close();
});
test('editor keeps original message, handles failed send and cancels without submitting',async()=>{
 const dom=new JSDOM('<div class="bubble user"><div class="message-content">原消息</div></div>');const block=dom.window.document.querySelector('.bubble');let sent;
 const editor=openMessageEditor(block,{text:'原消息',onSend:async value=>{sent=value;throw new Error('连接失败');}});
 const input=editor.querySelector('wa-textarea');input.value='修改内容';await editor.querySelectorAll('app-button')[1].onclick();assert.equal(sent,'修改内容');assert.equal(block.querySelector('.message-content').textContent,'原消息');assert.equal(editor.querySelector('[role="alert"]').textContent,'连接失败');assert.equal(input.value,'修改内容');assert.equal(input.disabled,false);
 editor.querySelector('app-button').click();assert.equal(block.querySelector('.message-editor'),null);assert.equal(block.classList.contains('editing-message'),false);
 const next=openMessageEditor(block,{text:'原消息',onSend:async value=>{sent=value;}});next.querySelector('wa-textarea').value='重发';await next.querySelectorAll('app-button')[1].onclick();assert.equal(sent,'重发');assert.equal(block.querySelector('.message-content').textContent,'原消息');assert.equal(block.querySelector('.message-editor'),null);dom.window.close();
});
