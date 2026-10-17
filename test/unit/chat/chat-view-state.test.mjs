import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {chatViewSnapshot} from '../../../src/features/chat/chat-view-state.mjs';import {mergeChatPayload} from '../../../src/features/chat/chat-sync.mjs';import {reasoningView,finishReasoning} from '../../../src/features/chat/reasoning-view.mjs';
test('active image turn survives a stale node list, cloud merge and history serialization',()=>{
 const dom=new JSDOM('<div id="chat"><div class="bubble user"><div>old question</div></div></div>');const doc=dom.window.document,chat=doc.getElementById('chat');const items=[{id:'one',nodes:[...chat.childNodes]}];const base={sessions:[{id:'one'}],views:chatViewSnapshot(items,{activeId:'one',container:chat})};
 const user=doc.createElement('div');user.className='bubble user';user.messageImages=[{name:'test.png',dataURL:'data:image/png;base64,fixture'}];user.innerHTML='<div>这都是谁</div>';chat.append(user);
 const answer=doc.createElement('div');answer.className='bubble assistant';answer.innerHTML='<div></div>';chat.append(answer);
 const local={sessions:base.sessions,views:chatViewSnapshot(items,{activeId:'one',container:chat})};assert.equal(local.views[0].messages.length,2);assert.equal(local.views[0].messages[1].images.length,1);
 const merged=mergeChatPayload(base,local,{...base,activeAISessionId:'one'});const restored=JSON.parse(JSON.stringify(merged));assert.equal(restored.views[0].messages[1].text,'这都是谁');assert.equal(restored.views[0].messages[1].images[0].dataURL,user.messageImages[0].dataURL);dom.window.close();
});
test('Codex process shows elapsed time, completes and restores its public process summary',()=>{
 const dom=new JSDOM('<div class="bubble assistant"><div id="reply"></div></div>');globalThis.document=dom.window.document;const content=document.getElementById('reply'),render=(node,text)=>node.textContent=text;
 reasoningView(content,{kind:'process',text:'正在搜索网页：天气',startedAt:Date.now()-11000},render);assert.match(content.parentNode.querySelector('summary').textContent,/用时 11 秒/);finishReasoning(content,render);
 const state=content.parentNode.messageReasoning;assert.equal(state.kind,'process');assert.equal(content.parentNode.querySelector('details').open,false);
 const saved=chatViewSnapshot([{id:'one',nodes:[content.parentNode]}])[0].messages[0].reasoning;const copy=document.createElement('div'),reply=document.createElement('div');copy.append(reply);reasoningView(reply,{...saved,complete:true},render);assert.match(copy.querySelector('summary').textContent,/用时 11 秒/);assert.match(copy.querySelector('details').textContent,/正在搜索网页/);dom.window.close();
});
