import assert from 'node:assert/strict';
export async function verifyBrowserSecurity({evaluate,until,fixtureClient,debugPort,realmProbe,stun,getStunPackets,acceptLanguages,getStderr}){
  const browserPage = await until(async () => { const list = await fetch(`http://127.0.0.1:${debugPort}/json`).then(r => r.json()); return list.find(p => p.url === 'http://fixture.invalid/page'); });
  const browserClient = fixtureClient(browserPage.url);
  const body = await browserClient.call('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
  assert.match(body.result.value, /浏览器已通过模拟代理/);
  const browserPolicy = await browserClient.call('Runtime.evaluate', { expression: `JSON.stringify({language:navigator.language,languages:navigator.languages,canvas:(()=>{const ctx=document.createElement('canvas').getContext('2d');ctx.font='20px "PingFang SC", monospace';return ctx.font})(),fontCheck:document.fonts.check('20px "PingFang SC"'),localFont:(()=>{try{new FontFace('probe','local("PingFang SC")');return true}catch{return false}})()})`, returnByValue:true });
  const policy = JSON.parse(browserPolicy.result.value);
  assert.equal(policy.language, 'en-US'); assert.ok(policy.languages.every(language=>/^en(?:-|$)/i.test(language)), JSON.stringify(policy));
  assert.equal(policy.canvas,'20px monospace');
  const fontWidths = await browserClient.call('Runtime.evaluate', { expression: `(()=>{const ctx=document.createElement('canvas').getContext('2d');ctx.font='20px monospace';const base=ctx.measureText('mmmmmmmmmmlli').width;return ['PingFang SC','Hiragino Sans GB','STHeiti','STSong','SimSun','Microsoft YaHei','Arial Unicode MS'].map(name=>{ctx.font='20px '+JSON.stringify(name)+', monospace';return {name,blocked:ctx.measureText('mmmmmmmmmmlli').width===base}})})()`, returnByValue:true });
  assert.ok(fontWidths.result.value.every(font=>font.blocked)); assert.equal(policy.fontCheck,false); assert.equal(policy.localFont,false);
  assert.ok(acceptLanguages.filter(Boolean).every(header=>!header.toLowerCase().includes('zh')));
  let realmTimer;
  const realmResult = await Promise.race([browserClient.call('Runtime.evaluate', { awaitPromise:true, returnByValue:true, expression: `(async()=>{
    const results={}; globalThis.privacyProgress='frames';
    const frames=['http://fixture.invalid/privacy-frame','http://frame.invalid/privacy-frame'];
    for(const url of frames) results[url]=await new Promise(resolve=>{const handler=event=>{if(event.data?.kind==='frame-proof'&&event.origin===new URL(url).origin){removeEventListener('message',handler);resolve(event.data.result)}};addEventListener('message',handler);const frame=document.createElement('iframe');frame.src=url;document.body.append(frame)});
    globalThis.privacyProgress='srcdoc';results.srcdoc=await new Promise(resolve=>{const handler=event=>{if(event.data?.kind==='srcdoc-proof'){removeEventListener('message',handler);resolve(event.data.result)}};addEventListener('message',handler);const frame=document.createElement('iframe');frame.srcdoc=${JSON.stringify(`<script>parent.postMessage({kind:'srcdoc-proof',result:(${realmProbe.toString()})()},'*')</script>`)};document.body.append(frame)});
    globalThis.privacyProgress='worker';const worker=new Worker('/privacy-worker.js');await new Promise(resolve=>{worker.onmessage=event=>{if(event.data.nested)results.nested=event.data.nested;else results.worker=event.data;if(results.worker&&results.nested)resolve()}});worker.terminate();
    globalThis.privacyProgress='shared';const moduleWorker=new Worker('/privacy-module.js',{type:'module'});results.moduleWorker=await new Promise(resolve=>moduleWorker.onmessage=e=>resolve(e.data));moduleWorker.terminate();
    const shared=new SharedWorker('/privacy-shared.js');results.shared=await new Promise(resolve=>{shared.port.onmessage=event=>resolve(event.data);shared.port.start()});shared.port.close();
    const sharedModule=new SharedWorker('/privacy-shared.js',{type:'module',name:'module-proof'});results.sharedModule=await new Promise(resolve=>{sharedModule.port.onmessage=e=>resolve(e.data);sharedModule.port.start()});sharedModule.port.close();
    globalThis.privacyProgress='service';const registration=await navigator.serviceWorker.register('/privacy-sw.js');await navigator.serviceWorker.ready;
    results.service=await new Promise(resolve=>{navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.kind==='sw-proof')resolve(event.data.result)},{once:true});registration.active.postMessage('probe')});await registration.unregister();
    return results;
  })()` }), new Promise(resolve=>{realmTimer=setTimeout(resolve,20000)}).then(async()=>{const progress=await browserClient.call('Runtime.evaluate',{expression:'privacyProgress',returnByValue:true});throw new Error('Realm timeout '+progress.result.value+'\n'+getStderr())})]);
  clearTimeout(realmTimer);
  if(realmResult.exceptionDetails) throw new Error('隐私执行环境测试失败：'+realmResult.exceptionDetails.text);
  for(const [realm,result] of Object.entries(realmResult.result.value)) { assert.equal(result.installed,true,realm);assert.equal(result.sameWidth,true,realm);assert.equal(result.localAllowed,false,realm);assert.equal(result.rtcBlocked,true,realm);assert.equal(result.rtcAbsent,true,realm); }
  assert.equal((await evaluate("window.workspace.dnsProbe('example.com')")).blocked,true,'浏览器本机DNS必须拒绝目标解析');
  assert.equal((await evaluate("window.workspace.dnsProbe('127.0.0.1')")).blocked,false,'DNS探测必须确实调用Chromium解析器');
  const {frameTree} = await browserClient.call('Page.getFrameTree',{});
  const {executionContextId} = await browserClient.call('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'native-webrtc-test'});
  const rtcNative = await browserClient.call('Runtime.evaluate',{contextId:executionContextId,awaitPromise:true,returnByValue:true,expression:`(async()=>{const candidates=[];const pc=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${stun.address().port}'}]});pc.onicecandidate=e=>{if(e.candidate)candidates.push(e.candidate.candidate)};pc.createDataChannel('probe');await pc.setLocalDescription(await pc.createOffer());await new Promise(r=>setTimeout(r,1500));pc.close();return candidates})()`});
  assert.deepEqual(rtcNative.result.value,[],'Chromium原生WebRTC不应产生直连候选'); assert.equal(getStunPackets(),0,'STUN监听器不应收到UDP数据');
  console.log('原生WebRTC：候选0、STUN UDP数据包0；example.com本机DNS拒绝，IP字面值解析成功。');
  console.log('iframe/worker/WebRTC/DNS保护：',JSON.stringify(realmResult.result.value));
  console.log('浏览器语言与字体访问策略：',JSON.stringify(policy)); browserClient.close();

}
