import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountEnvironmentLogs} from '../../../src/features/environments/environment-logs-ui.mjs';
test('dialog stops subscriptions, rejects stale deliveries, and clear only clears display',async()=>{
 const dom=new JSDOM('<app-button id="viewEnvironmentLogs"></app-button>');const previous=globalThis.document;globalThis.document=dom.window.document;
 const calls=[];let listener,current={owner:'a',id:'one'};
 const api={onEvent:f=>{listener=f;},dockerEnvironments:async(action,value)=>{calls.push({action,value});return {};}};
 try{
  mountEnvironmentLogs({api,scope:()=>({...current})});
  const doc=dom.window.document,dialog=doc.querySelector('app-dialog'),open=()=>doc.querySelector('#viewEnvironmentLogs').click();
  const send=(token,data)=>listener({type:'environmentLogs',data:{token,...data}});
  open();const first=calls.at(-1).value.token;
  send(first,{entries:[{sequence:1,time:'2026-10-18T00:00:00Z',source:'worker',level:'INFO',message:'first'}]});
  assert.equal(dialog.querySelectorAll('.environment-log-row').length,1);
  dialog.querySelector('[data-clear]').click();assert.equal(dialog.querySelectorAll('.environment-log-row').length,0);
  send(first,{entries:[{sequence:2,time:'2026-10-18T00:00:01Z',source:'worker',level:'INFO',message:'new'}]});
  assert.equal(dialog.querySelectorAll('.environment-log-row').length,1);assert.match(dialog.querySelector('.environment-log-message').textContent,/new/);
  dialog.dispatchEvent(new dom.window.Event('wa-hide'));assert.equal(calls.at(-1).action,'logsStop');
  open();const second=calls.at(-1).value.token;assert.notEqual(first,second);
  send(first,{entries:[{sequence:3,message:'stale',level:'INFO',source:'worker',time:''}]});assert.equal(dialog.querySelectorAll('.environment-log-row').length,0);
  current={owner:'a',id:'two'};send(second,{entries:[]});assert.equal(dialog.open,false);assert.equal(calls.at(-1).value.token,second);assert.equal(calls.at(-1).action,'logsStop');
 }finally{globalThis.document=previous;dom.window.close();}
});
test('history follows latest after async layout, preserves manual scroll, and resets on reopen',async()=>{
 const dom=new JSDOM('<app-button id="viewEnvironmentLogs"></app-button>'),previous=globalThis.document;globalThis.document=dom.window.document;
 let listener,token,height=0,release;
 const api={onEvent:f=>listener=f,dockerEnvironments:async(action,value)=>{if(action==='logsStart')token=value.token;}};
 const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
 try{
  mountEnvironmentLogs({api,scope:()=>({owner:'a',id:'one'})});
  const doc=dom.window.document,dialog=doc.querySelector('app-dialog'),output=dialog.querySelector('.environment-log-output');
  Object.defineProperties(output,{scrollHeight:{get:()=>height},clientHeight:{get:()=>100}});
  dialog.updateComplete=new Promise(resolve=>release=resolve);
  const open=()=>doc.querySelector('#viewEnvironmentLogs').click();
  const send=sequence=>listener({type:'environmentLogs',data:{token,entries:[{sequence,time:String(sequence),source:'worker',level:'INFO',message:'line'}]}});
  open();send(1);height=1000;release();await pause();assert.equal(output.scrollTop,1000);
  output.scrollTop=100;output.dispatchEvent(new dom.window.Event('scroll'));height=1100;send(2);await pause();assert.equal(output.scrollTop,100);
  dialog.querySelector('[data-latest]').click();await pause();assert.equal(output.scrollTop,1100);
  height=1200;send(3);await pause();assert.equal(output.scrollTop,1200);
  dialog.dispatchEvent(new dom.window.Event('wa-hide'));open();height=1400;send(4);await pause();assert.equal(output.scrollTop,1400);
  dialog.dispatchEvent(new dom.window.Event('wa-hide'));
 }finally{globalThis.document=previous;dom.window.close();}
});
test('all history remains searchable beyond the rendered batch',async()=>{
 const dom=new JSDOM('<app-button id="viewEnvironmentLogs"></app-button>'),previous=globalThis.document;globalThis.document=dom.window.document;let listener,token;
 try{
  mountEnvironmentLogs({api:{onEvent:f=>listener=f,dockerEnvironments:async(action,value)=>{if(action==='logsStart')token=value.token;}},scope:()=>({owner:'a',id:'one'})});const doc=dom.window.document;doc.querySelector('#viewEnvironmentLogs').click();
  listener({type:'environmentLogs',data:{token,entries:Array.from({length:1201},(_,i)=>({sequence:i,time:String(i).padStart(4,'0'),source:'worker',level:'INFO',message:i===0?'oldest unique log':'line '+i}))}});
  assert.equal(doc.querySelectorAll('.environment-log-row').length,300);assert.match(doc.querySelector('[data-count]').textContent,/共 1201 行/);doc.querySelector('[data-more]').click();assert.equal(doc.querySelectorAll('.environment-log-row').length,600);
  const search=doc.querySelector('[data-search]');search.value='oldest unique log';search.dispatchEvent(new dom.window.Event('input'));assert.equal(doc.querySelectorAll('.environment-log-row').length,1);assert.match(doc.querySelector('.environment-log-message').textContent,/oldest unique log/);doc.querySelector('app-dialog').dispatchEvent(new dom.window.Event('wa-hide'));
 }finally{globalThis.document=previous;dom.window.close();}
});
