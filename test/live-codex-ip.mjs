// Opt-in live model acceptance. Proxy credentials remain in memory.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ProxyGateway} from '../src/proxy.mjs';
import {parseIproyalExport} from '../src/iproyal-import.mjs';
import {runCodex} from '../src/codex-runner.mjs';
import {detectAIAuth} from '../src/ai-auth.mjs';
import {evaluateEnvironment,readSystemEnvironment} from '../src/environment-gate.mjs';
assert.equal(evaluateEnvironment(await readSystemEnvironment()).allowed,true,'System environment gate');
const config=parseIproyalExport(await readFile(process.argv[2],'utf8')).entries[0];
const gateway=await new ProxyGateway(config).start();
const project=await mkdtemp(path.join(tmpdir(),'workspace-web-'));
const report={at:new Date().toISOString(),model:'gpt-5.5',tools:[],text:'',proxyTargets:[]};
const originalTunnel=gateway.tunnel.bind(gateway);gateway.tunnel=(host,port)=>{if(!report.proxyTargets.some(item=>item.host===host && item.port===port))report.proxyTargets.push({host,port});return originalTunnel(host,port);};
const controller=new AbortController();let timer;
try {
  const status=await gateway.verify();assert.equal(status.state,'ready');report.gatewayIp=status.ip;
  const executable=execFileSync('/usr/bin/which',['codex'],{encoding:'utf8'}).trim();
  const auth=await detectAIAuth({engine:'codex',executable,gateway});assert.equal(auth.state,'signed-in');
  timer=setTimeout(()=>controller.abort(),120000);
  await runCodex({executable,project,model:report.model,gateway,signal:controller.signal,canStart:()=>gateway.status.state==='ready',
    prompt:'我的本机对话出口 IP 是什么？OpenAI 看到的 IP 是什么？请根据应用提供的测量事实简短回答；不要用服务端网页工具查询 IP，不需要读文件。',
    onEvent:(type,value)=>{if(type==='tool')report.tools.push(value);if(type==='text')report.text+=value;}});
  assert.ok(report.text.includes(report.gatewayIp),'Response must cite the measured gateway IP');
  assert.ok(!report.tools.includes('web_search'),'Local IP question must not query hosted web tools');
  assert.ok(report.proxyTargets.some(item=>item.host==='chatgpt.com' || item.host==='api.openai.com'),'Actual model service tunnel must pass through this gateway');
  assert.equal((await gateway.verify()).ip,report.gatewayIp);
  report.passed=true;
} catch(error) {report.passed=false;report.error=error.message;process.exitCode=1;}
finally {
  clearTimeout(timer);await gateway.stop();await rm(project,{recursive:true,force:true});
  await writeFile('artifacts/codex-ip-diagnosis.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
