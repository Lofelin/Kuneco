import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalTerminal} from '../../../src/features/terminal/local-terminal.mjs';

test('local console has a real TTY, supports resize, Unicode, interrupt and reconnect',{timeout:15000},async()=>{
 const terminal=new LocalTerminal('test');let output='';terminal.on('data',text=>{output+=text;terminal.acknowledge(Buffer.byteLength(text));});
 const until=async(pattern)=>{for(let i=0;i<100;i++){if(pattern.test(output))return;await delay(50);}assert.match(output,pattern);};
 try{
  await terminal.open(80,24,undefined,'/tmp');
  terminal.write("printf '\\nTTY=%s\\n' \"$(test -t 0 && echo yes)\"\r");await until(/TTY=yes/);
  terminal.resize(101,37);terminal.write('stty size\r');await until(/37 101/);
  terminal.write("printf '\\u4f60\\u597d\\n'\r");await until(/你好/);
  terminal.write('sleep 30\r');await delay(150);terminal.write('\x03');terminal.write("printf '\\n%s%s\\n' interrupt -ok\r");await until(/interrupt-ok/);
 }finally{terminal.close();}
 assert.equal(terminal.closed,true);
 const next=new LocalTerminal('test');try{await next.open();assert.notEqual(next.token,terminal.token);}finally{next.close();}
});
test('local console rejects invalid directories and sizes',async()=>{
 const terminal=new LocalTerminal('test');
 await assert.rejects(terminal.open(80,24,undefined,'/does-not-exist/kuneco'));
 await assert.rejects(terminal.open(0,24));
 terminal.close();
});
