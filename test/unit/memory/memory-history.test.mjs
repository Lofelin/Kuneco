import test from 'node:test';import assert from 'node:assert/strict';
import {historicalMemoryTurns,unprocessedHistory} from '../../../src/features/memory/memory-history.mjs';
const session={id:'chat',environmentId:'dev',engine:'codex',networkMode:'direct',createdAt:'2026-01-01T00:00:00Z'};
const pair=[{role:'user',text:'以后使用中文'},{role:'assistant',text:'好的',fileChangeTurnId:'live-turn',reasoning:{phase:'completed'}}];
test('historical extraction respects environment, running chats, completion and original turn identity',()=>{
 const view={id:'chat',chatStatus:'stopped',messages:[...pair,{role:'user',text:'未完成请求'},{role:'assistant',text:'半截',reasoning:{phase:'stopped'}}]};
 const turns=historicalMemoryTurns([session],[view],{environmentId:'dev'});assert.equal(turns.length,1);assert.equal(turns[0].turnId,'live-turn');assert.equal(turns[0].userText,'以后使用中文');assert.equal(turns[0].networkMode,'direct');
 assert.equal(historicalMemoryTurns([session],[view],{environmentId:'other'}).length,0);assert.equal(historicalMemoryTurns([session],[view],{environmentId:'dev',running:new Set(['chat'])}).length,0);
 assert.equal(unprocessedHistory(turns,[{source:{chatId:'chat',turnId:'live-turn'},status:'completed'}]).length,0);
 assert.equal(unprocessedHistory(turns,[{source:{chatId:'chat',turnId:'live-turn'},status:'failed'}]).length,0);
});
test('legacy turns have deterministic identities, failed and unanswered turns are excluded',()=>{
 const view={id:'chat',chatStatus:'done',messages:[{role:'user',text:'记住发布前检查'},{role:'assistant',text:'收到'},{role:'user',text:'失败'},{role:'error',text:'失败'},{role:'user',text:'尚未回复'}]};
 const a=historicalMemoryTurns([session],[view],{environmentId:'dev'}),b=historicalMemoryTurns([session],[view],{environmentId:'dev'});assert.equal(a.length,1);assert.deepEqual(a,b);assert.match(a[0].turnId,/^history:/);assert.equal(unprocessedHistory(a,[{source:a[0]}]).length,0);
});
