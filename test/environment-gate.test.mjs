import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateEnvironment} from '../src/environment-gate.mjs';
const sample=(timeZone,languages=['en-US'])=>evaluateEnvironment({timeZone,languages});
test('支持地区的明确时区与非中文语言通过，不能仅按时差判定',()=>{
  for(const zone of ['America/New_York','Europe/Berlin','Asia/Taipei','Asia/Tokyo','US/Eastern']) assert.equal(sample(zone).allowed,true,zone);
  assert.equal(sample('Asia/Shanghai').allowed,false);
  assert.equal(sample('Asia/Urumqi').allowed,false);
  assert.equal(sample('PRC').allowed,false);
  assert.equal(sample('Asia/Hong_Kong').allowed,false);
  assert.equal(sample('Europe/Moscow').allowed,false);
});
test('中文首选阻止，非中文首选允许中文次选，应用强制英文不能替代系统检测',()=>{
  for(const languages of [['zh-CN'],['zh-Hans-US'],['zh-Hant-TW','en-US']]) assert.equal(sample('America/New_York',languages).allowed,false);
  assert.equal(sample('Europe/Berlin',['de-DE','en-US']).allowed,true);
  assert.equal(sample('America/New_York',['en-US','zh-Hans-US']).allowed,true);
});
test('UTC、未知时区、语言读取异常和进程TZ覆盖不一致一律关闭',()=>{
  for(const zone of ['UTC','Etc/UTC','Etc/GMT-8',null,'Not/A_Zone']) assert.equal(sample(zone).allowed,false);
  assert.equal(sample('America/New_York',[]).allowed,false);
  assert.equal(evaluateEnvironment({error:true}).allowed,false);
  assert.equal(evaluateEnvironment({timeZone:'America/New_York',effectiveTimeZone:'Asia/Shanghai',languages:['en-US']}).allowed,false);
  assert.equal(sample('Europe/Simferopol').allowed,false);
});
test('多次重检可阻止、通过、再阻止，没有持久化绕过标志',()=>{
  assert.equal(sample('Asia/Shanghai').allowed,false);
  assert.equal(sample('America/New_York').allowed,true);
  assert.equal(sample('America/New_York',['zh-CN']).allowed,false);
});
