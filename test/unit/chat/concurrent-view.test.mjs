import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {JSDOM} from 'jsdom';
const source=await readFile(new URL('../../../src/app/renderer.js',import.meta.url),'utf8');
function harness(){
 const {window}=new JSDOM('<div id="chat"></div><input id="prompt"><button id="send"></button>');const {document}=window;
 let context;const $=id=>id==='chat' && context?.chatRenderContainer?context.chatRenderContainer:document.getElementById(id)||Object.assign(document.body.appendChild(document.createElement('div')),{id});
 const chatSessions=['a','b','c'].map(id=>({id,engine:'deepseek',model:id,title:id,nodes:[]}));const calls=new Map();let saved=[];
 const noop=()=>{};context=vm.createContext({Date,crypto,document,$,chatRenderContainer:null,chatSessions,chatRuns:new Map(),activeChatId:'a',selectedEngine:'deepseek',selectedCodexModel:'a',busy:false,reply:null,chatOwnerID:'owner',dockerEnvironmentState:{activeId:'env'},authStates:{deepseek:{state:'signed-in'}},approvals:[],pendingChatMerges:[],
 api:{cc:(message,rewind,id,requestId)=>new Promise((resolve,reject)=>calls.set(id,{message,rewind,requestId,resolve,reject}))},renderSessionList:noop,renderChatAvailability:noop,renderRuntime:noop,renderSessionHeader:noop,renderProfileActivity:noop,renderAuth:noop,renderApproval:noop,chatNetworkReady:()=>true,applyChatMerge:noop,createIcon:()=>document.createElement('span'),deepseekComposer:{render:noop,clear:noop},finishReasoning:noop,reasoningView:noop,
 updateChatMessage:(node,text)=>{node.textContent=text;node.dataset.rawText=text;},saveChatView:()=>{saved.push($('chat').textContent);},
 bubble:(role,text,_engine,pending)=>{const node=document.createElement('div');node.className='bubble '+role;const content=document.createElement('div');content.className='message-content'+(pending?' reply-loading':'');content.dataset.rawText=text;content.textContent=text;node.append(content);$('chat').append(node);return content;}
 });
 for(const [start,end] of [['function updateSendButton(){',"$('send').onclick="],['async function sendChatMessage(',"$('chatForm').onsubmit="],['function handleWorkspaceEvent(type,data){','// Runtime events carry'],['function withChatView(', 'api.onEvent(dispatchWorkspaceEvent);']])vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),context);
 const select=id=>{chatSessions.find(s=>s.id===context.activeChatId).nodes=[...$('chat').childNodes];context.activeChatId=id;context.selectedCodexModel=id;$('chat').replaceChildren(...chatSessions.find(s=>s.id===id).nodes);context.busy=context.chatRuns.has(id);context.reply=context.chatRuns.get(id)?.reply || null;context.updateSendButton();};
 const emit=(id,type,data,requestId=calls.get(id).requestId)=>context.dispatchWorkspaceEvent({chatId:id,requestId,type,data,owner:'owner',environmentId:'env'});
 const text=id=>id===context.activeChatId?$('chat').textContent:chatSessions.find(s=>s.id===id).nodes.map(n=>n.textContent).join('');
 return {context,calls,select,emit,text,$};
}
test('interleaved requests queue preflight output and route background replies without disturbing active draft or controls',async()=>{
 const h=harness();const a=h.context.sendChatMessage('A');h.emit('a','ccStart',{});h.emit('a','ccText','a early');
 h.select('b');assert.equal(h.context.busy,false);const b=h.context.sendChatMessage('B');h.emit('b','ccStart',{});h.calls.get('b').resolve();await b;
 h.$('prompt').value='draft b';h.calls.get('a').resolve();await a;assert.equal(h.context.activeChatId,'b');assert.equal(h.$('prompt').value,'draft b');assert.match(h.text('a'),/Aa early/);assert.equal(h.text('b'),'B');
 h.emit('b','ccText','b text');h.emit('a','ccText','a late');h.emit('a','ccEnd',{});
 assert.equal(h.context.busy,true);assert.equal(h.$('send').getAttribute('aria-label'),'停止回复');assert.match(h.text('a'),/a earlya late/);assert.doesNotMatch(h.text('b'),/a early|a late/);
 h.select('a');assert.equal(h.context.busy,false);assert.equal(h.$('chat').classList.contains('reply-in-progress'),false);
 h.select('b');assert.equal(h.$('chat').classList.contains('reply-in-progress'),true);h.emit('b','ccEnd',{});assert.equal(h.context.busy,false);
 const before=h.text('b');h.emit('b','ccText','stale');assert.equal(h.text('b'),before);
});
test('failed preflight in one conversation does not stop another running conversation',async()=>{
 const h=harness();const a=h.context.sendChatMessage('A');h.calls.get('a').resolve();await a;h.emit('a','ccStart',{});
 h.select('b');const b=h.context.sendChatMessage('B');h.calls.get('b').reject(new Error('offline'));await assert.rejects(b,/offline/);
 assert.equal(h.context.chatRuns.has('a'),true);assert.equal(h.context.chatRuns.has('b'),false);assert.equal(h.text('b'),'');h.emit('a','ccText','still running');assert.match(h.text('a'),/still running/);
});
test('background streaming leaves the mounted conversation and composer untouched',async()=>{
 const h=harness();const a=h.context.sendChatMessage('A');h.calls.get('a').resolve();await a;h.emit('a','ccStart',{});h.select('b');
 const live=h.$('chat'),marker=live.ownerDocument.createElement('div');marker.textContent='visible B';live.append(marker);
 const observer=new live.ownerDocument.defaultView.MutationObserver(()=>{});observer.observe(live,{subtree:true,childList:true,characterData:true});let refreshes=0;h.context.renderRuntime=()=>refreshes++;
 for(let n=0;n<500;n++)h.emit('a','ccText','x');
 assert.equal(observer.takeRecords().length,0);assert.equal(marker.isConnected,true);assert.equal(refreshes,0);assert.equal(h.text('a').length,501);observer.disconnect();
});
