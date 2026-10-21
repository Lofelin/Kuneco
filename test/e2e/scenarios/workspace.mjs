import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {runDesktopOperation} from '../helpers/desktop-operation.mjs';

export async function verifyWorkspace(ctx,verifyBrowser,verifyUI,verifyComponents){
 const {evaluate:e,until,client,temp,proxyPort,getBrowserRequests,getExitRequests,setExitIP,accountProfiles,captureUI}=ctx;
 const click=selector=>e(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const setting=async key=>{await e("document.getElementById('accountMenu').open=true");await e("new Promise(resolve=>requestAnimationFrame(resolve))");await click('#accountSettings');await until(()=>e("!document.getElementById('page-overview').classList.contains('hidden')"));await e("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");await click(`[data-setting=${key}]`);await until(()=>e(`document.querySelector('.settings-panel[data-panel=${key}]').getBoundingClientRect().height>0`));};
 const state=()=>e('window.workspace.state()');
 const ready=()=>until(()=>e("!document.body.classList.contains('environment-onboarding') && !document.body.classList.contains('auth-required')"));
 await ready();await mkdir('artifacts',{recursive:true});
 const shortcutBefore=JSON.stringify((await state()).proxy),shortcutRequests=getExitRequests();
 await click('#proxySettingsShortcut');await until(()=>e("!document.getElementById('page-overview').classList.contains('hidden') && document.querySelector('[data-setting=proxy]').classList.contains('active')"));
 assert.equal(JSON.stringify((await state()).proxy),shortcutBefore,'status shortcut must not change proxy configuration');assert.equal(getExitRequests(),shortcutRequests,'status shortcut must not connect');
 assert.equal(await e("document.getElementById('proxySettingsShortcut').contains(document.getElementById('proxyQuickToggle'))"),false,'connection action must not be nested inside navigation');
 await click('[data-page=cc]');await e("(async()=>{const button=document.getElementById('proxySettingsShortcut');await button.updateComplete;button.shadowRoot.querySelector('button').focus();})()");
 assert.equal(await e("document.getElementById('proxySettingsShortcut').shadowRoot.activeElement?.localName"),'button','keyboard navigation focuses the actual shared button');
 await client.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await client.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 await until(()=>e("!document.getElementById('page-overview').classList.contains('hidden') && document.querySelector('[data-setting=proxy]').classList.contains('active')"));
 await click('[data-page=cc]');

 assert.equal(await e("typeof workspace.notification"),'function','preload bridge loads from new path');
 assert.equal(await e("document.querySelectorAll('button,input:not([type=file][hidden]),select,textarea,dialog').length"),0,'shared controls only');
 assert.ok(await e("customElements.get('app-button') && customElements.get('app-dialog') && customElements.get('app-table')"));
 await e(`document.fonts.load('14px "Inter Variable"')`);
 assert.ok(await e(`document.fonts.check('14px "Inter Variable"')`));
 assert.equal((await e('workspace.runtimeInfo()')).runtimes.length,0,'no implicit runtime registration');
 assert.ok(await e("workspace.newSession({engine:'codex'}).then(()=>false,()=>true)"));
 const runtimes=await e('workspace.runtimeInfo({detect:true})');assert.ok(runtimes.runtimes.some(r=>r.id==='codex'));
 await click('[data-page=runtime]');await until(()=>e("document.querySelector('#configuredRuntimeList')?.textContent.includes('Codex')"));
 await click('[data-page=cc]');await until(()=>e("!document.getElementById('railNewSession').disabled"));
 await click('#railNewSession');await until(()=>e("document.getElementById('newSessionDialog').open"));
 await e("document.getElementById('runtimeEngine').value='codex';document.getElementById('runtimeEngine').dispatchEvent(new Event('change'))");
 await click('#cancelNewSession');await until(()=>e("!document.getElementById('newSessionDialog').open"));
 assert.equal((await state()).aiSessions.length,0,'cancel does not create a session');
 await click('#railNewSession');await until(()=>e("document.getElementById('newSessionDialog').open"));
 await e("document.getElementById('runtimeEngine').value='codex';document.getElementById('runtimeEngine').dispatchEvent(new Event('change'))");
 await click('#createNewSession');
 // Completion includes async runtime capability/auth discovery, not just inserting a session.
 await until(()=>e("!document.getElementById('newSessionDialog').open"));
 assert.equal((await state()).aiSessions.length,1);
 assert.equal((await state()).aiSessions[0].model,'desktop-fixture-model','session uses the model advertised by app-server, not a catalog fallback');
 assert.equal((await state()).selectedEngine,'codex');assert.equal((await state()).project,'');
 const tabs=await e("document.querySelectorAll('.content-tab').length");await click('#newContentTab');
 assert.equal(await e("document.querySelectorAll('.content-tab').length"),tabs+1);assert.equal((await state()).aiSessions.length,1,'blank tab is not a backend session');
 await click('.content-tab.active .content-tab-close');
 await until(()=>e(`document.querySelectorAll('.content-tab').length===${tabs}`));
 await click('[data-page=cc]');await click('.session-row');
 await until(()=>e("!document.getElementById('page-cc').classList.contains('hidden') && !!document.querySelector('.session-row.active')"));
 await verifyUI?.();
 for(const key of await e("[...document.querySelectorAll('[data-setting]')].map(node=>node.dataset.setting)")){
  await setting(key);
  const gaps=await e(`(()=>{const p=document.querySelector('.settings-panel[data-panel=${key}]');return [...p.querySelectorAll('.preference-heading,.profile-section-heading')].map(h=>{if(h.parentElement.classList.contains('proxy-config-toolbar'))h=h.parentElement;const n=h.nextElementSibling;if(!h.getClientRects().length||!n?.getClientRects().length)return null;return n?{gap:n.getBoundingClientRect().top-h.getBoundingClientRect().bottom,description:n.classList.contains('settings-section-description'),after:n.classList.contains('settings-section-description')?n.nextElementSibling.getBoundingClientRect().top-n.getBoundingClientRect().bottom:null}:null}).filter(Boolean)})()`);
  for(const g of gaps){assert.ok(Math.abs(g.gap-(g.description?4:8))<1,key+JSON.stringify(g));if(g.description)assert.equal(g.after,8);}
 }
 await setting('proxy');
 assert.deepEqual(await e("[...document.querySelectorAll('[data-panel=proxy] h2')].map(x=>x.firstChild.textContent.trim())"),['已保存代理']);
 assert.equal(await e("document.querySelector('[data-panel=proxy] h2').textContent.trim()"),'已保存代理');
 assert.equal(await e("getComputedStyle(document.getElementById('proxyConnectionDetails')).display"),'none');
 assert.equal(await e("document.getElementById('proxyProfileDetailsDialog').open"),false);
 await setting('preferences');await e("document.getElementById('themeSelect').value='dark';document.getElementById('themeSelect').dispatchEvent(new Event('change'))");
 assert.ok(await e("document.body.classList.contains('dark') && localStorage.getItem('ui-theme')==='dark'"));
 await e("document.getElementById('themeSelect').value='light';document.getElementById('themeSelect').dispatchEvent(new Event('change'))");
 await setting('notifications');assert.equal(await e("document.getElementById('notificationScopeBadge').textContent"),'当前账号 · 本设备');
 await e("document.querySelector('[data-notification=chat]').shadowRoot.querySelector('input').click()");
 assert.equal(await e("document.querySelector('[data-notification=chat]').checked"),false);
 const beforeReload=await e('performance.timeOrigin');
 await client.call('Page.reload');
 await until(()=>e(`performance.timeOrigin!==${beforeReload} && performance.getEntriesByName('chat-records-ready').length>0`));
 await setting('notifications');
 assert.equal(await e("document.querySelector('[data-notification=chat]').checked"),false,'notification preference survives document reload');
 await e("document.querySelector('[data-notification=chat]').shadowRoot.querySelector('input').click()");
 // System checks are advisory: warnings do not open a blocking dialog or gate IPC.
 assert.equal((await e("workspace.environmentCheck({timeZone:'Asia/Shanghai',languages:['en-US']})")).passed,false);
 assert.equal(await e("document.getElementById('environmentGate').open"),false);
 assert.equal(await e("workspace.browser('open').then(()=>true)"),true);
 await setting('environment');await click('#environmentInspect');
 await until(()=>e("document.getElementById('environmentGate').open && !document.getElementById('environmentRetry').loading"));
 assert.equal(await e("document.getElementById('environmentClose').disabled"),false);
 await click('#environmentClose');await until(()=>e("!document.getElementById('environmentGate').open"));
 assert.equal((await e("workspace.environmentCheck({timeZone:'Asia/Shanghai',languages:['zh-CN']})")).passed,false);
 assert.equal(await e("document.getElementById('environmentGate').open"),false,'repeated warnings must not reopen the dismissed reminder');
 assert.equal((await e("workspace.environmentCheck({timeZone:'America/New_York',languages:['en-US']})")).passed,true);
 await until(()=>e("!document.getElementById('environmentGate').open"));
 // The current import flow lives inside the proxy dialog, with parse/select/connect steps.
 await setting('proxy');await click('#addProxyProfile');await until(()=>e("document.getElementById('proxyDialog').open"));
 await e("document.getElementById('proxyMethodSelect').value='paste';document.getElementById('proxyMethodSelect').dispatchEvent(new Event('change'));document.getElementById('proxyProfileName').value='Fixture import'");
 const csv=`Host,Port,User,Pass\n127.0.0.1,1,other,hidden\n127.0.0.1,${proxyPort},demo,secret\n`;
 await e(`document.getElementById('importText').value=${JSON.stringify(csv)};document.getElementById('importText').dispatchEvent(new Event('input'))`);
 await click('#connect');await until(()=>e("document.querySelectorAll('#importEntries wa-radio').length===2"));
 assert.ok(await e("!document.getElementById('importEntries').textContent.includes('secret')"));
 assert.equal(getExitRequests(),0,'parsing must not connect');
 await e("document.getElementById('importEntries').value='1'");await click('#connect');
 await until(()=>e("!document.getElementById('proxyImportResult').classList.contains('hidden')"));
 assert.equal(getExitRequests(),0,'selecting a draft must not connect');
 await click('#connect');await until(async()=>(await state()).network.state==='ready');
 await until(()=>e("!document.getElementById('proxyDialog').open"));
 assert.ok(getExitRequests()>0);assert.equal((await state()).network.ip,'203.0.113.23');
 for(const width of [1400,1050,800]){
  await client.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  await e("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await until(()=>e("(()=>{const r=document.getElementById('proxySummary').getBoundingClientRect(),range=document.createRange();range.selectNodeContents(document.getElementById('proxySummaryIP'));const ip=range.getBoundingClientRect();return ip.left>=r.left-1&&ip.right<=r.right+1})()"));
  const card=await e("(()=>{const rect=id=>document.getElementById(id).getBoundingClientRect(),status=rect('proxyStatusLabel'),region=rect('proxyRegion'),root=rect('proxySummary'),range=document.createRange();range.selectNodeContents(document.getElementById('proxySummaryIP'));const ip=range.getBoundingClientRect();return {stacked:region.top>=status.bottom&&ip.top>=region.bottom,ipSingleLine:document.getElementById('proxySummaryIP').getClientRects().length===1&&ip.height<25,within:ip.left>=root.left-1&&ip.right<=root.right+1,regionSingleLine:region.height<25}})()");
  assert.deepEqual(card,{stacked:true,ipSingleLine:true,within:true,regionSingleLine:true},'sidebar status rows at '+width);
 }
 await client.call('Emulation.clearDeviceMetricsOverride');
 await click('#toggleSidebar');await e("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
 await until(()=>e("document.body.classList.contains('sidebar-collapsed') && getComputedStyle(document.querySelector('.proxy-detail-line')).visibility==='hidden' && document.getElementById('proxyStatusIcon').getBoundingClientRect().width>0"));
 await click('#toggleSidebar');

 // Subscription previews and node selection are drafts, never mutations of the saved proxy.
 const beforeSubscription=JSON.stringify((await state()).proxy),beforeSubscriptionRequests=getExitRequests();
 await setting('proxy');await click('#addProxyProfile');await e("document.getElementById('proxyMethodSelect').value='subscription';document.getElementById('proxyMethodSelect').dispatchEvent(new Event('change'));document.getElementById('proxyProfileName').value='Fixture import'");
 await e("document.getElementById('subscriptionURL').value='http://127.0.0.1/private?token=fixture';document.getElementById('subscriptionURL').dispatchEvent(new Event('input'))");
 await click('#connect');await until(()=>e("!document.getElementById('proxyImportPanel').classList.contains('hidden') && document.getElementById('importError').textContent.length>0"));
 assert.ok(await e("!document.getElementById('importError').textContent.includes('token=fixture')"));
 await e("document.getElementById('proxyMethodSelect').value='paste';document.getElementById('proxyMethodSelect').dispatchEvent(new Event('change'));document.getElementById('proxyProfileName').value='Fixture import'");
 const nodeText='proxies:\n  - {name: Fixture VLESS, type: vless, server: 203.0.113.9, port: 443, uuid: 00000000-0000-4000-8000-000000000001, tls: true}\n  - {name: Unsafe Hy2, type: hysteria2, server: 203.0.113.10, port: 443, password: fixture-secret, skip-cert-verify: true, tls: false}';
 await e(`document.getElementById('importText').value=${JSON.stringify(nodeText)};document.getElementById('importText').dispatchEvent(new Event('input'))`);
 await click('#connect');await until(()=>e("document.querySelectorAll('#importEntries wa-radio').length===2"));
 assert.equal(await e("document.querySelectorAll('#importEntries wa-radio[disabled]').length"),1);
 assert.ok(await e("!document.getElementById('importEntries').textContent.includes('fixture-secret')"));
 await click('#connect');await until(()=>e("!document.getElementById('proxyImportResult').classList.contains('hidden')"));
 assert.equal(JSON.stringify((await state()).proxy),beforeSubscription,'choosing a subscription node must preserve current proxy');
 assert.equal(getExitRequests(),beforeSubscriptionRequests,'draft selection cannot start network forwarding');
 await click('#cancelProxyDialog');

 await click('[data-page=browser]');await e("document.getElementById('address').value='http://fixture.invalid/page';document.getElementById('navigate').click()");
 await until(()=>getBrowserRequests()>0);
 await verifyBrowser();
 // Address editing must survive asynchronous browser loading.
 await e("document.getElementById('address').focus();document.getElementById('address').value='draft';document.getElementById('address').dispatchEvent(new Event('input'))");
 const requests=getBrowserRequests();await e("workspace.browser('reload')");await until(()=>getBrowserRequests()>requests);
 assert.equal(await e("document.getElementById('address').value"),'draft');
 await e("document.getElementById('address').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.getElementById('address').blur()");
 await e('workspace.disconnect()');await until(async()=>(await state()).network.state==='blocked');
 const before=getBrowserRequests();assert.ok(await e("workspace.browser('navigate','http://fixture.invalid/blocked').then(()=>false,()=>true)"));assert.equal(getBrowserRequests(),before);
 const pins=JSON.parse(await readFile(path.join(temp,'egress-pins.json'),'utf8'));assert.ok(Object.values(pins).includes('203.0.113.23'));
 setExitIP('203.0.113.99');const config={protocol:'http',host:'127.0.0.1',port:proxyPort,username:'demo',password:'secret'};
 const changed=await e(`workspace.connect(${JSON.stringify(config)},false)`);assert.equal(changed.state,'blocked','changed egress must be rejected');setExitIP('203.0.113.23');
 // Two fixture accounts exercise isolation without real credentials, Docker or providers.
 const login=async username=>{await runDesktopOperation(ctx,`workspace.accountLogin(${JSON.stringify({username,password:'fixture-password',confirmPassword:'fixture-password'})})`,{name:'fixture account login '+username});await until(()=>e("document.getElementById('accountName').textContent.startsWith('测试用户')"));};
 await login('layout-one');await verifyComponents?.();assert.equal((await state()).aiSessions.length,0,'guest sessions do not leak into account');
 // A saved alternative must not change the live proxy until explicitly activated.
 const savedBeforeProfiles=JSON.stringify((await state()).proxy),requestsBeforeProfiles=getExitRequests();
 const profilePayload={scope:{owner:(await e('workspace.accountState()')).user.id,environment:null},name:'Fixture Sufe',provider:'sufe',config:{protocol:'http',host:'127.0.0.1',port:proxyPort,username:'demo',password:'secret'}};
 const savedProfile=await e(`workspace.proxyProfiles('save',${JSON.stringify(profilePayload)})`);
 const secondProfile=await e(`workspace.proxyProfiles('save',${JSON.stringify({...profilePayload,name:'Fixture IPRoyal',provider:'iproyal'})})`);
 assert.equal(JSON.stringify((await state()).proxy),savedBeforeProfiles);assert.equal(getExitRequests(),requestsBeforeProfiles);
 assert.ok(!JSON.stringify(savedProfile).includes('secret'));
 await setting('proxy');await until(()=>e("document.querySelectorAll('#proxyProfilesTable tbody tr:not(:has(.app-table-empty))').length===2"));
 await e("document.getElementById('proxyProviderFilter').value='sufe';document.getElementById('proxyProviderFilter').dispatchEvent(new Event('change'))");
 assert.equal(await e("document.querySelectorAll('#proxyProfilesTable tbody tr:not(:has(.app-table-empty))').length"),1);
 const beforeEdit=JSON.stringify((await state()).proxy),beforeEditRequests=getExitRequests();
 await e("document.querySelector('#proxyProfilesTable wa-dropdown').open=true");await until(()=>e("document.querySelector('#proxyProfilesTable wa-dropdown').open"));
 const menuStyle=await e("(()=>{const item=document.querySelector('#proxyProfilesTable wa-dropdown-item'),style=getComputedStyle(item.shadowRoot.querySelector('[part~=label]'));return {font:style.fontSize,weight:style.fontWeight,line:style.lineHeight,radius:getComputedStyle(document.querySelector('#proxyProfilesTable wa-dropdown').shadowRoot.querySelector('[part~=menu]')).borderRadius}})()");
 assert.deepEqual(menuStyle,{font:'12px',weight:'400',line:'18px',radius:'14px'});
 await e("[...document.querySelectorAll('#proxyProfilesTable wa-dropdown-item')].find(e=>e.textContent==='编辑配置').click()");await until(()=>e("document.getElementById('proxyDialog').open"));
 assert.equal(await e("document.getElementById('proxyProfileName').value"),'Fixture Sufe');
 await click('#saveProxyProfile');await until(()=>e("!document.getElementById('proxyDialog').open"));
 assert.equal(JSON.stringify((await state()).proxy),beforeEdit,'editing an inactive profile must not switch active proxy');assert.equal(getExitRequests(),beforeEditRequests);
 await until(()=>e("!document.getElementById('proxyProviderFilter').disabled"));
 await mkdir('artifacts/subscription-proxy',{recursive:true});const tableImage=await captureUI();await writeFile('artifacts/subscription-proxy/table-populated-fixture.png',Buffer.from(tableImage.data,'base64'));

 await e("document.querySelector('#proxyProfilesTable wa-switch').checked=true;document.querySelector('#proxyProfilesTable wa-switch').dispatchEvent(new Event('change'))");await until(async()=>(await state()).network.state==='ready');
 assert.equal((await state()).proxy.profileId,savedProfile.id);
 await click('#proxyProfilesTable tbody tr');await until(()=>e("document.getElementById('proxyProfileDetailsDialog').open"));await click('#proxyDetailsToggle');assert.ok(await e("document.getElementById('proxyConnectionDetails').offsetHeight>0"));await click('#closeProxyProfileDetails');await until(()=>e("!document.getElementById('proxyProfileDetailsDialog').open"));
 setExitIP('203.0.113.99');await until(()=>e("!document.querySelector('#proxyProfilesTable wa-switch').disabled"));await e("document.querySelector('#proxyProfilesTable wa-switch').checked=true;document.querySelector('#proxyProfilesTable wa-switch').dispatchEvent(new Event('change'))");await until(async()=>(await state()).network.state==='blocked');
 assert.equal((await state()).proxy.profileId,savedProfile.id,'a failed switch stays locked to the selected profile');
 setExitIP('203.0.113.23');await until(()=>e("!document.querySelector('#proxyProfilesTable wa-switch').disabled"));await e("document.querySelector('#proxyProfilesTable wa-switch').checked=true;document.querySelector('#proxyProfilesTable wa-switch').dispatchEvent(new Event('change'))");await until(async()=>(await state()).network.state==='ready');
 await setting('notifications');await e("document.querySelector('[data-notification=network]').shadowRoot.querySelector('input').click()");
 assert.equal(await e("document.querySelector('[data-notification=network]').checked"),false);
 await setting('preferences');await e("document.getElementById('languageSelect').value='en-US';document.getElementById('languageSelect').dispatchEvent(new Event('change'))");
 await until(()=>accountProfiles.get('fixture-account-1')?.language==='en-US');
 await e('workspace.accountLogout()');await login('layout-two');
 await setting('notifications');assert.equal((await e("workspace.proxyProfiles('list')")).profiles.length,0,'account B cannot see account A proxy profiles');assert.equal(await e("document.querySelector('[data-notification=network]').checked"),true,'account B has independent preferences');
 assert.equal((await e('workspace.runtimeInfo()')).runtimes.length,0,'runtime registry does not leak between accounts');
 await e('workspace.accountLogout()');await login('layout-one');await setting('notifications');
 assert.equal(await e("document.querySelector('[data-notification=network]').checked"),false,'account A preference restored');
 assert.equal(await e('document.documentElement.lang'),'en-US','account language restored');
 const screenshot=await captureUI();await writeFile('artifacts/desktop-full-workspace.png',Buffer.from(screenshot.data,'base64'));
 console.log('PASS current workspace: runtime/session, settings spacing, theme, notifications, gate, import, proxy pinning and account isolation');
}
