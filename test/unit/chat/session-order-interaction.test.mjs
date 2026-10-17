import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountSessionOrder} from '../../../src/features/chat/session-order.mjs';
function harness(){
 const {window}=new JSDOM('<div id="list"></div>',{url:'https://kuneco.test'}),doc=window.document;
 globalThis.document=doc;globalThis.CSS={escape:value=>value};
 let current={owner:'account-a',environmentId:'env-a'},renders=0;
 const items=[{id:'a',pinned:true,updatedAt:'2026-01-03'},{id:'b',pinned:true,updatedAt:'2026-01-02'},{id:'c',pinned:true,updatedAt:'2026-01-01'}];
 const order=mountSessionOrder({scope:()=>current,items:()=>items,storage:window.localStorage,render:()=>{renders++;}});
 for(const item of items){const button=doc.createElement('app-button');button.dataset.sessionId=item.id;doc.querySelector('#list').append(button);order.bind(button,item);}
 const row=id=>doc.querySelector(`[data-session-id="${id}"]`);
 const pointer=(target,type,y)=>target.dispatchEvent(new window.MouseEvent(type,{bubbles:true,composed:true,button:0,clientX:10,clientY:y}));
 const begin=(from,to)=>{pointer(row(from),'pointerdown',10);pointer(row(to),'pointermove',50);};
 const end=to=>pointer(row(to),'pointerup',50);
 return {window,order,row,begin,end,setScope:value=>{current=value;},get renders(){return renders;}};
}
test('pointer dragging downward changes pinned order and clears visual drag state',()=>{
 const h=harness();h.begin('a','b');assert.equal(h.row('a').classList.contains('session-dragging'),true);assert.equal(h.row('b').classList.contains('session-drop-target'),true);h.end('b');assert.deepEqual(h.order.sort().map(x=>x.id),['b','a','c']);assert.equal(h.renders,1);assert.equal(h.row('a').classList.contains('session-dragging'),false);assert.equal(h.row('b').classList.contains('session-drop-target'),false);h.window.close();
});
test('pointer dragging upward inserts before target and suppresses accidental conversation click',()=>{
 const h=harness();let activated=0;h.row('c').addEventListener('click',()=>activated++);h.begin('c','a');h.end('a');h.row('c').click();assert.equal(activated,0);assert.deepEqual(h.order.sort().map(x=>x.id),['c','a','b']);h.window.close();
});
test('changing account or environment while dragging never writes ordering into either scope',()=>{
 for(const next of [{owner:'account-b',environmentId:'env-a'},{owner:'account-a',environmentId:'env-b'}]){
  const h=harness();h.begin('c','a');h.setScope(next);h.end('a');assert.equal(h.window.localStorage.length,0);assert.equal(h.renders,0);h.window.close();
 }
});
test('saved order stays isolated between accounts and environments',()=>{
 const h=harness();h.begin('c','a');h.end('a');assert.deepEqual(h.order.sort().map(x=>x.id),['c','a','b']);
 h.setScope({owner:'account-b',environmentId:'env-a'});assert.deepEqual(h.order.sort().map(x=>x.id),['a','b','c']);
 h.setScope({owner:'account-a',environmentId:'env-b'});assert.deepEqual(h.order.sort().map(x=>x.id),['a','b','c']);
 h.setScope({owner:'account-a',environmentId:'env-a'});assert.deepEqual(h.order.sort().map(x=>x.id),['c','a','b']);h.window.close();
});
