import test from 'node:test';
import assert from 'node:assert/strict';
import {restoredChatStatus} from '../../../src/features/chat/chat-status.mjs';
test('restored unfinished requests and unanswered user messages display failure',()=>{
 for(const chatStatus of ['running','idle','done',undefined])assert.equal(restoredChatStatus({chatStatus,messages:[{role:'assistant',text:'old answer'},{role:'user',text:'new request'},{role:'assistant',text:'',reasoning:{text:'partial'}}]}),'failed');
});
test('completed, error, empty, and explicitly failed histories remain distinct',()=>{
 assert.equal(restoredChatStatus({messages:[{role:'user',text:'hi'},{role:'assistant',text:'hello'}]}),'done');
 assert.equal(restoredChatStatus({messages:[{role:'error',text:'timeout'}]}),'failed');
 assert.equal(restoredChatStatus({chatStatus:'failed',messages:[{role:'assistant',text:'old answer'}]}),'failed');
 assert.equal(restoredChatStatus({messages:[]}),'idle');
});
test('reasoning history restores terminal status without leaking an old turn into a new request',()=>{
 assert.equal(restoredChatStatus({chatStatus:'stopped',messages:[{role:'error',text:'cancelled'}]}),'stopped');
 for(const phase of ['waiting','thinking','process','answering','stopped'])assert.equal(restoredChatStatus({messages:[{role:'user',text:'hello'},{role:'assistant',text:'partial',reasoning:{phase}}]}),'stopped');
 assert.equal(restoredChatStatus({messages:[{role:'assistant',text:'old',reasoning:{phase:'stopped'}},{role:'user',text:'new'}]}),'failed');
});
