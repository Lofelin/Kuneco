import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('');globalThis.window=dom.window;
const {updateChatMessage}=await import('../src/chat-markdown.mjs');
test('GFM table, code, list, link and emphasis render while raw source stays unchanged',()=>{
 const node=window.document.createElement('div');const text='## 天气\n\n| 城市 | 气温 |\n|---|---:|\n|深圳|26°C|\n\n**加粗**\n\n- 项目\n\n```js\nconst x = 1;\n```\n\n[来源](https://example.com)';updateChatMessage(node,text);
 assert.equal(node.dataset.rawText,text);assert.equal(node.querySelectorAll('table tbody tr').length,1);assert.ok(node.querySelector('strong'));assert.ok(node.querySelector('pre code'));assert.ok(node.querySelector('li'));assert.equal(node.querySelector('a').rel,'noopener noreferrer');
 updateChatMessage(node,text+'\n\n下一段');assert.equal(node.querySelectorAll('table').length,1);
});
test('model-generated scripts, event handlers and javascript URLs cannot execute',()=>{
 const node=window.document.createElement('div');updateChatMessage(node,'<script>alert(1)</script><img src=x onerror=alert(1)>\n\n[bad](javascript:alert)');
 assert.equal(node.querySelector('script,img'),null);assert.equal(node.querySelector('a')?.getAttribute('href'),null);
});
