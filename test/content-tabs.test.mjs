import test from 'node:test';
import assert from 'node:assert/strict';
import {openContentTab,closeContentTab,CONTENT_TAB_LIMIT} from '../src/content-tabs.mjs';
test('内容标签复用、10个上限、关闭后选择相邻标签且不修改原状态',()=>{
 let state={tabs:[],activeId:null};
 for(let i=0;i<CONTENT_TAB_LIMIT;i++)state=openContentTab(state,{id:`cc:${i}`,page:'cc',title:`会话${i}`});
 const full=state;
 assert.throws(()=>openContentTab(state,{id:'overview',page:'overview'}),/10/);
 state=openContentTab(state,{id:'cc:2',page:'cc',title:'新的会话标题'});
 assert.equal(state.tabs.length,10);assert.equal(state.activeId,'cc:2');assert.equal(state.tabs[2].title,'新的会话标题');
 state=closeContentTab(state,'cc:2');assert.equal(state.activeId,'cc:3');assert.equal(state.tabs.length,9);assert.equal(full.tabs.length,10);
 state=openContentTab(state,{id:'overview',page:'overview',title:'设置'});assert.equal(state.tabs.length,10);
 state=closeContentTab(state,'cc:0');assert.equal(state.activeId,'overview');
 for(const tab of [...state.tabs])state=closeContentTab(state,tab.id);
 assert.equal(state.tabs.length,1);assert.equal(state.activeId,'overview');
 assert.equal(closeContentTab(state,'overview'),state);assert.equal(closeContentTab(state,'missing'),state);
});
