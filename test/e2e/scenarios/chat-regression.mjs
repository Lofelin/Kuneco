import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {decodeChatPayload} from '../../../src/features/chat/chat-object-store.mjs';

// Every former smoke assertion is mapped, including expectations that depended
// on its synthetic renderer (thinking labels and an omitted pending assistant).
export const chatRegressionMapping={
 'D01':['chat-drafts','reload restores draft text'], 'D02':['chat-drafts','reload restores image bytes'],
 'D03':['chat-drafts','pending/unknown outbox survive reload'], 'D04':['chat-drafts','owner/environment/chat IndexedDB isolation'],
 'D05':['chat-drafts','concurrent draft save and real success settlement preserve draft and unrelated outbox'],
 'D06':['chat-drafts','native IndexedDB read barrier plus real conversation change refuses stale send'],
 'C01':['codex-turn','HTTP revision conflict emits chatMerged while runtime is active; renderer defers applying it'],
 'C02':['codex-turn','images survive deferred merge and reload'], 'C03':['codex-turn','restored transcript retains user/assistant messages'],
 'C04':['codex-turn','actual process duration reaches 11 seconds'], 'C05':['codex-turn','actual process text retained'],
 'C06':['codex-turn','restored reasoning kind is process'], 'C07':['codex-turn','three completed runtime activities retained'],
 'M01':['message-actions','both roles default/hover/leave opacity, timestamps and action counts'],
 'M02':['message-actions','light/dark keyboard focus, 1400/900 content widths, 18px controls and 12px icons'],
 'M03':['message-actions','actual clipboard receives latest streamed raw assistant and user source'],
 'M04':['message-actions','cancel editor never starts a CLI request'],
 'M05':['message-actions','edit first message rewinds complete three-message failed turn'],
 'M06':['message-actions','edit removes old error messages'], 'M07':['message-actions','edited send retains exactly one original image'],
 'M08':['message-actions','detached original message source remains unchanged'], 'M09':['message-actions','edit preserves independent composer draft'],
 'M10':['message-actions','saved replacement user timestamp and rewind prefix; real pending assistant is retained unlike old stub'],
 'M11':['message-actions','all actual action icons contain SVG geometry'],
 'I01':['message-images','completed process restores measured duration; thinking label is unavailable in local Codex'],
 'I02':['message-images','two image thumbnails square, same row, above text, right aligned and transparent'],
 'I03':['message-images','actual history thumbnail opens mounted image gallery'],
 'I04':['message-images','all actual dialog backdrops and transparent image preview'],
 'I05':['message-images','nine real transmitted images and more-than-five history images survive reload'],
 'R01':['reasoning-state','local Codex immediately enters process; test actual no-activity 5-second interval instead of fabricated thinking wait'],
 'R02':['reasoning-state','manual collapse survives streamed process updates'],
 'R03':['reasoning-state','stopped remains terminal across following end and reload'],
 'R04':['reasoning-state','manual expanded preference restores'], 'R05':['reasoning-state','in-progress activity becomes failed'],
 'R06':['reasoning-state','terminal timer is null'], 'R07':['reasoning-state','native keyboard fold records false preference and zero content height'],
 'R08':['reasoning-state','dark narrow actual chat column expands with no horizontal overflow'],
};

export async function verifyChatRegression(ctx){
 const {evaluate:expression,until,client,temp,accountChats,accountChatObjects,captureUI}=ctx;
 const e=(fn,...args)=>expression(`(${fn.toString()})(...${JSON.stringify(args)})`);
 const tick=()=>e(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const click=selector=>e(async selector=>{const node=document.querySelector(selector);if(!node)throw Error('Missing actual control '+selector);await node.updateComplete;node.click();},selector);
 const state=()=>expression('workspace.state()');
 const output=path.resolve('artifacts/chat-regression');await mkdir(output,{recursive:true});
 const project=path.join(temp,'chat-regression-project');await mkdir(project,{recursive:true});
 const receipts=path.join(project,'.chat-regression');await mkdir(receipts,{recursive:true});
 const evidence={},covered=new Set(),mark=(id,value=true)=>{covered.add(id);evidence[id]=value;};
 const initial=await state();assert.ok(initial.chatOwner,'requires the signed-in local fixture account');assert.match(await e(()=>location.href),/\/src\/index\.html$/);
 const owner=initial.chatOwner;
 const scope=chatId=>({owner,environmentId:null,chatId});
 const readDraft=async value=>e(async value=>{const {createDraftStore,draftScopeKey}=await import('./features/chat/draft-store.mjs');return createDraftStore().read(draftScopeKey(value));},value);
 const currentView=async chatId=>(await state()).chatViews.find(view=>view.id===chatId);
 const reload=async()=>{const origin=await e(()=>performance.timeOrigin);await client.call('Page.reload');await until(()=>e(origin=>performance.timeOrigin!==origin&&performance.getEntriesByName('chat-records-ready').length>0,origin));};
 const ready=()=>until(()=>e(()=>!document.getElementById('prompt').disabled&&!document.getElementById('deepseekAddImages').hidden&&!document.getElementById('deepseekAddImages').disabled));
 const select=async(chatId,{running=false}={})=>{await click(`#sessionList [data-session-id="${chatId}"]`);await until(async()=>{const value=await state();return value.activeAISessionId===chatId&&await e(chatId=>document.querySelector('#sessionList [data-session-id].active')?.dataset.sessionId===chatId&&!document.getElementById('deepseekAddImages').hidden,chatId);});if(!running)await ready();};
 const newSession=async(network='direct')=>{
  await expression('workspace.runtimeInfo({detect:true})');await click('[data-page=runtime]');await click('[data-page=cc]');await until(()=>e(()=>!document.getElementById('railNewSession').disabled));await click('#railNewSession');await until(()=>e(()=>document.getElementById('newSessionDialog').open));
  await e(network=>{document.getElementById('runtimeEngine').value='codex';document.getElementById('runtimeEngine').dispatchEvent(new Event('change'));document.getElementById('chatNetworkMode').value=network;},network);
  await click('#createNewSession');await until(()=>e(()=>!document.getElementById('newSessionDialog').open));const chatId=(await state()).activeAISessionId;await e(project=>workspace.project({mode:'local',path:project}),project);await reload();await ready();return chatId;
 };
 const prompt=async text=>{await e(text=>{const input=document.getElementById('prompt');input.value=text;input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));},text);};
 const images=async count=>{await e(async count=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=200;const g=canvas.getContext('2d');g.fillStyle='#c4c9df';g.fillRect(0,0,200,200);g.fillStyle='#68749d';g.fillRect(30,30,140,140);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),transfer=new DataTransfer();for(let i=0;i<count;i++)transfer.items.add(new File([blob],`regression-${i}.png`,{type:'image/png'}));document.getElementById('prompt').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,composed:true,cancelable:true}));},count);await until(()=>e(count=>document.querySelectorAll('#deepseekAttachments .deepseek-image-chip').length===count,count));};
 const sequences=new Map();
 const receipt=async id=>{try{return JSON.parse(await readFile(path.join(receipts,id+'.receipt.json'),'utf8'));}catch{return null;}};
 const start=async(id,text=id)=>{await prompt(`KUNECO_CHAT_REGRESSION:${id} ${text}`);await until(()=>e(()=>document.getElementById('send').getAttribute('aria-label')==='发送消息'));await click('#send');return until(()=>receipt(id));};
 const control=async(id,events=[],finish=false,failure)=>{const sequence=(sequences.get(id)||0)+1;sequences.set(id,sequence);const target=path.join(receipts,id+'.control.json');await writeFile(target+'.tmp',JSON.stringify({sequence,events,finish,failure}));await rename(target+'.tmp',target);await until(async()=>(await receipt(id))?.sequence===sequence);};
 const processText=text=>({method:'item/reasoning/summaryTextDelta',params:{delta:text}});
 const activity=(id,type,status='completed')=>({method:status==='in_progress'?'item/started':'item/completed',params:{item:{id,type,status,...(type==='commandExecution'?{command:'printf regression',aggregatedOutput:'test',exitCode:0}:type==='fileChange'?{changes:[{path:path.join(project,'example.txt'),before:'old\n',after:'new\n',beforeExists:true,afterExists:true}]}:{path:path.join(project,'regression-0.png')})}}});
 const answer=text=>({method:'item/agentMessage/delta',params:{itemId:'answer',delta:text}});
 const idle=()=>until(()=>e(()=>document.getElementById('send').getAttribute('aria-label')!=='停止回复'));
 const capture=async name=>{const image=await captureUI();await writeFile(path.join(output,name+'.png'),Buffer.from(image.data,'base64'));};
 const theme=async value=>{await e(value=>{document.getElementById('themeSelect').value=value;document.getElementById('themeSelect').dispatchEvent(new Event('change'));},value);await tick();};
 let themeBefore=await e(()=>document.getElementById('themeSelect').value),columnBefore;
 try{
  // D01-D05: real durable prepare/dispatch/settle plus native IndexedDB reload.
  const drafts=await newSession('proxy');await expression('workspace.disconnect()');await prompt('保存但未发送');await click('#send');await until(async()=>(await readDraft(scope(drafts))).outbox.some(item=>item.status==='pending'));
  await e(id=>workspace.sessionNetwork(id,'direct'),drafts);await ready();await images(1);await start('draft-unknown','保持未知回执');await until(async()=>(await readDraft(scope(drafts))).outbox.some(item=>item.status==='unknown'));
  await control('draft-unknown',[processText('draft failure process')],true,'fixture draft failure');await idle();
  await prompt('持久化草稿');await images(1);await until(async()=>(await readDraft(scope(drafts))).draft.text==='持久化草稿');const savedDraft=await readDraft(scope(drafts));await reload();await ready();
  assert.equal(await e(()=>document.getElementById('prompt').value),'持久化草稿');mark('D01');const restored=await readDraft(scope(drafts));assert.deepEqual(restored.draft.images,savedDraft.draft.images);assert.equal(restored.draft.images.length,1);mark('D02');assert.deepEqual(restored.outbox.map(value=>value.status),['pending','unknown']);mark('D03');
  const others=await Promise.all([{...scope(drafts),owner:'other-fixture-owner'},{...scope(drafts),environmentId:'other-fixture-environment'},{...scope(drafts),chatId:'other-fixture-chat'}].map(readDraft));assert(others.every(record=>record.draft.text===''&&record.outbox.length===0));mark('D04');
  await start('draft-atomic','dispatch concurrent save');await prompt('new draft');await control('draft-atomic',[answer('atomic completed')],true);await idle();await until(async()=>(await readDraft(scope(drafts))).outbox.length===2);const atomic=await readDraft(scope(drafts));assert.equal(atomic.draft.text,'new draft');assert.deepEqual(atomic.outbox.map(value=>value.id),restored.outbox.map(value=>value.id));mark('D05');

  // D06: hold an actual IndexedDB transaction; a real session switch invalidates
  // the pending real renderer submit before any runtime IPC dispatch can occur.
  const raceOther=await newSession();await select(drafts);
  await e(async()=>{const request=indexedDB.open('kuneco-chat-drafts',1),db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const tx=db.transaction('conversations','readwrite'),store=tx.objectStore('conversations');let held=true;const pump=()=>{const get=store.get('__regression_barrier__');get.onsuccess=()=>{if(held)pump();};};pump();window.__chatRegressionRelease=()=>{held=false;};tx.oncomplete=()=>db.close();});
  await click(`#sessionList [data-session-id="${raceOther}"]`);await until(async()=>(await state()).activeAISessionId===raceOther);
  await e(()=>{document.getElementById('prompt').value='KUNECO_CHAT_REGRESSION:scope-race stale send';document.getElementById('chatForm').requestSubmit();});
  await click(`#sessionList [data-session-id="${drafts}"]`);await until(async()=>(await state()).activeAISessionId===drafts);await e(()=>{window.__chatRegressionRelease();delete window.__chatRegressionRelease;});await ready();
  await until(()=>e(()=>document.getElementById('toast').textContent.includes('对话已变化')));assert.equal(await receipt('scope-race'),null);assert.equal((await readDraft(scope(raceOther))).outbox.length,0);mark('D06');

  // A real turn supplies the three historical rows (user/assistant/error) used
  // by the action smoke, including streamed raw text and a real failed status.
  const actions=await newSession();await images(1);const actionsText='KUNECO_CHAT_REGRESSION:actions 原消息';await start('actions','原消息');await control('actions',[answer('完整 ')]);await control('actions',[answer('**回复**')],true,'old failure');await idle();
  await until(()=>e(()=>document.querySelectorAll('#chat .bubble').length===3));
  await e(()=>{window.__chatRegressionOriginal=document.querySelector('#chat .bubble.user');});
  for(const index of [0,1]){
   const selector=index?'#chat .bubble.assistant':'#chat .bubble.user';await e(selector=>document.querySelector(selector).scrollIntoView({block:'center'}),selector);await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:3,y:3});await tick();
   const read=()=>e(selector=>{const block=document.querySelector(selector),bar=block.querySelector('.message-actions'),r=block.getBoundingClientRect();return {opacity:getComputedStyle(bar).opacity,time:bar.querySelector('time')?.textContent,count:bar.querySelectorAll('app-button').length,x:r.left+r.width/2,y:r.top+Math.min(r.height/2,20)};},selector);
   const before=await read();assert.equal(before.opacity,'0');assert.match(before.time,/\d{1,2}:\d{2} [AP]M/);assert.equal(before.count,index?1:2);await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:before.x,y:before.y});await tick();assert.equal((await read()).opacity,'1');await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:3,y:3});await tick();assert.equal((await read()).opacity,'0');
  }mark('M01');
  columnBefore=await e(()=>document.querySelector('.chat-column').getAttribute('style'));
  for(const width of [1400,900])for(const dark of [false,true]){await e(width=>{const column=document.querySelector('.chat-column');column.style.width=width+'px';column.style.maxWidth='100%';column.style.flex='0 1 '+width+'px';},width);await theme(dark?'dark':'light');const geometry=await e(async()=>{const out=[];for(const block of document.querySelectorAll('#chat .bubble.user,#chat .bubble.assistant')){const bar=block.querySelector('.message-actions'),button=bar.querySelector('app-button');await button.updateComplete;button.shadowRoot.querySelector('button').focus();const r=bar.getBoundingClientRect(),br=button.getBoundingClientRect();out.push({opacity:getComputedStyle(bar).opacity,within:r.right<=innerWidth,width:br.width,icon:button.querySelector('wa-icon').getBoundingClientRect().width});button.shadowRoot.querySelector('button').blur();}return out;});for(const value of geometry){assert.equal(value.opacity,'1');assert(value.within);assert.equal(value.width,18);assert.equal(value.icon,12);}}mark('M02');
  await click('#chat .bubble.assistant [aria-label="复制消息"]');assert.equal(await e(()=>navigator.clipboard.readText()),'完整 **回复**');await click('#chat .bubble.user [aria-label="复制消息"]');assert.equal(await e(()=>navigator.clipboard.readText()),actionsText);mark('M03');
  await prompt('未发送草稿');await click('#chat .bubble.user [aria-label="编辑消息"]');await until(()=>e(()=>!!document.querySelector('.message-editor')));await e(()=>{document.querySelector('.message-editor wa-textarea').value='取消修改';});await click('.message-editor-actions app-button');assert.equal(await receipt('edited'),null);assert.equal(await e(()=>document.querySelectorAll('.message-editor').length),0);mark('M04');
  const beforeEdit=await currentView(actions);assert.equal(beforeEdit.messages.length,3);await click('#chat .bubble.user [aria-label="编辑消息"]');await e(()=>{document.querySelector('.message-editor wa-textarea').value='KUNECO_CHAT_REGRESSION:edited 修改后发送';});await click('.message-editor-actions app-button.primary');const edited=await until(()=>receipt('edited'));
  await until(()=>e(()=>document.querySelectorAll('#chat .bubble.error').length===0));assert.equal((await state()).aiSessions.find(value=>value.id===actions).contextPrefix.length,0);mark('M05');mark('M06');assert.equal(edited.input.filter(item=>item.type==='image'||item.type==='localImage').length,1);assert(edited.input.some(item=>item.text?.includes('修改后发送')));mark('M07');assert.equal(await e(()=>window.__chatRegressionOriginal.querySelector('.message-content').textContent),actionsText);mark('M08');assert.equal(await e(()=>document.getElementById('prompt').value),'未发送草稿');mark('M09');
  const editedView=await currentView(actions);assert.equal(editedView.messages.filter(message=>message.role==='user').length,1);assert.equal(editedView.messages[0].text,'KUNECO_CHAT_REGRESSION:edited 修改后发送');assert(editedView.messages[0].createdAt);mark('M10',{savedRows:editedView.messages.length,note:'real renderer retains current pending assistant'});
  await until(()=>e(()=>[...document.querySelectorAll('.message-action wa-icon')].every(icon=>icon.shadowRoot?.querySelector('svg path,svg rect'))));mark('M11');await control('edited',[answer('edited completed')],true);await idle();

  // Complete history, a real revision-conflict merge, and nine native images.
  const history=await newSession();await images(9);await start('history','图里面是什么？');const historyReceipt=await receipt('history');assert.equal(historyReceipt.input.filter(value=>value.type==='image'||value.type==='localImage').length,9);
  const noActivityStarted=Date.now();await until(()=>e(()=>document.querySelector('#chat .bubble.assistant')?.messageReasoning?.processMs>=5000||document.querySelector('#chat .bubble.assistant')?.messageReasoning?.durationMs>=5000));mark('R01',{elapsed:Date.now()-noActivityStarted,kind:'process'});
  await control('history',[processText('正在分析用户附加的图片。'+('长内容会自然换行。'.repeat(50))),activity('cmd1','commandExecution','in_progress')]);
  await click('#chat .deepseek-reasoning summary');await control('history',[processText('追加内容仍保持手动收起。')]);assert.equal(await e(()=>document.querySelector('#chat .deepseek-reasoning').open),false);mark('R02');await click('#chat .deepseek-reasoning summary');
  const cloudKey='fixture-account-'+owner;
  assert(accountChatObjects instanceof Map,'desktop context must expose its existing accountChatObjects fixture Map');
  await e(async()=>{const {chatViewSnapshot}=await import('./features/chat/chat-view-state.mjs');window.__chatRegressionMerged=[];window.__chatRegressionSyncErrors=[];window.__chatRegressionEndSnapshot=null;window.__chatRegressionUnsubscribe=workspace.onEvent(event=>{if(event.type==='chatMerged')window.__chatRegressionMerged.push(event);if(event.type==='chatSyncError')window.__chatRegressionSyncErrors.push(event);if(event.type==='ccEnd')window.__chatRegressionEndSnapshot={event,status:document.getElementById('chatStorageStatus').textContent,activeDOM:chatViewSnapshot([{id:event.chatId,nodes:[...document.getElementById('chat').childNodes]}])};});});
  // Flush all previous real IPC saves before advancing the HTTP fixture. Use the
  // exact committed cloud graph as the remote base; rebuilding it from a state
  // projection can change unrelated fields and produce a genuine sync conflict.
  await e(async()=>{const value=await workspace.state();await workspace.saveChats(value.chatViews,value.chatOwner,value.containerId||null);});
  await until(()=>accountChats.has(cloudKey));const cloud=accountChats.get(cloudKey);
  const remotePayload=structuredClone(await decodeChatPayload(cloud.payload,async(id,environment)=>{
   const key=cloudKey+':/v1/me/chat-objects/'+encodeURIComponent(environment)+'/'+id;
   if(!accountChatObjects.has(key))throw Error('Missing actual cloud fixture object '+key);
   return accountChatObjects.get(key);
  }));
  const remoteView=remotePayload.views.find(value=>value.id===raceOther);assert(remoteView,'race conversation must already be committed to cloud');remoteView.messages.push({role:'user',text:'迟到云端合并回执',createdAt:new Date().toISOString()});
  accountChats.set(cloudKey,{revision:cloud.revision+1,payload:remotePayload});
  // This is the production preload API, not a replaced bridge or synthetic event.
  // The account HTTP fixture now returns 409 and main performs its real merge.
  await e(async()=>{const value=await workspace.state();await workspace.saveChats(value.chatViews,value.chatOwner,value.containerId||null);});
  await until(()=>e(()=>window.__chatRegressionMerged.length>0)).catch(async error=>{throw new Error(error.message+'; actual sync diagnostics: '+JSON.stringify(await e(()=>({errors:window.__chatRegressionSyncErrors,status:document.getElementById('chatStorageStatus').textContent}))));});
  await select(raceOther);assert.equal(await e(()=>document.getElementById('chat').textContent.includes('迟到云端合并回执')),false);await select(history,{running:true});mark('C01');
  await until(()=>e(()=>document.querySelector('#chat .bubble.assistant')?.messageReasoning?.durationMs>=11000));await control('history',[activity('cmd1','commandExecution'),activity('file1','fileChange'),activity('img1','imageView'),answer('图片主体为红色。')],true);await idle();
  await until(async()=>(await currentView(history))?.messages.at(-1)?.reasoning?.processMs>=11000);const historyView=await currentView(history);assert.equal(historyView.messages.filter(message=>message.images?.length).length,1);mark('C02');assert.equal(historyView.messages.length,2);mark('C03',{messages:2,note:'real sent turn is user plus assistant; old synthetic base added one user'});assert(historyView.messages.at(-1).reasoning.processMs>=11000);const durationLabel=await e(()=>document.querySelector('#chat .deepseek-reasoning summary').textContent);assert(Number(/用时 (\d+) 秒/.exec(durationLabel)?.[1])>=11);mark('C04',{processMs:historyView.messages.at(-1).reasoning.processMs,label:durationLabel});assert.match(historyView.messages.at(-1).reasoning.text,/正在分析/);mark('C05');assert.equal(historyView.messages.at(-1).reasoning.kind,'process');mark('C06');assert.equal(historyView.messages.at(-1).reasoning.activities.length,3);mark('C07');
  await select(raceOther);await until(()=>e(()=>document.getElementById('chat').textContent.includes('迟到云端合并回执'))).catch(async error=>{
   const diagnostic=await e(async()=>{const {chatViewSnapshot}=await import('./features/chat/chat-view-state.mjs');const value=await workspace.state();return {status:document.getElementById('chatStorageStatus').textContent,events:window.__chatRegressionMerged,errors:window.__chatRegressionSyncErrors,endSnapshot:window.__chatRegressionEndSnapshot,main:value,activeDOM:chatViewSnapshot([{id:value.activeAISessionId,nodes:[...document.getElementById('chat').childNodes]}])};});
   const {mergeChatPayload}=await import('../../../src/features/chat/chat-sync.mjs');
   diagnostic.reproductions=diagnostic.events.map(event=>{const data=event.data,results={};for(const part of ['views','all']){try{const local={sessions:diagnostic.main.aiSessions,views:diagnostic.main.chatViews};const base=part==='views'?{views:data.base.views}:data.base,remote=part==='views'?{views:data.payload.views}:data.payload;results[part]={ok:true,result:mergeChatPayload(base,part==='views'?{views:local.views}:local,remote)};}catch(failure){results[part]={ok:false,code:failure.code,message:failure.message};}}return results;});
   await writeFile(path.join(output,'merge-failure.json'),JSON.stringify(diagnostic,null,2));throw error;
  });await select(history);await reload();await ready();
  const layout=await e(async()=>{const block=document.querySelector('#chat .bubble.user'),buttons=block.querySelectorAll('.message-image');await Promise.all([...buttons].map(button=>button.updateComplete));await Promise.all([...buttons].map(button=>button.querySelector('img').decode()));const a=buttons[0].getBoundingClientRect(),b=buttons[1].getBoundingClientRect(),text=block.querySelector('.message-content').getBoundingClientRect();return {count:buttons.length,width:a.width,height:a.height,sameRow:Math.abs(a.top-b.top)<1,above:block.querySelector('.message-images').getBoundingClientRect().bottom<=text.top,rightAligned:Math.abs(block.querySelector('.message-images').getBoundingClientRect().right-text.right)<1,background:getComputedStyle(block).backgroundColor};});
  assert.equal(layout.count,9);assert.equal(layout.width,layout.height);assert(layout.sameRow);assert(layout.above);assert(layout.rightAligned);assert.equal(layout.background,'rgba(0, 0, 0, 0)');mark('I02',layout);mark('I05');
  const restoredReasoning=await e(()=>{const state=document.querySelector('#chat .bubble.assistant').messageReasoning;return {kind:state.kind,phase:state.phase,durationMs:state.durationMs,text:state.text,timer:state.timer};});assert.equal(restoredReasoning.phase,'completed');assert(restoredReasoning.durationMs>=11000);assert.match(restoredReasoning.text,/正在分析/);mark('I01',restoredReasoning);
  await click('#chat .message-image');await until(()=>e(()=>document.getElementById('deepseekImagePreview').open));mark('I03');
  const backdrops=await e(async()=>{await Promise.all([...document.querySelectorAll('app-dialog')].map(dialog=>dialog.updateComplete));return [...document.querySelectorAll('app-dialog')].map(host=>{const dialog=host.shadowRoot.querySelector('dialog'),style=getComputedStyle(dialog,'::backdrop');return {id:host.id,color:style.backgroundColor,filter:style.backdropFilter,panel:getComputedStyle(dialog).backgroundColor};});});for(const value of backdrops){assert.equal(value.color,'rgba(160, 165, 175, 0.18)',value.id);assert.equal(value.filter,'blur(4px)',value.id);if(value.id==='deepseekImagePreview')assert.equal(value.panel,'rgba(0, 0, 0, 0)');}mark('I04',backdrops.length);await capture('message-images');await click('#deepseekImagePreview [aria-label="关闭图片预览"]');await until(()=>e(()=>!document.getElementById('deepseekImagePreview').shadowRoot.querySelector('dialog').open));

  // Real stop/error/end ordering: no direct reasoningView/finishReasoning calls.
  const stopped=await newSession();await start('stopped','停止状态');await control('stopped',[processText('停止前的运行时过程。'+('长内容会自然换行。'.repeat(50))),activity('stop-command','commandExecution','in_progress')]);await until(()=>e(()=>!!document.querySelector('#chat .deepseek-reasoning')));if(await e(()=>document.querySelector('#chat .deepseek-reasoning').open))await click('#chat .deepseek-reasoning summary');await click('#chat .deepseek-reasoning summary');assert.equal(await e(()=>document.querySelector('#chat .bubble.assistant').messageReasoning.userExpanded),true);await click('#send');await idle();
  const stopState=await e(()=>{const state=document.querySelector('#chat .bubble.assistant').messageReasoning;return {phase:state.phase,timer:state.timer,userExpanded:state.userExpanded};});assert.equal(stopState.phase,'stopped');assert.equal(stopState.timer,null);mark('R03');mark('R06');await until(async()=>(await currentView(stopped))?.messages.findLast(message=>message.role==='assistant')?.reasoning?.userExpanded===true);await reload();await ready();assert.equal(await e(()=>document.querySelector('#chat .deepseek-reasoning').open),true);mark('R04');
  await e(()=>document.querySelector('#chat .deepseek-reasoning summary').focus());await client.call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await client.call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});await until(()=>e(()=>{const d=document.querySelector('#chat .deepseek-reasoning');return !d.open&&parseFloat(getComputedStyle(d,'::details-content').height)===0;}));assert.equal(await e(()=>document.querySelector('#chat .bubble.assistant').messageReasoning.userExpanded),false);mark('R07');await capture('reasoning-state-light');
  await theme('dark');await e(()=>{const column=document.querySelector('.chat-column');column.style.width='650px';column.style.flex='0 1 650px';});await click('#chat .deepseek-reasoning summary');await until(()=>e(()=>parseFloat(getComputedStyle(document.querySelector('#chat .deepseek-reasoning'),'::details-content').height)>0));const narrow=await e(()=>{const d=document.querySelector('#chat .deepseek-reasoning');return {open:d.open,overflow:d.scrollWidth>d.clientWidth+1};});assert(narrow.open);assert.equal(narrow.overflow,false);mark('R08');await capture('reasoning-state-dark-narrow');
  const failed=await newSession();await start('failed','失败状态');await control('failed',[activity('failed-command','commandExecution','in_progress')],true,'fixture failed activity');await idle();const failedState=await e(()=>{const state=document.querySelector('#chat .bubble.assistant').messageReasoning;return {phase:state.phase,status:state.activities[0].status,timer:state.timer};});assert.equal(failedState.phase,'failed');assert.equal(failedState.status,'failed');assert.equal(failedState.timer,null);mark('R05');
  assert.deepEqual([...covered].sort(),Object.keys(chatRegressionMapping).sort(),'every legacy assertion ID must have evidence');await writeFile(path.join(output,'results.json'),JSON.stringify({mapping:chatRegressionMapping,evidence},null,2));console.log('PASS real chat regression: '+covered.size+' mapped assertion groups through actual renderer/preload/IPC, native IndexedDB, local CLI and account HTTP fixture');
 }finally{
  await client.call('Emulation.clearDeviceMetricsOverride').catch(()=>{});await theme(themeBefore).catch(()=>{});
  await e(saved=>{const column=document.querySelector('.chat-column');if(column){if(saved==null)column.removeAttribute('style');else column.setAttribute('style',saved);}window.__chatRegressionUnsubscribe?.();delete window.__chatRegressionUnsubscribe;delete window.__chatRegressionMerged;delete window.__chatRegressionSyncErrors;delete window.__chatRegressionEndSnapshot;delete window.__chatRegressionOriginal;window.__chatRegressionRelease?.();delete window.__chatRegressionRelease;},columnBefore).catch(()=>{});
 }
}
