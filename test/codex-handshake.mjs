import assert from 'node:assert/strict';
import {codexClientInfo} from '../src/app-identity.mjs';
import {execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createRestrictedCCSpawner} from '../src/cc-network-guard.mjs';
import {proxyEnvironment} from '../src/proxy.mjs';
import {codexArguments} from '../src/codex-runner.mjs';
const executable=execFileSync('/usr/bin/which',['codex'],{encoding:'utf8'}).trim();
// Verify actual exec flag compatibility, without issuing a prompt.
execFileSync(executable,[...codexArguments({project:process.cwd()}),'--help'],{stdio:'ignore'});
const child=createRestrictedCCSpawner({port:1})({command:executable,args:['app-server','--listen','stdio://'],cwd:process.cwd(),env:proxyEnvironment(process.env,'http://127.0.0.1:1')});
const lines=createInterface({input:child.stdout});let timer;
try {
  const response=await new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(new Error('Codex初始化超时')),15000);
    child.on('error',reject);child.on('exit',()=>reject(new Error('Codex初始化前退出')));
    lines.on('line',line=>{try{const msg=JSON.parse(line);if(msg.id===1)msg.error?reject(new Error('Codex初始化被拒绝')):resolve(msg.result);}catch{}});
    child.stdin.write(JSON.stringify({id:1,method:'initialize',params:{clientInfo:codexClientInfo,capabilities:{experimentalApi:false}}})+'\n');
  });
  assert.ok(response.userAgent);child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
  console.log('本机Codex实际CLI参数与网络隔离初始化握手通过；未创建任务或发送模型提示。');
}finally{clearTimeout(timer);lines.close();child.stdin.end();child.kill('SIGTERM');}
