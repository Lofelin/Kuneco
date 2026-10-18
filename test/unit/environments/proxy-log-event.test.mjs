import test from 'node:test';
import assert from 'node:assert/strict';
import {proxyLogEvent} from '../../../src/features/environments/proxy-log-event.mjs';
test('connection phases, egress and verification time survive state deduplication',()=>{
 const restore=proxyLogEvent('network',{state:'checking',reason:'正在恢复上次选中的环境及代理'});
 const verify=proxyLogEvent('network',{state:'checking',reason:'正在通过指定代理核验出口'});
 assert.notEqual(restore.message,verify.message);
 const ready=proxyLogEvent('network',{state:'ready',reason:'固定出口核验成功；应用代理就绪',ip:'198.51.100.2',checkedAt:'2026-10-18T00:00:00Z'});
 assert.match(ready.message,/Fixed egress verified/);assert.match(ready.message,/egress_ip=198.51.100.2/);assert.match(ready.message,/checked_at=/);
 assert.match(proxyLogEvent('network',{state:'blocked',reason:'应用退出'}).message,/shutting down/);
 assert.match(proxyLogEvent('network',{state:'blocked',reason:'代理已停止'}).message,/Proxy stopped/);
});
test('failures retain safe target and code without copying credentials',()=>{
 const event=proxyLogEvent('requestFailure',{reason:'token=secret',code:'ECONNRESET',target:'example.com:443'});
 assert.equal(event.level,'WARN');assert.match(event.message,/code=ECONNRESET/);assert.match(event.message,/target=example.com:443/);assert.doesNotMatch(event.message,/secret/);
 assert.doesNotMatch(proxyLogEvent('network',{ip:'secret',target:'https://user:password@example.com/path'}).message,/secret|password/);
});
