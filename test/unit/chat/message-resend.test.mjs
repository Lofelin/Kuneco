import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../../src/app/renderer.js',import.meta.url),'utf8');
test('ordinary send appends with attachments without clearing an unrelated composer draft',async()=>{
 const bubbles=[{role:'user',text:'original'}],prompt={value:'unsent draft'},images=[{url:'https://example.com/a.png'}];let sent,saves=0;
 const context=vm.createContext({chatRecovery:{clear(){},show(){}},approvalCards:{activity(){},update(){},clear(){}},structuredClone,draftPersistence:{prepare:async()=>({}),dispatch:async()=>{},isCurrent:()=>true,accepted:async()=>{},settle:async()=>{}},chatNetworkReady:()=>true,authStates:{deepseek:{state:'signed-in'}},insightPanel:{maintaining:()=>false,refresh:()=>{},clearTurn:()=>{}},contextPicker:{close(){}},chatScroll:{jump(){}},Date,crypto,chatRuns:new Map(),updateSendButton(){},renderAuth(){},withChatView:(_id,fn)=>fn(),dispatchWorkspaceEvent(){},selectedEngine:'deepseek',activeChatId:'same-chat',chatSessions:[{id:'same-chat',title:'Existing'}],api:{cc:async message=>{sent=message;}},renderSessionList(){},bubble:(role,text,engine,pending,attachments,reasoning,createdAt)=>{bubbles.push({role,text,attachments,createdAt});return {};},deepseekComposer:{clear(){throw Error('draft must remain');}},$:()=>prompt,reasoningView(){},updateChatMessage(){},reply:null,saveChatView(){saves++;}});
 vm.runInContext(source.slice(source.indexOf('async function sendChatMessage('),source.indexOf("$('chatForm').onsubmit=")),context);
 await context.sendChatMessage({text:'edited',images,thinking:'enabled'});
 assert.deepEqual(sent.images,images);assert.notEqual(sent.images,images);assert.equal(bubbles[0].text,'original');assert.equal(bubbles[1].text,'edited');assert.deepEqual(bubbles[1].attachments,images);assert.ok(Date.parse(bubbles[1].createdAt));assert.equal(prompt.value,'unsent draft');assert.equal(saves,1);
 context.chatRuns.clear();context.api.cc=async()=>{throw Error('offline');};await assert.rejects(context.sendChatMessage({text:'retry',images}),/offline/);assert.equal(bubbles.length,3);assert.equal(prompt.value,'unsent draft');
});


test('editing a middle message drops its error and tail, while rejected preflight preserves all nodes',async()=>{
 const {JSDOM}=await import('jsdom');const {chatViewSnapshot}=await import('../../../src/features/chat/chat-view-state.mjs');
 const dom=new JSDOM('<div id="chat"></div>');const chat=dom.window.document.getElementById('chat');
 const bubble=(role,text)=>{const node=dom.window.document.createElement('div');node.className='bubble '+role;const content=dom.window.document.createElement('div');content.className='message-content';content.dataset.rawText=text;node.append(content);chat.append(node);return content;};
 bubble('user','keep');bubble('assistant','answer');bubble('assistant','');const editBlock=bubble('user','old').parentNode;bubble('error','failure');bubble('user','deleted tail');
 const sessions=[{id:'chat',title:'existing'}];let received;const snapshot=()=>chatViewSnapshot(sessions,{activeId:'chat',container:chat});
 const context=vm.createContext({chatRecovery:{clear(){},show(){}},approvalCards:{activity(){},update(){},clear(){}},structuredClone,draftPersistence:{prepare:async()=>({}),dispatch:async()=>{},isCurrent:()=>true,accepted:async()=>{},settle:async()=>{}},chatNetworkReady:()=>true,authStates:{deepseek:{state:'signed-in'}},insightPanel:{maintaining:()=>false,refresh:()=>{},clearTurn:()=>{}},contextPicker:{close(){}},chatScroll:{jump(){}},Date,crypto,chatRuns:new Map(),updateSendButton(){},renderAuth(){},withChatView:(_id,fn)=>fn(),dispatchWorkspaceEvent(){},selectedEngine:'deepseek',activeChatId:'chat',chatSessions:sessions,chatViewSnapshot,chatViewData:snapshot,api:{cc:async()=>{throw Error('preflight');}},renderSessionList(){},bubble,$:()=>chat,reasoningView(){},updateChatMessage(){},reply:null,saveChatView(){}});
 vm.runInContext(source.slice(source.indexOf('async function sendChatMessage('),source.indexOf("$('chatForm').onsubmit=")),context);
 const before=chat.innerHTML;await assert.rejects(context.sendChatMessage({text:'edited'},{editBlock}),/preflight/);assert.equal(chat.innerHTML,before);
 context.api.cc=async(message,rewind)=>{received=rewind;};await context.sendChatMessage({text:'edited'},{editBlock});
 assert.equal(received.index,2);assert.deepEqual(snapshot()[0].messages.map(m=>m.text),['keep','answer','edited']);assert.equal(chat.querySelectorAll('.error').length,0);
});
