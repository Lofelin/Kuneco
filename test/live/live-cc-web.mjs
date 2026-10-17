// Opt-in live Claude tools acceptance; no authentication changes.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {query} from '@anthropic-ai/claude-agent-sdk';
import {ProxyGateway,proxyEnvironment} from '../../src/features/proxy/proxy.mjs';
import {parseIproyalExport} from '../../src/features/proxy/iproyal-import.mjs';
import {detectAIAuth} from '../../src/features/runtimes/ai-auth.mjs';
import {createRestrictedCCSpawner} from '../../src/features/runtimes/cc-network-guard.mjs';
import {evaluateEnvironment,readSystemEnvironment} from '../../src/features/environments/environment-gate.mjs';
assert.equal(evaluateEnvironment(await readSystemEnvironment()).allowed,true);
const gateway=await new ProxyGateway(parseIproyalExport(await readFile(process.argv[2],'utf8')).entries[0]).start();
const project=await mkdtemp(path.join(tmpdir(),'workspace-cc-web-'));
const controller=new AbortController();let timer,execution;
const report={at:new Date().toISOString(),tools:[],text:''};
try {
  const status=await gateway.verify();assert.equal(status.state,'ready');report.gatewayIp=status.ip;
  const executable=execFileSync('/usr/bin/which',['claude'],{encoding:'utf8'}).trim();
  report.auth=(await detectAIAuth({engine:'cc',executable,gateway})).state;
  if(report.auth!=='signed-in') {report.skipped='Local Claude Code is not signed in; no model request sent';}
  else {
    timer=setTimeout(()=>controller.abort(),120000);
    execution=query({prompt:(async function*(){yield {type:'user',message:{role:'user',content:'使用 WebSearch 搜索 IANA 的 example.com 保留域名说明，然后使用 WebFetch 读取 https://www.iana.org/domains/reserved 。用中文一句话说明该域名用途并附来源链接。必须调用这两个联网工具。'},parent_tool_use_id:null,session_id:''};})(),options:{
      cwd:project,pathToClaudeCodeExecutable:executable,env:proxyEnvironment(process.env,gateway.url),settingSources:[],
      spawnClaudeCodeProcess:createRestrictedCCSpawner({port:gateway.port,canStart:()=>gateway.status.state==='ready'}),
      tools:['WebSearch','WebFetch'],mcpServers:{},strictMcpConfig:true,plugins:[],maxTurns:6,abortController:controller,
      canUseTool:async(name,input)=>({behavior:gateway.status.state==='ready' && ['WebSearch','WebFetch'].includes(name)?'allow':'deny',updatedInput:input})
    }});
    for await(const message of execution) {
      if(message.type==='assistant')for(const content of message.message.content || []) {
        if(content.type==='tool_use')report.tools.push(content.name);
        if(content.type==='text')report.text+=content.text;
      }
      if(message.type==='result')assert.equal(message.is_error,false);
    }
    assert.ok(report.tools.includes('WebSearch'));assert.ok(report.tools.includes('WebFetch'));
    assert.match(report.text,/iana\.org/);assert.equal((await gateway.verify()).ip,report.gatewayIp);report.passed=true;
  }
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{clearTimeout(timer);execution?.close();await gateway.stop();await rm(project,{recursive:true,force:true});await writeFile('artifacts/cc-web-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
