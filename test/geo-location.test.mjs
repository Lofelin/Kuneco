import test from 'node:test';
import assert from 'node:assert/strict';
import {formatProxyLocation} from '../src/geo-location.mjs';
test('IPinfo城市与省州分别翻译并跟随显示语言',()=>{
 const status={countryCode:'US',city:'New York City',region:'New York'};
 assert.equal(formatProxyLocation(status).text,'纽约市 · 纽约州 · 美国');
 assert.equal(formatProxyLocation(status,'en-US').text,'New York City · New York · United States');
 assert.equal(formatProxyLocation({countryCode:'US',city:'Washington',region:'Washington'}).text,'华盛顿 · 华盛顿州 · 美国');
});
test('未知地名保留原文，同名层级合并',()=>{
 assert.equal(formatProxyLocation({countryCode:'US',city:'Unlisted Town',region:'California'}).text,'Unlisted Town · 加利福尼亚州 · 美国');
 assert.equal(formatProxyLocation({countryCode:'SG',city:'Singapore',region:'Singapore'}).text,'新加坡');
});
