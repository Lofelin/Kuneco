import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {browserContainerArguments,ContainerBrowserEngine,ensureContainerBrowserWorkspace} from '../../../src/features/browser/container-browser-engine.mjs';
const owner='browser-test-owner',environmentId='183494cd-1b80-4886-a620-4956f9535772';
const settings={prefix:'dingtu-test-'+environmentId,image:'kuneco-browser:test',gatewayIP:'10.2.0.2',timezone:'Asia/Tokyo',locale:'ja-JP',spec:'abc'};
test('browser uses environment private network and exclusive volume with no host mounts or ports',()=>{
 const args=browserContainerArguments(settings);
 assert.equal(args[args.indexOf('--network')+1],settings.prefix+'-private');
 assert.equal(args[args.indexOf('--mount')+1],`type=volume,src=${settings.prefix}-browser-home,dst=/home/browser`);
 assert.ok(args.includes('--read-only'));assert.ok(args.includes('ALL'));assert.ok(!args.includes('-p'));
 assert.ok(!args.join(' ').includes('type=bind'));assert.ok(!args.includes('--privileged'));
 assert.ok(args.includes('TZ=Asia/Tokyo'));assert.ok(args.includes('LANG=ja_JP.UTF-8'));
 assert.throws(()=>browserContainerArguments({...settings,gatewayIP:'10.1.1.999'}));
 assert.throws(()=>browserContainerArguments({...settings,timezone:'invalid'}));
 assert.throws(()=>browserContainerArguments({...settings,locale:'en-US --attack'}));
});
test('CDP handles split null frames and only supplies proxy credentials to exact gateway challenge',async()=>{
 const engine=new ContainerBrowserEngine({}, {owner,environmentId,gatewayIP:'10.2.0.2',token:'secret'}),frames=[];
 engine.child=new EventEmitter();engine.child.stdin=new Writable({write(data,encoding,callback){frames.push(JSON.parse(data.toString().slice(0,-1)));callback();}});
 engine.child.stdin.end=()=>{};engine.child.kill=()=>{};
 const pending=engine.command('Browser.getVersion');
 const wire=Buffer.from(JSON.stringify({id:1,result:{product:'Chromium'}})+'\0');engine.receive(wire.subarray(0,5));engine.receive(wire.subarray(5));
 assert.equal((await pending).product,'Chromium');
 engine.receive(Buffer.from(JSON.stringify({method:'Fetch.authRequired',sessionId:'s1',params:{requestId:'r1',authChallenge:{source:'Proxy',origin:'http://10.2.0.2:8080'}}})+'\0'));
 assert.deepEqual(frames.at(-1).params.authChallengeResponse,{response:'ProvideCredentials',username:'workspace',password:'secret'});
 engine.receive(Buffer.from(JSON.stringify({id:2,result:{}})+'\0'));
 engine.receive(Buffer.from(JSON.stringify({method:'Fetch.authRequired',sessionId:'s1',params:{requestId:'r2',authChallenge:{source:'Server',origin:'https://evil.test'}}})+'\0'));
 assert.deepEqual(frames.at(-1).params.authChallengeResponse,{response:'CancelAuth'});
 engine.receive(Buffer.from(JSON.stringify({id:3,result:{}})+'\0'));engine.finish();
});
test('closing CDP rejects pending commands and broadcasts closed once',async()=>{
 const engine=new ContainerBrowserEngine({}, {owner,environmentId,gatewayIP:'10.2.0.2',token:'secret'});
 engine.child={stdin:{write(){}}};let closed=0;engine.on('closed',()=>closed++);
 const command=engine.command('Page.navigate');engine.finish();engine.finish();await assert.rejects(command,/连接已关闭/);assert.equal(closed,1);
});
test('paused requests default deny and policy approval resumes without exposing token',async()=>{
 const engine=new ContainerBrowserEngine({}, {owner,environmentId,gatewayIP:'10.2.0.2',token:'secret'}),sent=[];
 engine.command=async(method,params,sessionId)=>sent.push({method,params,sessionId});
 const message={sessionId:'s',params:{requestId:'r',request:{url:'https://example.com/'}}};
 await engine.handlePaused(message);assert.equal(sent[0].method,'Fetch.failRequest');
 engine.allowRequest=async(url,sessionId)=>url==='https://example.com/'&&sessionId==='s';
 await engine.handlePaused(message);assert.equal(sent[1].method,'Fetch.continueRequest');
 engine.allowRequest=async()=>{throw Error('policy unavailable');};
 await engine.handlePaused(message);assert.equal(sent[2].method,'Fetch.failRequest');
 assert.ok(!JSON.stringify(sent).includes('secret'));
});
test('bootstrap blocks all DNS, IPv4 and IPv6 except loopback and one gateway; CDP never listens on TCP',async()=>{
 const {readFile}=await import('node:fs/promises');
 const shell=await readFile(new URL('../../../docker/browser/entrypoint.sh',import.meta.url),'utf8');
 assert.match(shell,/iptables -P OUTPUT DROP/);assert.match(shell,/ip6tables -P OUTPUT DROP/);
 assert.match(shell,/iptables -t raw -A OUTPUT -d 127\.0\.0\.11 -j DROP/);
 assert.match(shell,/iptables -A OUTPUT -d "\$KUNECO_GATEWAY_IP" -p tcp --dport 8080 -j ACCEPT/);
 assert.match(shell,/--bounding-set=-all/);
 const bridge=await readFile(new URL('../../../docker/browser/cdp-bridge.mjs',import.meta.url),'utf8');
 assert.match(bridge,/--remote-debugging-pipe/);assert.doesNotMatch(bridge,/--remote-debugging-port/);
 assert.match(bridge,/--use-angle=swiftshader/);assert.match(bridge,/--proxy-bypass-list=<-loopback>/);
});
test('child target is intercepted recursively before resuming and maps policy to root session',async()=>{
 const engine=new ContainerBrowserEngine({}, {owner,environmentId,gatewayIP:'10.2.0.2',token:'secret'}),sent=[];
 engine.configured.set('root',Promise.resolve());
 engine.command=async(method,params,sessionId)=>{sent.push({method,params,sessionId});return {};};
 await engine.handleAttached({sessionId:'root',params:{sessionId:'worker',targetInfo:{targetId:'w',type:'worker'}}});
 assert.deepEqual(sent.map(x=>x.method),['Fetch.enable','Target.setAutoAttach','Runtime.runIfWaitingForDebugger']);
 assert.equal(sent[1].params.waitForDebuggerOnStart,true);assert.equal(engine.policySession('worker'),'root');
 await engine.handleAttached({sessionId:'worker',params:{sessionId:'nested',targetInfo:{targetId:'n',type:'worker'}}});
 assert.equal(engine.policySession('nested'),'root');engine.finish();
});
test('unsupported worker interception never resumes; unowned popup always closes',async()=>{
 const engine=new ContainerBrowserEngine({}, {owner,environmentId,gatewayIP:'10.2.0.2',token:'secret'}),sent=[];
 engine.configured.set('root',Promise.resolve());
 engine.command=async(method,params)=>{sent.push({method,params});if(method==='Fetch.enable'||method==='Network.setBlockedURLs')throw Error('unsupported');return {};};
 await engine.handleAttached({sessionId:'root',params:{sessionId:'worker',targetInfo:{targetId:'w',type:'worker'}}});
 assert.ok(!sent.some(x=>x.method==='Runtime.runIfWaitingForDebugger'));assert.equal(sent.at(-1).method,'Target.closeTarget');
 await engine.handleAttached({sessionId:'root',params:{sessionId:'popup',targetInfo:{targetId:'p',type:'page'}}});
 assert.equal(sent.at(-1).params.targetId,'p');assert.ok(!sent.some(x=>x.method==='Runtime.runIfWaitingForDebugger'));engine.finish();
});
test('unknown unsupported target types cannot run outside a mapped parent session',async()=>{
 const engine=new ContainerBrowserEngine({}, {owner,environmentId,gatewayIP:'10.2.0.2',token:'secret'}),sent=[];
 engine.command=async(method,params)=>sent.push({method,params});
 await engine.handleAttached({params:{sessionId:'service',targetInfo:{targetId:'service-id',type:'unrecognized'}}});
 assert.deepEqual(sent,[{method:'Target.closeTarget',params:{targetId:'service-id'}}]);engine.finish();
});
test('late close from old engine cannot stop replacement instance with same account/environment',async()=>{
 const calls=[],manager={command:async args=>{calls.push(args);return JSON.stringify([{Config:{Labels:{app:'kuneco-browser','io.kuneco.environment':engine.prefix,'io.kuneco.browser.instance':'replacement'}}}]);}};
 const engine=new ContainerBrowserEngine(manager, {owner,environmentId,gatewayIP:'10.2.0.2',token:'secret'});
 await engine.close();assert.equal(calls.length,1);assert.equal(calls[0][0],'inspect');
});
test('worker fallback installs deny-all network before it can resume without replacing browser identity',async()=>{
 const engine=new ContainerBrowserEngine({}, {owner,environmentId,gatewayIP:'10.2.0.2',token:'secret',locale:'ja-JP'}),sent=[];
 engine.configured.set('root',Promise.resolve());engine.command=async(method,params,sessionId)=>{sent.push({method,params,sessionId});if(method==='Fetch.enable')throw Error('unavailable');return {userAgent:'Linux Chromium'};};
 await engine.handleAttached({sessionId:'root',params:{sessionId:'w',targetInfo:{targetId:'wid',type:'worker'}}});
 const methods=sent.map(c=>c.method);assert.deepEqual(methods,['Fetch.enable','Network.enable','Network.setBlockedURLs','Target.setAutoAttach','Runtime.runIfWaitingForDebugger']);
 assert.deepEqual(sent[2].params.urls,['*']);assert.ok(!methods.includes('Network.setUserAgentOverride')); engine.finish();
});
test('automatic page debugger wait only resumes after explicit managed page configuration',async()=>{
 const engine=new ContainerBrowserEngine({}, {owner,environmentId,gatewayIP:'10.2.0.2',token:'secret'}),sent=[];
 engine.command=async(method,params,sessionId)=>{sent.push({method,params,sessionId});return {};};
 const attached={params:{sessionId:'auto',targetInfo:{targetId:'page',type:'page'}}};
 await engine.handleAttached(attached);assert.equal(sent.length,0);
 engine.managedTargets.add('page');engine.targetSessions.set('page','manual');engine.configured.set('manual',Promise.resolve());
 await engine.handleAttached(attached);assert.equal(sent[0].method,'Runtime.runIfWaitingForDebugger');assert.equal(sent[0].sessionId,'auto');assert.equal(engine.policySession('auto'),'manual');engine.finish();
});
test('close flushes owned browser through CDP even after scope changes before stopping container',async()=>{
 const order=[];let stale=false;
 const manager={command:async args=>{order.push(args[0]);return args[0]==='inspect'?JSON.stringify([{Config:{Labels:{app:'kuneco-browser','io.kuneco.environment':engine.prefix,'io.kuneco.browser.instance':engine.instance}}}]):'';}};
 const engine=new ContainerBrowserEngine(manager,{owner,environmentId,gatewayIP:'10.2.0.2',token:'secret',assertCurrent:()=>{if(stale)throw Error('changed');}});
 const child=new EventEmitter();child.stdin={end(){order.push('stdin-end');},write(raw,callback){const message=JSON.parse(raw.slice(0,-1));order.push(message.method);callback();queueMicrotask(()=>{engine.receive(Buffer.from(JSON.stringify({id:message.id,result:{}})+'\0'));child.emit('close');});}};child.kill=()=>order.push('kill');engine.child=child;child.once('close',()=>engine.finish());stale=true;
 await assert.rejects(engine.command('Page.navigate'),/changed/);await engine.close();
 assert.deepEqual(order,['Browser.close','stdin-end','inspect','stop']);assert.equal(engine.stopped,true);
});
test('profile upgrade refuses a volume referenced by another container before any mutation',async()=>{
 const calls=[],manager={sourceRoot:new URL('../../../',import.meta.url).pathname,command:async args=>{calls.push(args[0]);return args[0]==='ps'?'other-browser-owner':'[]';}};
 const engine=new ContainerBrowserEngine(manager,{owner,environmentId,gatewayIP:'10.2.0.2',token:'secret'});
 await assert.rejects(engine.start(),/其他容器引用/);assert.deepEqual(calls,['image','inspect','ps']);
});
test('profile recovery preserves exactly singleton symlinks and refuses any live Chromium process',async()=>{
 const {readFile}=await import('node:fs/promises');const bridge=await readFile(new URL('../../../docker/browser/cdp-bridge.mjs',import.meta.url),'utf8');
 assert.match(bridge,/await readdir\('\/proc'\)/);assert.match(bridge,/readlink\('\/proc\/'.*'\/exe'\)/);
 assert.match(bridge,/\['SingletonLock','SingletonCookie','SingletonSocket'\]/);assert.match(bridge,/info\.isSymbolicLink\(\)/);assert.match(bridge,/await rename\(/);assert.doesNotMatch(bridge,/\b(?:unlink|rm|rmdir)\(/);
 assert.match(bridge,/\.kuneco-singleton-backup-/);
});
test('sandbox verification requires namespace and seccomp evidence, never falls back to disabled sandbox',async()=>{
 const engine=new ContainerBrowserEngine({}, {owner,environmentId,gatewayIP:'10.2.0.2',token:'secret'}),calls=[];
 engine.command=async(method,params)=>{calls.push([method,params]);if(method==='Target.createTarget')return {targetId:'sandbox-check'};if(method==='Target.attachToTarget')return {sessionId:'sandbox-session'};if(method==='Runtime.evaluate')return {result:{value:'PID namespaces Yes\nNetwork namespaces Yes\nSeccomp-BPF sandbox Yes\nYou are adequately sandboxed.'}};return {};};
 await engine.verifySandbox();assert.equal(engine.sandboxVerified,true);assert.equal(calls.at(-1)[0],'Target.closeTarget');assert.equal(calls.find(c=>c[0]==='Page.navigate')[1].url,'chrome://sandbox');
 engine.command=async method=>{if(method==='Target.createTarget')return {targetId:'failed'};if(method==='Target.attachToTarget')return {sessionId:'failed-session'};if(method==='Runtime.evaluate')throw Error('unavailable');return {};};
 await assert.rejects(engine.verifySandbox(),/unavailable/);
});

test('imported browser workspace is allocated as its own volume and existing owned workspaces survive reconnect',async()=>{
 const calls=[],name=settings.prefix+'-worker-work';let present=false;
 const manager={command:async args=>{calls.push(args);if(args[1]==='inspect'){if(!present)throw Error('missing');return JSON.stringify([{Name:name,Labels:{'io.kuneco.environment':settings.prefix}}]);}if(args[1]==='ls')return '';if(args[1]==='create'){present=true;return name;}throw Error('unexpected');}};
 await ensureContainerBrowserWorkspace(manager,settings.prefix);await ensureContainerBrowserWorkspace(manager,settings.prefix);
 assert.equal(calls.filter(args=>args[1]==='create').length,1);assert.ok(calls.every(args=>args[0]==='volume'));
 manager.command=async()=>JSON.stringify([{Name:name,Labels:{'io.kuneco.environment':'another-environment'}}]);
 await assert.rejects(ensureContainerBrowserWorkspace(manager,settings.prefix),/归属/);
});
