// Opt-in live model acceptance. Proxy credentials remain in memory.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ProxyGateway} from '../../src/features/proxy/proxy.mjs';
import {parseIproyalExport} from '../../src/features/proxy/iproyal-import.mjs';
import {runCodex} from '../../src/features/runtimes/codex-runner.mjs';
import {detectAIAuth} from '../../src/features/runtimes/ai-auth.mjs';
import {evaluateEnvironment,readSystemEnvironment} from '../../src/features/environments/environment-gate.mjs';
assert.equal(evaluateEnvironment(await readSystemEnvironment()).allowed,true,'System environment gate');
const config=parseIproyalExport(await readFile(process.argv[2],'utf8')).entries[0];
const gateway=await new ProxyGateway(config).start();
const project=await mkdtemp(path.join(tmpdir(),'workspace-web-'));
const report={at:new Date().toISOString(),model:'gpt-5.5',tools:[],text:''};
const controller=new AbortController();let timer;
try {
  const status=await gateway.verify();assert.equal(status.state,'ready');report.gatewayIp=status.ip;
  const executable=execFileSync('/usr/bin/which',['codex'],{encoding:'utf8'}).trim();
  const auth=await detectAIAuth({engine:'codex',executable,gateway});assert.equal(auth.state,'signed-in');
  timer=setTimeout(()=>controller.abort(),120000);
  await runCodex({executable,project,model:report.model,gateway,signal:controller.signal,canStart:()=>gateway.status.state==='ready',
    prompt:'请调用联网搜索工具查找 IANA 官方的 example.com 保留域名说明，并读取搜索结果中的官方页面。用中文一句话回答该域名用途，附官方来源链接。必须使用联网工具，不要使用 Shell 或本地文件。',
    onEvent:(type,value)=>{if(type==='tool')report.tools.push(value);if(type==='text')report.text+=value;}});
  assert.ok(report.tools.some(tool=>/web_search/.test(tool)),'Actual web search event required');
  assert.match(report.text,/iana\.org/,'Official source link required');
  assert.equal((await gateway.verify()).ip,report.gatewayIp);
  report.passed=true;
} catch(error) {report.passed=false;report.error=error.message;process.exitCode=1;}
finally {
  clearTimeout(timer);await gateway.stop();await rm(project,{recursive:true,force:true});
  await writeFile('artifacts/chat-web-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
