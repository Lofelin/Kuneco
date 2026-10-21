import {consoleShortcutAction} from '../../../src/shared/console-shortcuts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {consoleOptions,consoleDefaults} from '../../../src/shared/console-preferences.mjs';

async function fixture(close=async()=>true){
 const nodes={containerTerminal:{style:{},replaceChildren(){}},consoleStatus:{textContent:''},consoleConnect:{},consoleConnectLabel:{},'page-console':{classList:{contains:()=>false}}};
 class Terminal {constructor(options){this.options=options;this.cols=80;this.rows=24;this.parser={registerOscHandler(){}};}attachCustomKeyEventHandler(handler){this.keyHandler=handler;}loadAddon(){}open(host){host.terminal=this;}onData(){}onResize(){}focus(){}dispose(){}reset(){}write(){}}
 const inputs=[];Terminal.prototype.input=function(data){inputs.push(data);};
 const opened=[];const api={async console(action,value){if(action==='status')return{available:true,id:'fixture'};if(action==='close')return close(value);if(action==='open'){opened.push(value);return{token:'token-'+opened.length};}},onEvent(){}};
 const sandbox={consoleShortcutAction,consoleOptions,consoleDefaults,mountConsolePaste:()=>({cancel(){}}),MutationObserver:class{observe(){}},document:{body:{classList:{contains:()=>false}},addEventListener(){},getElementById:id=>nodes[id]},window:{addEventListener(){}},Terminal,FitAddon:class{fit(){}},WebLinksAddon:class{},ResizeObserver:class{observe(){}},TextEncoder,URL};
 const source=(await readFile(new URL('../../../src/features/terminal/console-ui.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export function mountConsole','function mountConsole');
 vm.runInNewContext(source+'\nglobalThis.mount=mountConsole;',sandbox);
 return{view:sandbox.mount(api),nodes,opened,inputs,key:event=>nodes.containerTerminal.terminal.keyHandler(event)};
}
test('console reconnect does not forward the close IPC result as a login engine',async()=>{
 const {view,nodes,opened}=await fixture();await view.show();await nodes.consoleConnect.onclick();
 assert.equal(opened.length,2);assert.equal(opened[1].loginEngine,undefined);assert.equal(nodes.consoleConnect.disabled,false);
});
test('closing a console tab during reconnect prevents the delayed reopen',async()=>{
 let release;const {view,nodes,opened}=await fixture(()=>new Promise(resolve=>{release=resolve;}));await view.show();
 const reconnect=nodes.consoleConnect.onclick();view.reset();release(true);await reconnect;
 assert.equal(opened.length,1);assert.equal(nodes.consoleStatus.textContent,'');
});

test('Space is emitted once per keydown and preserves modified and composing keys',async()=>{
 const {view,inputs,key}=await fixture();await view.show();let prevented=0;
 const event={key:' ',type:'keydown',preventDefault(){prevented++;}};
 assert.equal(key(event),false);assert.equal(key({...event,repeat:true}),false);
 assert.equal(key({...event,type:'keypress'}),false);assert.equal(key({...event,type:'keyup'}),false);
 assert.deepEqual(inputs,[' ',' ']);assert.equal(prevented,2);
 for(const modifier of ['ctrlKey','altKey','metaKey','isComposing'])assert.equal(key({...event,[modifier]:true}),true);
 assert.equal(key({...event,key:'Enter'}),true);
});

test('configured terminal actions run once and do not leak to the shell',async()=>{
 const {view,nodes,inputs,key}=await fixture();await view.show();let cleared=0;nodes.containerTerminal.terminal.clear=()=>cleared++;
 const event={key:'k',code:'KeyK',ctrlKey:true,type:'keydown',preventDefault(){}};
 assert.equal(key(event),false);assert.equal(key({...event,type:'keyup'}),false);assert.equal(cleared,1);
 assert.equal(key({...event,key:'c',code:'KeyC'}),false);assert.deepEqual(inputs,['\x03']);
 assert.equal(key({...event,isComposing:true}),true);
});
