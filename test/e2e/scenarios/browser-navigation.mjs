import assert from 'node:assert/strict';
export async function verifyBrowserNavigation({evaluate,until,fixtureClient,debugPort,getPopupPost,getStderr,getBrowserRequests}){
  await evaluate("window.workspace.browser('navigate','http://fixture.invalid/opener')");
  const openerPage = await until(async () => (await fetch(`http://127.0.0.1:${debugPort}/json`).then(r => r.json())).find(p => p.url === 'http://fixture.invalid/opener'));
  const openerClient = fixtureClient(openerPage.url);
  await until(async () => (await openerClient.call('Runtime.evaluate', { expression: 'Boolean(document.querySelector("form"))', returnByValue: true })).result.value);
  await openerClient.call('Runtime.evaluate', { expression: 'document.querySelector("form").submit()', userGesture: true });
  await until(() => getPopupPost()).catch(async error => { throw new Error(`${error.message}\n${getStderr()}\n${await evaluate("document.getElementById('browserTabs').textContent")}`); });
  assert.deepEqual(getPopupPost(), { method: 'POST', body: 'code=fixture-code' }, '登录弹窗必须保留POST数据');
  await until(async () => (await openerClient.call('Runtime.evaluate', { expression: 'document.body.dataset.callback', returnByValue: true })).result.value === 'received');
  await until(() => evaluate("document.querySelectorAll('.browser-tab').length===1 && document.getElementById('address').value==='http://fixture.invalid/opener'"));
  openerClient.close();
  await evaluate("window.workspace.browser('navigate','http://fixture.invalid/page')");
  await until(() => evaluate("document.getElementById('address').value==='http://fixture.invalid/page'"));
  assert.equal(await evaluate("document.getElementById('toast').textContent.includes('loadURL')"), false);
  const firstTab = await evaluate("document.querySelector('#browserTabs .browser-tab.active').dataset.url");
  assert.equal(firstTab, 'http://fixture.invalid/page');
  await evaluate("document.getElementById('newTab').click()");
  await until(() => evaluate("document.querySelectorAll('.browser-tab').length===2 && document.getElementById('address').value==='http://fixture.invalid/home'"));
  assert.ok(getBrowserRequests() >= 2, '新标签必须自动请求首页');
  await evaluate("window.workspace.browser('navigate','http://fixture.invalid/slow')");
  // A newer navigation cancels the slow page (-3); the redirect must still render.
  await evaluate("window.workspace.browser('navigate','http://fixture.invalid/redirect')");
  await until(() => evaluate("document.getElementById('address').value==='http://fixture.invalid/final' && !document.getElementById('browserMessage').textContent.includes('加载…')"));
  assert.equal(await evaluate("document.getElementById('toast').textContent.includes('ERR_ABORTED')"), false);
  const finalPage = await until(async () => (await fetch(`http://127.0.0.1:${debugPort}/json`).then(r => r.json())).find(p => p.url === 'http://fixture.invalid/final'));
  const finalClient = fixtureClient(finalPage.url);
  const finalBody = await finalClient.call('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
  assert.match(finalBody.result.value, /浏览器已通过模拟代理/); finalClient.close();
  await evaluate("document.querySelector('#browserTabs .tab-select').click()");
  await until(() => evaluate("document.getElementById('address').value==='http://fixture.invalid/page'"));
  await evaluate("document.querySelectorAll('#browserTabs .tab-close')[1].click()");
  await until(() => evaluate("document.querySelectorAll('.browser-tab').length===1"));

}
