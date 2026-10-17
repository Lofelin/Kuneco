import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DockerEnvironments,resourcePrefix} from '../src/docker-environments.mjs';
import {ContainerTerminal} from '../src/container-terminal.mjs';

const directory=await mkdtemp(path.join(tmpdir(),'dingtu-console-test-'));
const manager=new DockerEnvironments({directory,sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()});
const owner='console-'+Date.now();let id,terminal,externalContainer,output='';
const wait=async predicate=>{const until=Date.now()+10000;while(Date.now()<until){if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw new Error('终端验收超时：'+output.slice(-600));};
try{
 id=await manager.createAndStart(owner,'控制台验收');
 await assert.rejects(new ContainerTerminal(manager,'other-owner',id).open());
 terminal=new ContainerTerminal(manager,owner,id);terminal.on('data',text=>{output+=text;terminal.acknowledge(Buffer.byteLength(text));});await terminal.open(80,24);
 terminal.write('test -t 0 && printf "TTY_OK\\n"; id -u\r');
 await wait(()=>output.includes('TTY_OK\r\n1000\r\n'));
 terminal.write('"$BROWSER" https://example.test/login\r');await wait(()=>output.includes('\x1b]777;dingtu-open-url;https://example.test/login\x07'));
 await terminal.resize(100,30);terminal.write('stty size\r');await wait(()=>output.includes('30 100\r\n'));
 const tools=await manager.exec(owner,id,['bash','-ic','for tool in git curl wget jq rg python3 pip3 nano vi less tree zip unzip ps top ss ping dig nc ssh rsync make gcc g++; do command -v "$tool" >/dev/null || exit 1; done; declare -F _init_completion >/dev/null && echo TOOLS_OK']);assert.ok(tools.includes('TOOLS_OK'));
 terminal.write('printf "TAB_COMPLETION_OK\\n" >/tmp/console-completion-proof\r');
 terminal.write('cat /tmp/console-completion-pro\t\r');await wait(()=>output.includes('TAB_COMPLETION_OK\r\n'));
 terminal.write('sleep 100\r');await new Promise(r=>setTimeout(r,200));terminal.write('\u0003printf "CTRL_C_OK\\n"\r');await wait(()=>output.includes('CTRL_C_OK\r\n'));
 const listener=String.raw`const http=require('http'),fs=require('fs');const server=http.createServer((req,res)=>{if(req.url==='/success'){fs.writeFileSync('/tmp/callback-success','ok');res.end('success');server.close();return;}fs.writeFileSync('/tmp/callback-proof',req.url);res.writeHead(302,{Location:'/success'});res.end();});server.listen(1455,'127.0.0.1',()=>fs.writeFileSync('/tmp/callback-ready','ready'));`;
 await manager.exec(owner,id,['node','-e',`const {spawn}=require('child_process');const child=spawn('node',['-e',process.argv[1]],{detached:true,stdio:'ignore'});child.unref();`,listener]);
 for(let attempt=0;attempt<30;attempt++){try{await manager.exec(owner,id,['test','-f','/tmp/callback-ready']);break;}catch{await new Promise(r=>setTimeout(r,50));}}
 terminal.browserLogin={state:'test-state',redirect:'http://localhost:1455/auth/callback'};
 await assert.rejects(terminal.forwardLoginCallback('http://localhost:1455/auth/callback?state=wrong&code=fake'));
 await terminal.forwardLoginCallback('http://localhost:1455/auth/callback?state=test-state&code=fake');
 assert.equal(await manager.exec(owner,id,['cat','/tmp/callback-proof']),'/auth/callback?state=test-state&code=fake');
 assert.equal(await manager.exec(owner,id,['cat','/tmp/callback-success']),'ok');
 const pid=await manager.exec(owner,id,['cat',terminal.pidFile]);assert.match(pid,/^\d+$/);
 terminal.close();await new Promise(r=>setTimeout(r,500));
 assert.equal(await manager.exec(owner,id,['sh','-c','test ! -e "$1" && test ! -d "/proc/$2" && echo CLOSED','proof',terminal.pidFile,pid]),'CLOSED');
 // Reconnect creates a fresh shell, while files remain in the same environment.
 output='';terminal=new ContainerTerminal(manager,owner,id);terminal.on('data',text=>{output+=text;terminal.acknowledge(Buffer.byteLength(text));});await terminal.open();terminal.write('cat /tmp/console-completion-proof\r');await wait(()=>output.includes('TAB_COMPLETION_OK\r\n'));
 terminal.close();await new Promise(r=>setTimeout(r,300));
 // Exercise login startup without contacting an auth service or using real credentials.
 await manager.exec(owner,id,['node','-e',String.raw`const fs=require('fs');fs.mkdirSync('/home/node/.local/bin',{recursive:true});fs.writeFileSync('/home/node/.local/bin/codex','#!/bin/sh\n[ -t 0 ] && [ -d "$CODEX_HOME" ] && [ "$(stat -c %a "$CODEX_HOME")" = 700 ] && [ "$*" = "login" ] && echo CODEX_LOGIN_READY\n',{mode:0o755});fs.writeFileSync('/home/node/.local/bin/claude','#!/bin/sh\n[ -t 0 ] && [ "$*" = "auth login" ] && echo CLAUDE_LOGIN_READY\n',{mode:0o755});`]);
 output='';terminal=new ContainerTerminal(manager,owner,id);terminal.on('data',text=>{output+=text;terminal.acknowledge(Buffer.byteLength(text));});await terminal.open(80,24,'codex');await wait(()=>output.includes('CODEX_LOGIN_READY\r\n'));terminal.close();await new Promise(r=>setTimeout(r,300));
 output='';terminal=new ContainerTerminal(manager,owner,id);terminal.on('data',text=>{output+=text;terminal.acknowledge(Buffer.byteLength(text));});await terminal.open(80,24,'cc');await wait(()=>output.includes('CLAUDE_LOGIN_READY\r\n'));terminal.close();await new Promise(r=>setTimeout(r,300));
 const externalName='console-external-test-'+Date.now();
 externalContainer=await manager.command(['run','-d','--name',externalName,'--network','none','--user','1000:1000','--entrypoint','sleep','dingtu-runtime:3-clean','infinity']);
 const externalId=await manager.create(owner,'原容器终端验收');await manager.update(owner,externalId,{external:{id:externalContainer,endpoint:manager.endpoint,workingDirectory:'/workspace'}});
 output='';terminal=new ContainerTerminal(manager,owner,externalId);terminal.on('data',text=>{output+=text;terminal.acknowledge(Buffer.byteLength(text));});await terminal.open();terminal.write('id -u; printf "EXTERNAL_OK\\n"\r');await wait(()=>output.includes('1000\r\n') && output.includes('EXTERNAL_OK\r\n'));
 terminal.close();await new Promise(r=>setTimeout(r,300));assert.equal(await manager.command(['inspect','--format','{{.State.Running}}',externalContainer]),'true');
 console.log('控制台验收通过：真实 TTY、非 root、尺寸调整、工具集与 Bash 补全、Tab 文件补全、Ctrl+C、退出清理、重新连接、原容器保留及跨账号拒绝。');
}finally{
 terminal?.close();await new Promise(r=>setTimeout(r,300));
 if(externalContainer)await manager.command(['rm','-f',externalContainer]).catch(()=>{});
 if(id){const prefix=resourcePrefix(owner,id);for(const suffix of ['worker','gateway'])await manager.command(['rm','-f',prefix+'-'+suffix]).catch(()=>{});await manager.command(['network','rm',prefix+'-private']).catch(()=>{});for(const suffix of ['home','work'])await manager.command(['volume','rm',prefix+'-worker-'+suffix]).catch(()=>{});}
 await rm(directory,{recursive:true,force:true});
}
