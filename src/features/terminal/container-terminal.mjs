import {validConsoleDirectory} from '../../shared/console-preferences.mjs';
import http from 'node:http';
import {createLoginLinkDetector,matchesCodexCallback} from './terminal-login-links.mjs';
import {EventEmitter} from 'node:events';
import {StringDecoder} from 'node:string_decoder';
import {randomUUID} from 'node:crypto';

// Docker's creation-time Env survives gateway credential rotation. Read the
// current managed proxy inside each new shell; keep offline consoles fail-closed.
export const managedTerminalProxyScript='kuneco_proxy=$(cat /tmp/dingtu-chat-proxy 2>/dev/null) || kuneco_proxy=; kuneco_proxy=${kuneco_proxy:-http://127.0.0.1:9}; export HTTP_PROXY="$kuneco_proxy" HTTPS_PROXY="$kuneco_proxy" ALL_PROXY="$kuneco_proxy" http_proxy="$kuneco_proxy" https_proxy="$kuneco_proxy" all_proxy="$kuneco_proxy"; export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1; unset kuneco_proxy; ';
export const managedTerminalBashrc=`[ ! -r ~/.bashrc ] || . ~/.bashrc
_kuneco_refresh_proxy() { ${managedTerminalProxyScript} }
# DEBUG runs before commands, including ones entered at an already idle prompt.
# Preserve an existing user DEBUG trap by chaining its command after the refresh.
_kuneco_previous_debug=$(trap -p DEBUG)
if [ -n "$_kuneco_previous_debug" ]; then
 _kuneco_previous_debug=\${_kuneco_previous_debug#trap -- }
 _kuneco_previous_debug=\${_kuneco_previous_debug% DEBUG}
 eval "_kuneco_previous_debug=$_kuneco_previous_debug"
fi
trap '_kuneco_refresh_proxy; eval "$_kuneco_previous_debug"' DEBUG
_kuneco_refresh_proxy
`;

function request(socketPath,path,body){
 return new Promise((resolve,reject)=>{
  const req=http.request({socketPath,path,method:'POST',headers:{'Content-Type':'application/json'}},res=>{
   let data='';res.setEncoding('utf8');res.on('data',chunk=>{data+=chunk;if(data.length>1048576)req.destroy(new Error('容器响应过大'));});res.on('error',reject);
   res.on('end',()=>{if(res.statusCode<200 || res.statusCode>=300)return reject(new Error('终端请求失败：'+data.slice(0,200)));try{resolve(data?JSON.parse(data):{});}catch{reject(new Error('容器响应无效'));}});
  });req.on('error',reject);req.setTimeout(15000,()=>req.destroy(new Error('终端连接超时')));req.end(JSON.stringify(body));
 });
}
export class ContainerTerminal extends EventEmitter{
 constructor(manager,owner,id){super();Object.assign(this,{manager,owner,id});this.token=randomUUID();this.closed=false;this.pendingBytes=0;}
 async open(cols=80,rows=24,loginEngine,workingDirectory=''){
  if(!validConsoleDirectory(workingDirectory))throw new Error('无效的终端工作目录');
  if(loginEngine!==undefined && !['cc','codex'].includes(loginEngine))throw new Error('未知运行时');
  const {item,prefix}=await this.manager.get(this.owner,this.id);
  this.endpoint=item.external?.endpoint || this.manager.endpoint;
  if(!this.endpoint.startsWith('unix://'))throw new Error('控制台仅支持本机 Docker 引擎');
  const socketPath=this.endpoint.slice(7),container=item.external?.id || prefix+'-worker';
  this.pidFile='/tmp/dingtu-console-'+this.token;
  this.browserFile=(item.external?.workingDirectory || '/home/node')+'/.dingtu-browser-'+this.token;
  const browserScript=String.raw`#!/bin/sh
for url do case "$url" in http://*|https://*) printf '\033]777;dingtu-open-url;%s\007' "$url"; exit;; esac; done
`;
  await this.manager.exec(this.owner,this.id,['sh','-c','umask 077; printf %s "$2" > "$1" && chmod 700 "$1"','dingtu-browser',this.browserFile,browserScript]);
  if(!item.external){
   this.rcFile=this.browserFile+'.bashrc';
   await this.manager.exec(this.owner,this.id,['sh','-c','umask 077; printf %s "$2" > "$1"','dingtu-console-rc',this.rcFile,managedTerminalBashrc]);
  }
  const loginCommand=loginEngine==='codex'?'umask 077; mkdir -p "${CODEX_HOME:-$HOME/.codex}" && codex login':loginEngine==='cc'?'claude auth login':null;
  const command=loginCommand?['sh','-c','umask 077; echo $$ > "$1" || exit 1; shift; exec bash -ic "$1"','dingtu-console',this.pidFile,loginCommand+'; exec bash -i']:['sh','-c','umask 077; echo $$ > "$1" || exit 1; if command -v bash >/dev/null 2>&1; then exec bash -i; else exec sh -i; fi','dingtu-console',this.pidFile];
  if(!item.external)command[2]=managedTerminalProxyScript+command[2];
  if(this.rcFile){
   // Pass the generated path as environment data, never interpolate shell input.
   command[2]=command[2].replaceAll('exec bash -','exec bash --rcfile "$KUNECO_CONSOLE_RC" -');
   if(loginCommand)command[command.length-1]=loginCommand+'; exec bash --rcfile "$KUNECO_CONSOLE_RC" -i';
  }
  const result=await request(socketPath,'/containers/'+encodeURIComponent(container)+'/exec',{
   AttachStdin:true,AttachStdout:true,AttachStderr:true,Tty:true,Cmd:command,
   ...(item.external?{}:{User:'1000:1000'}),WorkingDir:workingDirectory || item.external?.workingDirectory || '/workspace',
   Env:['TERM=xterm-256color','COLORTERM=truecolor','LANG=C.UTF-8','LC_ALL=C.UTF-8','BROWSER='+this.browserFile,...(this.rcFile?['KUNECO_CONSOLE_RC='+this.rcFile]:[])],ConsoleSize:[rows,cols]
  });
  this.execId=result.Id;if(this.closed)return;
  const detectLoginLink=createLoginLinkDetector(loginEngine,(url,login)=>{this.browserLogin=login;this.emit('open-url',url);});
  await new Promise((resolve,reject)=>{
   const req=http.request({socketPath,path:'/exec/'+encodeURIComponent(this.execId)+'/start',method:'POST',headers:{'Content-Type':'application/json',Connection:'Upgrade',Upgrade:'tcp'}},res=>{res.resume();reject(new Error('容器未建立交互式终端（'+res.statusCode+'）'));});
   this.connectRequest=req;req.setTimeout(15000,()=>req.destroy(new Error('终端连接超时')));
   req.on('error',reject);req.on('upgrade',(res,socket,head)=>{
    if(this.closed){socket.destroy();resolve();return;}
    req.setTimeout(0);this.socket=socket;const decoder=new StringDecoder('utf8');
    const output=chunk=>{const text=decoder.write(chunk);if(text){this.pendingBytes+=Buffer.byteLength(text);this.emit('data',text);detectLoginLink(text);if(this.pendingBytes>262144)socket.pause();}};
    socket.on('data',output);socket.on('error',()=>this.emit('notice','终端连接中断'));
    socket.once('close',()=>{const tail=decoder.end();if(tail)this.emit('data',tail);this.close();});
    if(head.length)output(head);resolve();
   });req.end(JSON.stringify({Detach:false,Tty:true}));
  });
 }
 acceptsLoginCallback(url){return !this.closed && matchesCodexCallback(url,this.browserLogin);}
 async forwardLoginCallback(url){
  if(!this.acceptsLoginCallback(url))throw new Error('登录回调与当前容器会话不匹配');
  if(this.callbackPending)return this.callbackPending;
  this.callbackPending=this.manager.exec(this.owner,this.id,['node','-e',`const http=require('http');const initial=new URL(process.argv[1]);function visit(url,remaining){const request=http.get(url,{headers:{Host:initial.host}},res=>{res.resume();res.on('end',()=>{if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){const next=new URL(res.headers.location,url);if(remaining<1||next.origin!==initial.origin){process.exit(1);return;}visit(next,remaining-1);return;}console.log(res.statusCode);process.exit(res.statusCode>=200&&res.statusCode<300?0:1);});});request.setTimeout(120000,()=>request.destroy());request.on('error',()=>process.exit(1));}visit(initial,3);`,url],{timeout:125000}).then(()=>true);
  return this.callbackPending;
 }
 acknowledge(bytes){if(Number.isInteger(bytes) && bytes>0 && bytes<=1048576){this.pendingBytes=Math.max(0,this.pendingBytes-bytes);if(this.pendingBytes<131072)this.socket?.resume();}}
 write(data){if(!this.closed && typeof data==='string' && Buffer.byteLength(data)<=65536)this.socket?.write(data);}
 async resize(cols,rows){if(!this.closed && this.execId && Number.isInteger(cols) && Number.isInteger(rows) && cols>=2 && cols<=500 && rows>=1 && rows<=300)await request(this.endpoint.slice(7),'/exec/'+this.execId+'/resize?w='+cols+'&h='+rows,{});}
 close(){
  if(this.closed)return;this.closed=true;this.connectRequest?.destroy();this.socket?.destroy();
  if(this.pidFile)void this.manager.exec(this.owner,this.id,['sh','-c','p="$1"; if test -r "$p"; then pid=$(cat "$p"); case "$pid" in ""|*[!0-9]*) ;; *) kill -HUP -- "-$pid" 2>/dev/null || kill -HUP "$pid" 2>/dev/null;; esac; rm -f "$p"; fi; rm -f "$2" "$3"','dingtu-close',this.pidFile,this.browserFile,this.rcFile||''],{timeout:5000}).catch(()=>{});
  this.emit('exit');
 }
}
