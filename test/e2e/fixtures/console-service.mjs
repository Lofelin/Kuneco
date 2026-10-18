import {DockerEnvironments} from '../../../src/features/environments/docker-environments.mjs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

export function createConsoleFixture(ctx){
 const manager=new DockerEnvironments({sourceRoot:process.cwd()});
 const name='kuneco-e2e-console-'+randomUUID().slice(0,8),environmentName='真实控制台迁移验收';
 let containerId,environmentId,previousId,recorderToken;
 const e=ctx.evaluate,until=ctx.until;
 const api=(action,value={})=>e(`workspace.dockerEnvironments(${JSON.stringify(action)},${JSON.stringify(value)})`);
 async function exec(args){return manager.command(['exec',containerId,...args],{timeout:10000});}
 async function prepare(){
  previousId=(await e('workspace.state()')).containerId??null;
  if(!containerId){
   // Tests use an existing local image; never pull an external dependency implicitly.
   await manager.command(['image','inspect','node:24-bookworm-slim'],{timeout:10000});
   // /tmp stays in this disposable container's writable layer across real stop/start.
   // A tmpfs would erase the recorder and its byte log when switching environments.
   containerId=(await manager.command(['run','-d','--name',name,'--label','io.kuneco.test=desktop-regression','--network','none','--user','1000:1000','--tmpfs','/workspace:rw,uid=1000,gid=1000','--workdir','/workspace','--entrypoint','node','node:24-bookworm-slim','-e','setInterval(()=>{},1000)'])).trim();
   const script=`const fs=require('fs'),token=process.argv[2];process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write('\\x1b[?2004hCONSOLE_CAPTURE_READY\\r\\n');process.stdin.on('data',data=>fs.appendFileSync('/tmp/console-inputs.jsonl',JSON.stringify({token,data:data.toString()})+'\\n'));setInterval(()=>{try{const text=fs.readFileSync('/tmp/console-output','utf8');fs.unlinkSync('/tmp/console-output');process.stdout.write(text);}catch{}},20);`;
   await exec(['node','-e',`require('fs').writeFileSync('/tmp/console-capture.cjs',process.argv[1])`,script]);
   const existing=await api('existing'),item=existing.find(item=>item.id===containerId||containerId.startsWith(item.id));
   if(!item)throw Error('Test-owned console container was not discovered by the real application');
   environmentId=(await api('attach',{name:environmentName,key:item.key})).createdId;
  }
  await e(`(()=>{window.__desktopConsoleTrace={tokens:[],events:[]};workspace.onEvent(event=>{if(event.type==='console'){const trace=window.__desktopConsoleTrace;trace.events.push(event.data);if(event.data.type==='data'&&!trace.tokens.includes(event.data.token))trace.tokens.push(event.data.token);}})})()`);
  await api('select',{id:environmentId});
  await until(()=>e(`workspace.state().then(state=>state.containerId===${JSON.stringify(environmentId)})`));
  return {environmentId,containerId};
 }
 async function snapshot(){
  const trace=await e('window.__desktopConsoleTrace'),token=trace.tokens.at(-1);
  if(token&&token!==recorderToken){
   recorderToken=token;
   await e(`workspace.console('input',{token:${JSON.stringify(token)},data:${JSON.stringify('node /tmp/console-capture.cjs '+token+'\r')}})`);
   await until(()=>e(`window.__desktopConsoleTrace.events.some(event=>event.token===${JSON.stringify(token)}&&event.text?.includes('CONSOLE_CAPTURE_READY'))`));
  }
  let inputs=[];try{inputs=(await exec(['cat','/tmp/console-inputs.jsonl'])).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch{}
  return {opens:trace.tokens.length,inputs,token};
 }
 async function output(text){await snapshot();await exec(['node','-e',"require('fs').writeFileSync('/tmp/console-output',process.argv[1])",text]);await until(()=>e(`window.__desktopConsoleTrace.events.some(event=>event.text?.includes(${JSON.stringify(text)}))`));}
 async function reset(){await api('select',{id:null});await api('select',{id:environmentId});}
 async function dispose(){
  if(environmentId){await api('select',{id:previousId});await api('delete',{id:environmentId,name:environmentName});environmentId=null;}
  if(containerId){await manager.command(['rm','-f',containerId]);containerId=null;}
 }
 async function cleanup(){if(containerId){await manager.command(['rm','-f',containerId]);containerId=null;}}
 return {prepare,snapshot,output,reset,dispose,cleanup,get environmentId(){return environmentId;},get containerId(){return containerId;},get name(){return name;},exec};
}
