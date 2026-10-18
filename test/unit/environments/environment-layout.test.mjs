import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountEnvironmentLayout} from '../../../src/features/environments/environment-layout.mjs';
function fixture(local=false){
 const dom=new JSDOM('<div id="header"><div class="environment-identity"><h2>环境</h2><div id="metadata"><div>image</div></div></div></div><div id="details"><dl class="environment-inline-facts"><div>facts</div></dl>'+(local?'':'<section class="environment-reliability environment-network">network</section><section class="environment-reliability"><app-table>status</app-table></section>')+'<div class="environment-inline-runtimes"><app-table>runtime</app-table></div></div>');const doc=dom.window.document;
 return {dom,doc,args:{header:doc.getElementById('header'),details:doc.getElementById('details'),metadata:doc.getElementById('metadata'),local,scope:'owner/container'}};
}
test('environment tabs retain original tables, facts and metadata nodes',()=>{
 const {doc,args}=fixture(),tables=[...doc.querySelectorAll('app-table')],metadata=args.metadata;
 const tabs=mountEnvironmentLayout(args);assert.deepEqual([...tabs.querySelectorAll('wa-tab')].map(t=>t.panel),['overview','network','status','runtimes']);assert.equal(tabs.active,'overview');assert.equal(doc.querySelector('.environment-overview-main #metadata'),metadata);assert.deepEqual([...doc.querySelectorAll('app-table')],tables);assert.equal(doc.querySelector('.environment-overview-aside .environment-inline-facts').textContent,'facts');
});
test('active panel survives refresh only in the same environment; local excludes container panels',()=>{
 const first=fixture();const tabs=mountEnvironmentLayout(first.args);tabs.dispatchEvent(new first.dom.window.CustomEvent('wa-tab-show',{detail:{name:'status'}}));const refresh=fixture();assert.equal(mountEnvironmentLayout(refresh.args).active,'status');const other=fixture(true);other.args.scope='owner/local';const local=mountEnvironmentLayout(other.args);assert.equal(local.active,'overview');assert.deepEqual([...local.querySelectorAll('wa-tab')].map(t=>t.panel),['overview','runtimes']);
});
