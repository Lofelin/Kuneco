import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {mountMemoryFilterMenu} from '../../../src/features/memory/memory-filter-menu.mjs';
test('cascading memory facets combine, count matching alternatives and reset without recreating submenu items',()=>{
 const {window}=new JSDOM('<wa-dropdown><app-button><span>筛选</span></app-button></wa-dropdown>'),menu=window.document.querySelector('wa-dropdown');let changes=0;const filter=mountMemoryFilterMenu(menu,{onChange:()=>changes++});
 const rows=[{type:'fact',origin:'automatic',enabled:true},{type:'fact',origin:'automatic',manualProtected:true,enabled:false},{type:'decision',origin:'manual',enabled:true}];filter.update(rows);
 const select=value=>{const item=menu.querySelector('[data-memory-filter="'+value+'"]');menu.dispatchEvent(new window.CustomEvent('wa-select',{detail:{item},cancelable:true}));return item;};
 const item=select('type:fact');assert.equal(rows.filter(filter.matches).length,2);assert.equal(item.checked,true);assert.equal(menu.querySelector('[data-memory-filter="source:manual"] [slot=details]').textContent,'1');
 select('source:manual');assert.equal(rows.filter(filter.matches).length,1);assert.equal(menu.querySelector('[data-memory-filter="enabled:disabled"] [slot=details]').textContent,'1');
 filter.update(rows);assert.equal(menu.querySelector('[data-memory-filter="type:fact"]'),item);
 select('source:manual');assert.equal(rows.filter(filter.matches).length,2);filter.reset();assert.equal(rows.filter(filter.matches).length,3);assert.equal(filter.active,false);assert.equal(changes,3);
});

test('selected facet values stay visible in the menu and removable summary conditions',()=>{
 const {window}=new JSDOM('<wa-dropdown><app-button><span>筛选</span></app-button></wa-dropdown><div id="summary"></div>'),menu=window.document.querySelector('wa-dropdown'),summary=window.document.getElementById('summary');let changes=0;const filters=mountMemoryFilterMenu(menu,{summary,onChange:()=>changes++});
 const select=value=>menu.dispatchEvent(new window.CustomEvent('wa-select',{detail:{item:menu.querySelector('[data-memory-filter="'+value+'"]')},cancelable:true}));
 select('type:fact');select('enabled:disabled');select('source:manual');assert.equal(summary.children.length,3);assert.match(summary.textContent,/类型：事实/);assert.match(summary.textContent,/状态：已停用/);assert.match(summary.textContent,/来源：手动维护/);assert.equal(menu.querySelector('[data-filter-selected=type]').textContent,'事实');assert.equal(menu.querySelectorAll('[data-filter-active]').length,3);
 summary.querySelector('[data-clear-memory-filter=type]').click();assert.equal(summary.children.length,2);assert.equal(menu.querySelector('[data-filter-selected=type]').textContent,'未筛选');assert.equal(menu.querySelector('[data-memory-filter="enabled:disabled"]').checked,true);assert.equal(changes,4);
});
