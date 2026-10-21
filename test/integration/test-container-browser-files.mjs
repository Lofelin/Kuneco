import {DockerEnvironments,resourcePrefix} from '../../src/features/environments/docker-environments.mjs';
import {ContainerBrowserContents} from '../../src/features/browser/container-browser-contents.mjs';
import {ContainerBrowserEngine,ensureContainerBrowserImage} from '../../src/features/browser/container-browser-engine.mjs';
import {ContainerBrowserFiles,runContainerFile} from '../../src/features/browser/container-browser-files.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const manager=new DockerEnvironments({directory:'/tmp/kuneco-browser-files-fixture',sourceRoot:fileURLToPath(new URL('../../',import.meta.url)),encrypt:x=>x,decrypt:x=>x});
const owner='browser-files-'+randomUUID(),environmentId=randomUUID(),prefix=resourcePrefix(owner,environmentId),network=prefix+'-private';
const image=await ensureContainerBrowserImage(manager);
let engine;
const payload='container-only-transfer-'+randomUUID();
try{
 await manager.command(['network','create','--internal','--label','app=kuneco-browser-files-test',network]);
 await manager.command(['volume','create','--label','app=kuneco-browser-files-test',prefix+'-worker-work']);
 await manager.command(['run','--rm','--network','none','--mount',`type=volume,src=${prefix}-worker-work,dst=/workspace`,'--entrypoint','sh',image,'-c','chown 1000:1000 /workspace']);
 const fixtureProxy=`const http=require('http'),payload=${JSON.stringify(payload)},auth='Basic '+Buffer.from('workspace:fixture-only').toString('base64');http.createServer((req,res)=>{if(req.headers['proxy-authorization']!==auth){res.writeHead(407,{'proxy-authenticate':'Basic realm=fixture','connection':'close'});return res.end();}if(req.url.endsWith('/download')){res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="fixture.txt"'});res.end(payload);}else{res.setHeader('content-type','text/html');res.end('<!doctype html><title>Container transfers</title><input id="upload" type="file"><a id="download" href="http://fixture.invalid/download">Download</a>');}}).listen(8080,'0.0.0.0');`;
 await manager.command(['run','-d','--name',prefix+'-proxy','--label','app=kuneco-browser-files-test','--network',network,'--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges','--entrypoint','node',image,'-e',fixtureProxy]);
 const gatewayIP=(await manager.command(['inspect','--format',`{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,prefix+'-proxy'])).trim();
 engine=new ContainerBrowserEngine(manager,{owner,environmentId,gatewayIP,token:'fixture-only',timezone:'Asia/Tokyo',locale:'ja-JP',allowRequest:async url=>{return url==='about:blank'||url.startsWith('http://fixture.invalid/');}});await engine.start();
 const container=async source=>manager.command(['exec','--user','1000:1000',engine.name,'node','-e',source]);
 await container(`require('fs').writeFileSync('/workspace/upload.txt',${JSON.stringify(payload)});require('fs').symlinkSync('/etc/passwd','/workspace/outside.txt');require('fs').symlinkSync('/home/browser','/workspace/outside-dir');`);
 let chosen=false,downloadResult;let finishDownload;
 const completed=new Promise(resolve=>finishDownload=resolve);
 const wc=new ContainerBrowserContents({ready:async()=>engine,viewer:{isDestroyed:()=>false,send(){}},nativeImage:{},allowed:url=>url.startsWith('http://fixture.invalid/'),onFileChooser:async(details,contents)=>{await files.upload(contents,details,'/workspace/upload.txt');chosen=true;}});
 const files=new ContainerBrowserFiles(engine,{findContents:id=>wc.frames.has(id)?wc:null,onDownload:item=>{item.on('done',(_e,state)=>{downloadResult={state,error:item.failure};finishDownload();});item.setSavePath('/workspace/Download/fixture.txt');}});await files.enable();
 await wc.loadURL('http://fixture.invalid/');
 for(let i=0;i<30&&await wc.executeJavaScript('document.title')!=='Container transfers';i++)await new Promise(r=>setTimeout(r,100));
 await wc.executeJavaScript('document.querySelector("#upload").click()',true);
 for(let i=0;i<30&&!chosen;i++)await new Promise(r=>setTimeout(r,100));assert.equal(chosen,true);
 const upload=await wc.executeJavaScript('document.querySelector("#upload").files[0].text()');assert.equal(upload,payload);console.log('UPLOAD_CONTAINER_BYTES_MATCH');
 await assert.rejects(runContainerFile(engine,'upload',{path:'/etc/passwd'}),/workspace/);
 await assert.rejects(runContainerFile(engine,'upload',{path:'/workspace/outside.txt'}));
 await assert.rejects(runContainerFile(engine,'upload',{path:'/workspace/outside-dir/profile/Preferences'}));console.log('UPLOAD_OUTSIDE_AND_SYMLINK_DENIED');
 await wc.executeJavaScript('document.querySelector("#download").click()',true);await Promise.race([completed,new Promise((_,reject)=>setTimeout(()=>reject(Error('download timeout')),15000))]);assert.equal(downloadResult.state,'completed',JSON.stringify(downloadResult));
 assert.equal(await container("process.stdout.write(require('fs').readFileSync('/workspace/Download/fixture.txt','utf8'))"),payload);console.log('DOWNLOAD_CONTAINER_BYTES_MATCH');
 const sourceGuid=randomUUID();await container(`require('fs').writeFileSync('/home/browser/downloads/${sourceGuid}','second')`);
 await assert.rejects(runContainerFile(engine,'save',{guid:sourceGuid,path:'/workspace/Download/fixture.txt'}),/exist/i);assert.equal(await container("process.stdout.write(require('fs').readFileSync('/workspace/Download/fixture.txt','utf8'))"),payload);
 await assert.rejects(runContainerFile(engine,'save',{guid:sourceGuid,path:'/workspace/outside-dir/leak.txt'}),/符号链接/);console.log('DOWNLOAD_NO_OVERWRITE_OR_SYMLINK_ESCAPE');
 const {targetId}=await engine.command('Target.createTarget',{url:'about:blank'}),{sessionId}=await engine.command('Target.attachToTarget',{targetId,flatten:true});await engine.command('Page.navigate',{url:'chrome://sandbox'},sessionId);let sandbox='';for(let i=0;i<30;i++){sandbox=(await engine.command('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true},sessionId)).result.value||'';if(sandbox.includes('adequately'))break;await new Promise(r=>setTimeout(r,100));}console.log(sandbox);assert.match(sandbox,/adequately sandboxed/);assert.match(sandbox,/PID namespaces\s+Yes/);assert.match(sandbox,/Seccomp-BPF sandbox\s+Yes/);
 // Reconnect with unchanged credentials: the tab must retire its old CDP target.
 const retired=engine;await retired.close();
 engine=new ContainerBrowserEngine(manager,{owner,environmentId,gatewayIP,token:'fixture-only',timezone:'Asia/Tokyo',locale:'ja-JP',allowRequest:async url=>url==='about:blank'||url.startsWith('http://fixture.invalid/')});await engine.start();
 await wc.loadURL('http://fixture.invalid/');for(let i=0;i<30&&await wc.executeJavaScript('document.title')!=='Container transfers';i++)await new Promise(r=>setTimeout(r,100));assert.equal(await wc.executeJavaScript('document.title'),'Container transfers');assert.equal(wc.engine,engine);await assert.rejects(retired.command('Browser.getVersion'));console.log('SAME_CREDENTIALS_RECONNECT_EXISTING_TAB_PASS');
 await manager.command(['stop','-t','1',prefix+'-proxy']);const failed=await engine.command('Page.navigate',{url:'http://fixture.invalid/no-proxy'},wc.sessionId);assert.ok(failed.errorText);console.log('PROXY_FAILURE_CLOSED',failed.errorText);
 const blocked=await container("const net=require('net');const s=net.connect({host:'1.1.1.1',port:443});s.setTimeout(1000);s.on('connect',()=>{console.log('LEAK');s.destroy()});s.on('timeout',()=>{console.log('BLOCKED');s.destroy()});s.on('error',()=>console.log('BLOCKED')); ");assert.match(blocked,/BLOCKED/);console.log('DIRECT_PUBLIC_BLOCKED');
 console.log('CONTAINER_FILES_SANDBOX_INTEGRATION_PASS');
}finally{
 await engine?.close();
 for(const args of [['rm','-f',prefix+'-browser'],['rm','-f',prefix+'-proxy'],['volume','rm',prefix+'-browser-home'],['volume','rm',prefix+'-worker-work'],['network','rm',network]])try{await manager.command(args);}catch(error){console.log('CLEANUP',error.message);}
}
