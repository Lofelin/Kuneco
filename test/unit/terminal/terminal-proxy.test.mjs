import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {managedTerminalProxyScript} from '../../../src/features/terminal/container-terminal.mjs';

const keys=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'];
function launch(value,missing=false){
 const read=missing?'cat(){ return 1; }; ':'cat(){ printf %s "$TEST_PROXY"; }; ';
 const result=spawnSync('sh',['-c',read+managedTerminalProxyScript+'exec "$TEST_NODE" -e \'console.log(JSON.stringify(process.env))\''],{encoding:'utf8',env:{...process.env,...Object.fromEntries(keys.map(k=>[k,'http://stale:credential@proxy:8080'])),NO_PROXY:'*',no_proxy:'*',TEST_NODE:process.execPath,TEST_PROXY:value}});
 assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
test('new shells use rotated proxy credentials for every proxy variable',()=>{
 for(const value of ['http://workspace:first@proxy:8080','http://workspace:second@proxy:8080']){
  const env=launch(value);for(const key of keys)assert.equal(env[key],value);
  assert.equal(env.NO_PROXY,'localhost,127.0.0.1');assert.equal(env.no_proxy,env.NO_PROXY);
 }
});
test('missing or empty current proxy stays blocked instead of inheriting stale credentials or bypassing',()=>{
 for(const env of [launch('',true),launch('')])for(const key of keys)assert.equal(env[key],'http://127.0.0.1:9');
});
test('proxy values are data, not evaluated shell commands',()=>{
 const value='http://workspace:$(exit 97);"@proxy:8080';
 const env=launch(value);for(const key of keys)assert.equal(env[key],value);
});

test('already idle interactive shell refreshes before its next command and keeps PID and cwd',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {spawn}=await import('node:child_process');
 const {managedTerminalBashrc}=await import('../../../src/features/terminal/container-terminal.mjs');
 const dir=await mkdtemp(join(tmpdir(),'kuneco-terminal-proxy-')),proxy=join(dir,'proxy'),rc=join(dir,'bashrc');
 let child;
 try{
  await writeFile(proxy,'http://workspace:first@proxy:8080');
  await writeFile(rc,managedTerminalBashrc.replace('[ ! -r ~/.bashrc ] || . ~/.bashrc',`PS1='READY> '; trap 'export USER_TRAP_RAN=yes' DEBUG`).replaceAll('/tmp/dingtu-chat-proxy',proxy));
  child=spawn('bash',['--rcfile',rc,'-i'],{cwd:dir,env:{...process.env},stdio:['pipe','pipe','pipe']});let output='';
  child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
  const wait=async pattern=>{const until=Date.now()+5000;while(!pattern.test(output)){if(Date.now()>until)throw Error(output);await new Promise(r=>setTimeout(r,10));}};
  await wait(/READY> /);output='';
  child.stdin.write('printf "FIRST=%s PID=%s CWD=%s TRAP=%s\\n" "$HTTPS_PROXY" "$$" "$PWD" "$USER_TRAP_RAN"\n');
  await wait(/FIRST=http:\/\/workspace:first@proxy:8080 PID=(\d+) CWD=\S+ TRAP=yes/);
  const pid=/FIRST=.* PID=(\d+)/.exec(output)[1];await wait(/TRAP=yes\r?\nREADY> /);output='';
  await writeFile(proxy,'http://workspace:second@proxy:8080');
  child.stdin.write('printf "SECOND=%s PID=%s CWD=%s TRAP=%s\\n" "$HTTPS_PROXY" "$$" "$PWD" "$USER_TRAP_RAN"\n');
  await wait(/SECOND=http:\/\/workspace:second@proxy:8080 PID=(\d+) CWD=\S+ TRAP=yes/);
  assert.ok(output.includes(`PID=${pid} CWD=`));
  assert.ok(output.includes(`${dir} TRAP=yes`));
 }finally{child?.kill("SIGKILL");await rm(dir,{recursive:true,force:true});}
});
