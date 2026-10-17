import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSessionOptions} from '../src/session-options.mjs';
test('创建会话只接受所选运行时和合法模型，不修改已有会话',()=>{
 assert.deepEqual(validateSessionOptions({engine:'codex',model:'gpt-5.5'}),{engine:'codex',model:'gpt-5.5',networkMode:'proxy'});
 assert.deepEqual(validateSessionOptions({engine:'cc',model:'sonnet'}),{engine:'cc',model:'sonnet',networkMode:'proxy'});
 assert.deepEqual(validateSessionOptions({engine:'cc'}),{engine:'cc',model:null,networkMode:'proxy'});
 assert.equal(validateSessionOptions({engine:'deepseek',networkMode:'direct'}).networkMode,'direct');
 assert.equal(validateSessionOptions({engine:'cc',networkMode:'auto'}).networkMode,'auto');
 assert.throws(()=>validateSessionOptions({engine:'cc',networkMode:'unknown'}));
 for(const choice of [null,{}, {engine:'shell'},{engine:'cc',model:'--invalid flag'},{engine:'codex',model:42}])assert.throws(()=>validateSessionOptions(choice));
});
