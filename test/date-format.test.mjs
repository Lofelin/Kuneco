import test from 'node:test';import assert from 'node:assert/strict';
import {formatDisplayDate} from '../src/date-format.mjs';
test('display timestamps follow application language instead of English runtime locale',()=>{
 const value='2026-10-15T05:03:55';
 assert.match(formatDisplayDate(value,'zh-CN'),/2026年10月15日.*05:03:55/);
 assert.doesNotMatch(formatDisplayDate(value,'zh-CN'),/AM|PM/);
 assert.match(formatDisplayDate(value,'en-US'),/Oct 15, 2026.*5:03:55 AM/);
 assert.equal(formatDisplayDate(value,'zh-CN','time'),'05:03:55');
});
test('date-only display preserves calendar day across time zones and handles missing values',()=>{
 const old=process.env.TZ;process.env.TZ='America/Los_Angeles';
 try{assert.equal(formatDisplayDate('2026-10-15','zh-CN','date'),'2026年10月15日');assert.equal(formatDisplayDate('2026-10-15','en-US','date'),'Oct 15, 2026');}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
 for(const value of [null,undefined,'','invalid'])assert.equal(formatDisplayDate(value),'—');
});
