import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateEnvironment} from '../../../src/features/environments/environment-gate.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const sample=(timeZone,languages=['en-US'])=>evaluateEnvironment({timeZone,languages});
test('支持地区的明确时区与非中文语言通过，不能仅按时差判定',()=>{
  for(const zone of ['America/New_York','Europe/Berlin','Asia/Taipei','Asia/Tokyo','US/Eastern']) assert.equal(sample(zone).passed,true,zone);
  assert.equal(sample('Asia/Shanghai').passed,false);
  assert.equal(sample('Asia/Urumqi').passed,false);
  assert.equal(sample('PRC').passed,false);
  assert.equal(sample('Asia/Hong_Kong').passed,false);
  assert.equal(sample('Europe/Moscow').passed,false);
});
test('中文首选提醒，非中文首选允许中文次选，应用强制英文不能替代系统检测',()=>{
  for(const languages of [['zh-CN'],['zh-Hans-US'],['zh-Hant-TW','en-US']]) assert.equal(sample('America/New_York',languages).passed,false);
  assert.equal(sample('Europe/Berlin',['de-DE','en-US']).passed,true);
  assert.equal(sample('America/New_York',['en-US','zh-Hans-US']).passed,true);
});
test('UTC、未知时区、语言读取异常和进程TZ覆盖不一致均产生提醒',()=>{
  for(const zone of ['UTC','Etc/UTC','Etc/GMT-8',null,'Not/A_Zone']) assert.equal(sample(zone).passed,false);
  assert.equal(sample('America/New_York',[]).passed,false);
  assert.equal(evaluateEnvironment({error:true}).passed,false);
  assert.equal(evaluateEnvironment({timeZone:'America/New_York',effectiveTimeZone:'Asia/Shanghai',languages:['en-US']}).passed,false);
  assert.equal(sample('Europe/Simferopol').passed,false);
});
test('多次重检更新提醒结果，不改变功能可用性',()=>{
  assert.equal(sample('Asia/Shanghai').passed,false);
  assert.equal(sample('America/New_York').passed,true);
  assert.equal(sample('America/New_York',['zh-CN']).passed,false);
});
test('warning checks publish diagnostics without stopping browser connections or the gateway',async()=>{
  const source=await readFile(new URL('../../../src/app/main.mjs',import.meta.url),'utf8');
  const events=[];
  const context=vm.createContext({evaluateEnvironment,fixtureEnvironment:{timeZone:'Asia/Shanghai',languages:['zh-CN']},environmentPromise:null,
    environmentStatus:null,showBrowserViews(){},emit:(type,data)=>events.push({type,data}),
    directBrowserTransport:{closeConnections:()=>assert.fail('must keep browser connections')},
    stopBrowserTabs:()=>assert.fail('must keep browser tabs'),stopGateway:()=>assert.fail('must keep gateway')});
  vm.runInContext(source.slice(source.indexOf('async function checkEnvironment()'),source.indexOf('function guarded(')),context);
  const result=await context.checkEnvironment();
  assert.equal(result.passed,false);
  assert.ok(result.reasons.length);
  assert.deepEqual(events.map(event=>event.type),['environment']);
});
