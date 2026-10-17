import {mountMessageActions} from '../../../src/features/chat/message-actions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../../../src/app/renderer.js',import.meta.url),'utf8');
test('only a newly submitted pending reply shows loading; restored empty messages do not',()=>{
 const {window}=new JSDOM('<div id="chat"></div>');
 const start=source.indexOf('function bubble('),end=source.indexOf("$('chat').addEventListener",start);
 const bubble=new Function('document','$','selectedEngine','RUNTIME_CATALOG','updateChatMessage','mountMessageActions','chatScroll={follow(){}}',source.slice(start,end)+';return bubble;')(window.document,id=>window.document.getElementById(id),'codex',{codex:{name:'Codex'}},(node,text)=>{node.dataset.rawText=text;node.textContent=text;},mountMessageActions);
 assert.equal(bubble('assistant','').classList.contains('reply-loading'),false);
 assert.equal(bubble('assistant','', 'codex',true).getAttribute('role'),'status');
 assert.equal(bubble('assistant','正文').textContent,'正文');
 assert.equal(bubble('user','你好').parentNode.querySelector('.bubble-label'),null);
});
