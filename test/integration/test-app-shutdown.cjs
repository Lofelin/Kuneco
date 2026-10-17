// Runs a disposable Electron app using the production before-quit wiring.
const {readFileSync,writeFileSync,mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const source=readFileSync(path.join(root,'src/app/main.mjs'),'utf8');
const wiring=source.slice(source.indexOf('const shutdown=createShutdownBarrier(['),source.indexOf("app.on('window-all-closed'"));
assert.ok(wiring.includes("app.on('before-quit'"));
(async()=>{
 for(const fail of [false,true]){
  const dir=mkdtempSync(path.join(tmpdir(),'kuneco-quit-fixture-')),log=path.join(dir,'events.jsonl');
  try{
   writeFileSync(path.join(dir,'fixture.mjs'),`
import {createRequire} from 'node:module';
import {appendFileSync} from 'node:fs';
import {createShutdownBarrier} from ${JSON.stringify('file://'+path.join(root,'src/app/shutdown.mjs'))};
const {app}=createRequire(${JSON.stringify(path.join(root,'package.json'))})('electron');
app.setName('Kuneco quit fixture');app.setPath('userData',${JSON.stringify(path.join(dir,'data'))});
const record=event=>appendFileSync(${JSON.stringify(log)},JSON.stringify({event,time:Date.now()})+'\\n');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let tries=0,cleanupPending;
const dockerEnvs={shutdownTasks(){return cleanupPending ||= (async()=>{record('cleanup-start');if(${fail} && ++tries===1)throw Error('fixture Docker failure');await wait(350);record('cleanup-complete');})().finally(()=>{cleanupPending=null;});}};
const runs={async abortWhere(){await wait(200);record('runs-finished');}};
const gateway={block(){},async stop(){record('gateway-stopped');}};
const directBrowserTransport={async close(){await wait(100);record('transport-closed');}};
const directBrowserTransportPromise=null,learningAutomations=null,desktopReturn=null,containerLogin=null,account=null,environmentTimer=null,healthTimer=null;
function closeConsole(){}function stopBrowserTabs(){}
const dialog={async showMessageBox(){record('failure-shown');await wait(500);record('alive-before-retry');return {response:0};}};
${wiring}
app.on('will-quit',()=>record('will-quit'));
app.whenReady().then(()=>{record('quit-request');app.quit();});
`);
   const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
   const child=spawn(require('electron'),[path.join(dir,'fixture.mjs')],{env,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',c=>stderr+=c);
   const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('fixture timeout '+stderr));},15000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});
   assert.equal(code,0,stderr);
   const events=readFileSync(log,'utf8').trim().split('\n').map(JSON.parse),names=events.map(x=>x.event);
   assert.equal(names.at(-1),'will-quit');
   for(const event of ['cleanup-complete','runs-finished','gateway-stopped','transport-closed'])assert.ok(names.indexOf(event)>=0 && names.indexOf(event)<names.indexOf('will-quit'),event);
   assert.ok(events.at(-1).time-events[0].time>=300);
   if(fail){assert.ok(names.includes('failure-shown'));assert.ok(names.includes('alive-before-retry'));assert.ok(names.indexOf('alive-before-retry')<names.indexOf('will-quit'));}
   console.log(JSON.stringify({scenario:fail?'failure-remains-alive-and-retries':'waits-before-exit',passed:true,events:names}));
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
