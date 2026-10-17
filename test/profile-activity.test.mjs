import test from 'node:test';
import assert from 'node:assert/strict';
import {profileActivity,activityTooltip} from '../src/profile-activity.mjs';
test('Token usage belongs to request day across sessions, independent of chat creation',()=>{
 const at=new Date(2026,9,14,12).toISOString();
 const result=profileActivity([{createdAt:new Date(2026,9,12).toISOString(),tokenUsage:[{at,totalTokens:120},{at,totalTokens:80},{at:'invalid',totalTokens:50}]},{createdAt:at,archived:true,tokenUsage:[{at,totalTokens:30},{at,totalTokens:-1}]}],new Date(2026,9,14));
 assert.equal(result.totalTokens,230);assert.equal(result.peakTokens,120);
 const day=result.days.at(-1);assert.equal(day.tokens,230);assert.equal(day.count,1);
 assert.equal(result.days.find(day=>day.date==='2026-10-12').tokens,null);
 assert.equal(activityTooltip(day),'10月14日 · 230 Token');
 assert.equal(activityTooltip({...day,tokens:null}),'10月14日 · 暂无 Token 数据');
 assert.equal(activityTooltip(day,'en-US'),'October 14 · 230 Token');
});
test('对话创建日期聚合，不将更新时间或归档时间当作创建活动',()=>{
 const today=new Date(2026,9,14);
 const result=profileActivity([{createdAt:new Date(2026,9,12).toISOString(),updatedAt:today.toISOString()},{createdAt:new Date(2026,9,12).toISOString(),archived:true},{createdAt:new Date(2026,9,13).toISOString()}],today);
 assert.equal(result.total,3);assert.equal(result.archived,1);assert.equal(result.activeDays,2);
 assert.equal(result.days.find(day=>day.date==='2026-10-12').count,2);
 assert.equal(result.days.at(-1).count,0);
});
test('无效与未来日期不进入活动统计，旧记录不进入年度图',()=>{
 const today=new Date(2026,9,14);
 const result=profileActivity([{createdAt:'invalid'},{createdAt:new Date(2026,9,15).toISOString()},{createdAt:new Date(2020,0,1).toISOString()}],today);
 assert.equal(result.activeDays,1);assert.equal(result.days.reduce((sum,day)=>sum+day.count,0),0);
 assert.ok(result.days.length>=365 && result.days.length<=371);
});

test('缺少记录与真实零用量区分',()=>{assert.equal(profileActivity([]).totalTokens,null);const result=profileActivity([{tokenUsage:[{at:new Date().toISOString(),totalTokens:0}]}]);assert.equal(result.totalTokens,0);assert.equal(result.peakTokens,0);});
