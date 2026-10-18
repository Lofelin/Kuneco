import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../../src/app/renderer.js',import.meta.url),'utf8');
const body=source.match(/archive.onclick=\(\)=>void action\(async\(\)=>\{([\s\S]*?)\}\);const pin/)[1];
function setup(api){const item={id:'chat',archived:false},pendingArchives=new Set(),frames=[];const run=new Function('api','item','pendingArchives','chatRuns','renderSessionList','chatOwnerID',`return (async()=>{${body}})()`);return {item,frames,run:()=>run(api,item,pendingArchives,new Set(),()=>frames.push(item.archived),'owner')};}
test('archive updates before slow persistence and ignores duplicate clicks',async()=>{let finish,calls=0;const t=setup({archiveSession:()=>{calls++;return new Promise(r=>finish=r)}});const pending=t.run();assert.equal(t.item.archived,true);assert.deepEqual(t.frames,[true]);await t.run();assert.equal(calls,1);finish();await pending;});
test('failed archive reconciles with authoritative state',async()=>{const t=setup({archiveSession:async()=>{throw Error('failed')},state:async()=>({aiSessions:[{id:'chat',archived:false}]})});await assert.rejects(t.run(),/failed/);assert.equal(t.item.archived,false);});
