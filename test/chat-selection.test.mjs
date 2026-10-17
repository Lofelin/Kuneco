import test from 'node:test';import assert from 'node:assert/strict';
import {restoredChat} from '../src/chat-selection.mjs';
test('restore last viewed chat independently of creation order and environment',()=>{
 const sessions=[{id:'new',createdAt:'2026-10-15',environmentId:null},{id:'older',lastViewedAt:'2026-10-14T12:00:00Z',environmentId:null},{id:'container',lastViewedAt:'2026-10-15T12:00:00Z',environmentId:'docker'}];
 assert.equal(restoredChat(sessions,{activeId:'new'}).id,'older');assert.equal(restoredChat(sessions,{environmentId:'docker'}).id,'container');assert.equal(restoredChat(sessions,{environmentId:'missing'}),null);
});
test('legacy active chat is preserved but archived last-viewed chats are skipped',()=>{
 assert.equal(restoredChat([{id:'first'},{id:'last'}],{activeId:'last'}).id,'last');
 assert.equal(restoredChat([{id:'regular'},{id:'archive',archived:true,lastViewedAt:'2026-10-15'}]).id,'regular');
 assert.equal(restoredChat([{id:'a',lastViewedAt:'2026-10-15'},{id:'b',lastViewedAt:'2026-10-15'}],{activeId:'b'}).id,'b');
});

test('archived active chat never overrides unarchived selection and all archived returns blank',()=>{
 const archived={id:'archive',archived:true,lastViewedAt:'2026-10-16',environmentId:'docker'};
 const regular={id:'regular',environmentId:'docker'};
 assert.equal(restoredChat([archived,regular],{environmentId:'docker',activeId:'archive'}).id,'regular');
 assert.equal(restoredChat([archived],{environmentId:'docker',activeId:'archive'}),null);
 assert.equal(restoredChat([archived,{id:'other',environmentId:'elsewhere'}],{environmentId:'docker'}),null);
});
