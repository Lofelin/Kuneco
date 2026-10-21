import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
export async function verifyAgentPermission({evaluate,until,client,proxyPort,captureUI}){
 const e=expression=>evaluate(typeof expression==='function'?`(${expression})()`:expression);
 await e("workspace.accountLogin({username:'browser-permission',password:'fixture-password',confirmPassword:'fixture-password'})");
 await e(`workspace.connect(${JSON.stringify({protocol:'http',host:'127.0.0.1',port:proxyPort,username:'demo',password:'secret'})},false)`);
 await e("workspace.runtimeInfo({detect:true})");const session=await e("workspace.newSession({engine:'codex',model:'desktop-fixture-model',networkMode:'direct'})");
 const reload=async()=>{const origin=await e('performance.timeOrigin');await client.call('Page.reload');await until(()=>e(`performance.timeOrigin!==${origin}&&performance.getEntriesByName('chat-records-ready').length>0`));await e("document.querySelector('[data-page=cc]').click()");await until(()=>e("!document.getElementById('browserAccessTrigger').disabled"));};
 const finished=()=>until(()=>e(`workspace.state().then(state=>workspace.chatInsights({owner:state.chatOwner,environmentId:state.containerId,chatId:${JSON.stringify(session.id)}})).then(view=>!view.running)`));
 await reload();assert.equal(await e("document.getElementById('browserAccessTrigger').textContent"),'请求批准');
 await e("document.getElementById('browserAccessMenu').open=true");await until(()=>e("document.getElementById('browserAccessMenu').open"));
 assert.deepEqual(await e("[...document.querySelectorAll('#browserAccessMenu wa-dropdown-item')].map(x=>x.value)"),['ask','auto','full']);
 await mkdir('artifacts/browser-permission',{recursive:true});let shot=await captureUI();await writeFile('artifacts/browser-permission/composer-menu.png',Buffer.from(shot.data,'base64'));
 await e("document.querySelector('#browserAccessMenu wa-dropdown-item[value=full]').click()");await until(()=>e("document.getElementById('browserAccessTrigger').textContent==='完全访问'&&!document.getElementById('browserAccessTrigger').disabled"));
 await reload();assert.equal(await e("document.getElementById('browserAccessTrigger').textContent"),'完全访问');
 await e(`workspace.cc('KUNECO_BROWSER_PERMISSION_E2E',undefined,${JSON.stringify(session.id)},'browser-permission-full')`);await finished();
 assert.equal(await e("[...document.querySelectorAll('app-dialog')].some(d=>d.open&&d.label==='智能体浏览器权限')"),false);
 await e("document.getElementById('browserAccessMenu').open=true;document.querySelector('#browserAccessMenu wa-dropdown-item[value=ask]').click()");await until(()=>e("document.getElementById('browserAccessTrigger').textContent==='请求批准'&&!document.getElementById('browserAccessTrigger').disabled"));
 await e(`workspace.cc('KUNECO_BROWSER_PERMISSION_E2E',undefined,${JSON.stringify(session.id)},'browser-permission-ask')`);
 await until(()=>e("[...document.querySelectorAll('app-dialog')].some(d=>d.open&&d.label==='智能体浏览器权限')"));
 const geometry=await e(()=>{const host=[...document.querySelectorAll('app-dialog')].find(d=>d.open&&d.label==='智能体浏览器权限'),dialog=host.dialog,style=getComputedStyle(dialog,'::backdrop');return {width:dialog.getBoundingClientRect().width,buttons:[...host.querySelectorAll('[slot=footer] app-button')].map(b=>b.textContent),backdrop:style.backgroundColor,filter:style.backdropFilter,radius:getComputedStyle(dialog).borderRadius,header:getComputedStyle(host.shadowRoot.querySelector('[part~=header]')).borderBottomWidth,footer:getComputedStyle(host.shadowRoot.querySelector('[part~=footer]')).borderTopWidth};});
 assert.ok(geometry.width<=480);assert.deepEqual(geometry.buttons,['拒绝','允许本次']);assert.equal(geometry.backdrop,'rgba(160, 165, 175, 0.18)');assert.equal(geometry.filter,'blur(4px)');assert.equal(geometry.radius,'14px');assert.equal(geometry.header,'1px');assert.equal(geometry.footer,'1px');
 shot=await captureUI();await writeFile('artifacts/browser-permission/compact-ask.png',Buffer.from(shot.data,'base64'));
 await e("[...document.querySelectorAll('app-dialog')].find(d=>d.open&&d.label==='智能体浏览器权限').querySelector('[slot=footer] app-button:first-child').click()");await finished();
 await client.call('Emulation.setDeviceMetricsOverride',{width:800,height:700,deviceScaleFactor:1,mobile:false});
 const bounds=await e(()=>{const control=document.getElementById('browserAccessTrigger').getBoundingClientRect(),plus=document.getElementById('composeAdd').getBoundingClientRect();return {sameRow:Math.abs(control.top-plus.top)<5,within:control.left>=0&&control.right<=innerWidth};});assert.deepEqual(bounds,{sameRow:true,within:true});await client.call('Emulation.clearDeviceMetricsOverride');
 console.log('PASS composer browser access: real CLI full-mode request without permission modal, per-chat reload persistence, compact ask fallback, narrow layout and scoped fixture account');
}
