import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';

// Runs in desktop-smoke's real src/index.html and renderer. Its local app-server
// fixture handles KUNECO_TURN_CARD_E2E and writes only the project under ctx.temp.
export async function verifyTurnChangeCard(ctx){
 const {evaluate:e,until,client,temp,captureUI}=ctx;
 const click=selector=>e(`(async()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing control');await node.updateComplete;(node.shadowRoot?.querySelector('button')||node).click();})()`);
 const state=()=>e('workspace.state()');
 const project=path.join(temp,'turn-card-project');await mkdir(project,{recursive:true});
 const names=['a','b','c','d'];
 for(const name of names)await writeFile(path.join(project,'fixture-'+name+'.txt'),'before '+name+'\n');
 const output=path.resolve('artifacts/turn-change-card');await mkdir(output,{recursive:true});
 assert.ok((await state()).chatOwner,'scenario requires the suite local account fixture');
 console.log('turn card: detect local runtime');
 await e('workspace.runtimeInfo({detect:true})');
 await click('[data-page=runtime]');await click('[data-page=cc]');
 await until(()=>e("!document.querySelector('#railNewSession').disabled"));
 await click('#railNewSession');await until(()=>e("document.querySelector('#newSessionDialog').open"));
 await e("document.querySelector('#runtimeEngine').value='codex';document.querySelector('#runtimeEngine').dispatchEvent(new Event('change'));document.querySelector('#chatNetworkMode').value='direct'");
 await click('#createNewSession');await until(()=>e("!document.querySelector('#newSessionDialog').open"));
 const chatId=(await state()).activeAISessionId;console.log('turn card: created session; assign temporary project');
 await e(`workspace.project({mode:'local',path:${JSON.stringify(project)}})`);
 const beforeReload=await e('performance.timeOrigin');await client.call('Page.reload');
 await until(()=>e(`performance.timeOrigin!==${beforeReload}&&performance.getEntriesByName('chat-records-ready').length>0`));
 await click('[data-page=cc]');await until(()=>e("!document.querySelector('#prompt').disabled"));
 assert.equal((await state()).activeAISessionId,chatId);assert.equal((await state()).project,project);
 await e("document.querySelector('#prompt').value='KUNECO_TURN_CARD_E2E: edit fixture-a.txt through fixture-d.txt';document.querySelector('#prompt').dispatchEvent(new Event('input',{bubbles:true}))");
 console.log('turn card: send edit through actual renderer');
 await click('#send');
 const scope={owner:(await state()).chatOwner,environmentId:null,chatId};
 await until(()=>e(`workspace.chatInsights(${JSON.stringify(scope)}).then(data=>!data.running&&data.changeHistory.length===1&&data.changeHistory[0].files.length===4)`));
 await until(()=>e("document.querySelectorAll('#chat .bubble.assistant .turn-change-card').length===1"));
 const insight=await e(`workspace.chatInsights(${JSON.stringify(scope)})`),turn=insight.changeHistory[0];
 assert.equal(turn.files.length,4);assert.equal(turn.added,4);assert.equal(turn.removed,4);
 assert.equal(turn.undo.available,true,'complete fixture snapshots must support real IPC undo');console.log('turn card: received four complete file snapshots');
 for(const name of names)assert.equal(await readFile(path.join(project,'fixture-'+name+'.txt'),'utf8'),'after '+name+'\n');
 assert.equal(await e("document.querySelectorAll('.turn-change-card .turn-change-files li').length"),3);
 await click('.turn-change-expand');assert.equal(await e("document.querySelectorAll('.turn-change-card .turn-change-files li').length"),4);await click('.turn-change-expand');
 await click('.turn-change-file');await until(()=>e("document.querySelector('.window-insights').classList.contains('insights-open')"));
 assert.equal(await e("document.querySelector('.changes-file-select').value"),path.join(project,'fixture-a.txt'));
 assert.ok(await e("document.querySelector('.changes-review-diff').textContent.includes('after a')"));
 await click('#toggleArtifacts');
 const originalTheme=await e("document.querySelector('#themeSelect').value");
 const originalSidebar=await e("document.body.classList.contains('sidebar-collapsed')");
 try{
  for(const [dark,width] of [[false,1200],[true,1200],[false,1050],[true,1050]]){
   if(await e("document.body.classList.contains('sidebar-collapsed')")!==false)await click('#toggleSidebar');
   // Electron exposes no Browser.getWindowForTarget CDP command. Emulate only
   // widths supported by the real application's 1050px minimum window.
   await client.call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
   await until(()=>e(`Math.abs(innerWidth-${width})<2`));
   await e(`document.querySelector('#themeSelect').value=${JSON.stringify(dark?'dark':'light')};document.querySelector('#themeSelect').dispatchEvent(new Event('change'))`);
   await until(()=>e(`document.body.classList.contains('dark')===${dark}`));
   const screenshot=await captureUI();await writeFile(path.join(output,(dark?'dark':'light')+'-'+width+'.png'),Buffer.from(screenshot.data,'base64'));
   const geometry=await e("(()=>{const card=document.querySelector('.turn-change-card'),r=card.getBoundingClientRect();return {width:r.width,right:r.right,viewport:innerWidth,buttons:[...card.querySelectorAll('app-button')].map(node=>({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right})),left:r.left}})()");
   assert.ok(geometry.width>0&&geometry.right<=geometry.viewport+1,JSON.stringify(geometry));
   assert.ok(geometry.buttons.every(button=>button.left>=geometry.left-1&&button.right<=geometry.right+1),JSON.stringify(geometry));
  }
 }finally{
  await client.call('Emulation.clearDeviceMetricsOverride');
  if(await e("document.body.classList.contains('sidebar-collapsed')")!==originalSidebar)await click('#toggleSidebar');
  await e(`document.querySelector('#themeSelect').value=${JSON.stringify(originalTheme)};document.querySelector('#themeSelect').dispatchEvent(new Event('change'))`);
 }
 {
  await click('.turn-change-card [data-action=undo]');
  await until(()=>e("[...document.querySelectorAll('app-dialog')].some(dialog=>dialog.open&&dialog.label==='撤销本轮文件变更')"));
  const backdrop=await e("(()=>{const dialog=[...document.querySelectorAll('app-dialog')].find(dialog=>dialog.open&&dialog.label==='撤销本轮文件变更');const style=getComputedStyle(dialog.shadowRoot.querySelector('dialog'),'::backdrop');return {background:style.backgroundColor,filter:style.backdropFilter}})()");
  assert.equal(backdrop.filter,'blur(4px)');
  const screenshot=await captureUI();await writeFile(path.join(output,'undo-confirmation.png'),Buffer.from(screenshot.data,'base64'));
  await e("(()=>{const dialog=[...document.querySelectorAll('app-dialog')].find(dialog=>dialog.open&&dialog.label==='撤销本轮文件变更');dialog.querySelector('[slot=footer].primary').click()})()");
  await until(()=>e("document.querySelector('.turn-change-card [data-action=undo]')?.textContent==='已撤销'"));
  for(const name of names)assert.equal(await readFile(path.join(project,'fixture-'+name+'.txt'),'utf8'),'before '+name+'\n');
  const after=await e(`workspace.chatInsights(${JSON.stringify(scope)})`);assert.ok(after.changeHistory[0].undo.revertedAt);assert.equal(after.changeHistory[0].undo.available,false);
  assert.equal(await e(`workspace.chatUndo(${JSON.stringify({...scope,turnId:turn.id})}).then(()=>false,()=>true)`),true,'already reverted batch is refused by real IPC');
 }
 // Reload must restore server-owned receipt history onto the original assistant,
 // and preserve the turn identity in saved messages rather than card text.
 const reloadOrigin=await e('performance.timeOrigin');await client.call('Page.reload');
 await until(()=>e(`performance.timeOrigin!==${reloadOrigin}&&performance.getEntriesByName('chat-records-ready').length>0`));
 await click('[data-page=cc]');
 await until(()=>e("document.querySelectorAll('#chat .bubble.assistant .turn-change-card').length===1"));
 assert.equal(await e("document.querySelector('.turn-change-card').dataset.turnId"),turn.id);
 assert.equal(await e("document.querySelector('.turn-change-card [data-action=undo]').textContent"),'已撤销');
 await writeFile(path.join(output,'results.json'),JSON.stringify({pass:true,source:'real src/index.html renderer + preload IPC + local app-server fixture',files:4,widths:[1200,1050],added:turn.added,removed:turn.removed,undo:'verified on temporary project',reload:true},null,2));
 console.log('PASS real desktop turn card: CLI receipts, statistics, expansion, scoped review, themes/narrow layout, undo IPC and reload');
}
