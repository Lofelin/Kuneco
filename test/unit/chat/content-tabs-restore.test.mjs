import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {openContentTab} from '../../../src/shared/ui/content-tabs.mjs';

const source=readFileSync(new URL('../../../src/app/renderer.js',import.meta.url),'utf8');
// Exercise the scope transition before runtime/session restoration can await IPC.
const start=source.indexOf('async function restoreChats(state){');
const transition=source.slice(start,source.indexOf(' const version=++chatRestoreVersion;',start))+'}';

for(const pinned of [false,true])test(`first scope has an active chat tab before records arrive (pinned=${pinned})`,async()=>{
 const rendered=[],prompt={value:''};
 const context={contentTabsScope:null,environmentContentTabs:new Map(),contentTabState:openContentTab({tabs:[],activeId:null},{id:'cc',page:'cc',title:'对话'}),pinnedContentPages:new Set(pinned?['cc']:[]),openContentTab,$:()=>prompt,renderContentTabs(){rendered.push(context.contentTabState);}};
 vm.createContext(context);vm.runInContext(transition,context);
 await context.restoreChats({chatOwner:'account',containerId:'environment'});
 assert.equal(rendered.length,1);
 assert.equal(rendered[0].activeId,'cc');assert.equal(rendered[0].tabs.length,1);
 assert.equal(rendered[0].tabs[0].title,'对话');assert.equal(rendered[0].tabs[0].pinned,pinned);
});

test('scope switches retain cached tabs and isolate previous session and draft',async()=>{
 const oldScope=JSON.stringify(['account','old']),newScope=JSON.stringify(['account','new']);
 const previous=openContentTab({tabs:[],activeId:null},{id:'old-chat',page:'cc',sessionId:'private-session',draft:'old draft'});
 const prompt={value:'updated draft'},context={contentTabsScope:oldScope,environmentContentTabs:new Map(),contentTabState:previous,pinnedContentPages:new Set(),openContentTab,$:()=>prompt,renderContentTabs(){}};
 vm.createContext(context);vm.runInContext(transition,context);
 await context.restoreChats({chatOwner:'account',containerId:'new'});
 assert.equal(context.environmentContentTabs.get(oldScope),previous);
 assert.equal(previous.tabs[0].draft,'updated draft');assert.equal(prompt.value,'');
 assert.equal(context.contentTabState.activeId,'cc');
 assert.equal(context.contentTabState.tabs[0].sessionId,undefined);assert.equal(context.contentTabState.tabs[0].draft,undefined);
 const fresh=context.contentTabState;
 await context.restoreChats({chatOwner:'account',containerId:'old'});
 assert.equal(context.contentTabState,previous);assert.equal(context.environmentContentTabs.get(newScope),fresh);
});
