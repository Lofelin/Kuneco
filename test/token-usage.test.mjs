import test from 'node:test';
import assert from 'node:assert/strict';
import {totalUsageTokens} from '../src/token-usage.mjs';
test('Codex cached input is not counted twice; Claude totals include both cache types and all models',()=>{
 assert.equal(totalUsageTokens('codex',{input_tokens:100,output_tokens:20,cached_input_tokens:60}),120);
 assert.equal(totalUsageTokens('cc',{modelUsage:{a:{inputTokens:100,outputTokens:20,cacheReadInputTokens:30,cacheCreationInputTokens:40},b:{inputTokens:2,outputTokens:3,cacheReadInputTokens:0,cacheCreationInputTokens:0}}}),195);
});
test('Missing and invalid usage remains unknown rather than zero',()=>{
 for(const value of [undefined,{}, {input_tokens:-1,output_tokens:2},{input_tokens:NaN,output_tokens:2}])assert.equal(totalUsageTokens('codex',value),null);
 assert.equal(totalUsageTokens('cc',{}),null);
 assert.equal(totalUsageTokens('codex',{input_tokens:0,output_tokens:0}),0);
});
