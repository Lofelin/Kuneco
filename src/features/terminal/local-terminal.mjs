import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {StringDecoder} from 'node:string_decoder';
import {validConsoleDirectory} from '../../shared/console-preferences.mjs';

export class LocalTerminal extends EventEmitter {
 constructor(owner){super();this.owner=owner;this.id=null;this.token=randomUUID();this.closed=false;this.pendingBytes=0;}
 async open(cols=80,rows=24,loginEngine,workingDirectory=''){
  if(loginEngine!==undefined)throw new Error('本机运行时请使用运行时页面的登录入口');
  if(!validConsoleDirectory(workingDirectory))throw new Error('无效的终端工作目录');
  const cwd=workingDirectory||homedir();
  if(!(await stat(cwd)).isDirectory())throw new Error('工作目录不存在');
  if(this.closed)throw new Error('终端连接已取消');
  const size=(c,r)=>Number.isInteger(c)&&c>=2&&c<=500&&Number.isInteger(r)&&r>=1&&r<=300;
  if(!size(cols,rows))throw new Error('无效的终端尺寸');
  const child=this.child=spawn(process.platform==='darwin'?'/usr/bin/python3':'python3',['-u',fileURLToPath(new URL('./local-pty.py',import.meta.url)),String(cols),String(rows)],{cwd,env:{...process.env,LANG:process.platform==='darwin'?'en_US.UTF-8':'C.UTF-8',LC_ALL:process.platform==='darwin'?'en_US.UTF-8':'C.UTF-8',TERM:'xterm-256color',COLORTERM:'truecolor'},stdio:['pipe','pipe','pipe']});
  child.stdin.on('error',()=>{});
  await new Promise((resolve,reject)=>{
   let buffer='',error='';const decoder=new StringDecoder('utf8');
   child.stderr.on('data',data=>{error=(error+data).slice(-2000);});
   child.once('error',reject);
   child.once('close',()=>{reject(new Error(error||'本机终端已退出'));const tail=decoder.end();if(tail)this.emit('data',tail);this.close();});
   child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
    buffer+=chunk;let end;
    while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let event;try{event=JSON.parse(line);}catch{continue;}
     if(event.type==='ready')resolve();
     if(event.type==='data'){const text=decoder.write(Buffer.from(event.data,'base64'));this.pendingBytes+=Buffer.byteLength(text);this.emit('data',text);if(this.pendingBytes>262144)child.stdout.pause();}
    }
   });
  });
 }
 send(value){if(!this.closed&&this.child?.stdin.writable)this.child.stdin.write(JSON.stringify(value)+'\n');}
 write(data){if(typeof data==='string'&&Buffer.byteLength(data)<=65536)this.send({type:'input',data});}
 resize(cols,rows){if(Number.isInteger(cols)&&cols>=2&&cols<=500&&Number.isInteger(rows)&&rows>=1&&rows<=300)this.send({type:'resize',cols,rows});}
 acknowledge(bytes){if(Number.isInteger(bytes)&&bytes>0&&bytes<=1048576){this.pendingBytes=Math.max(0,this.pendingBytes-bytes);if(this.pendingBytes<131072)this.child?.stdout.resume();}}
 acceptsLoginCallback(){return false;}
 close(){if(this.closed)return;this.send({type:'close'});this.closed=true;this.child?.stdout.resume();this.child?.stdin.end();this.emit('exit');}
}
