import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../../src/app/renderer.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf("$('setupFinish').onclick="),source.indexOf("$('sendContainerLoginInput').onclick="));
for(const kind of ['local','create','attach'])test(`new ${kind} environment enters directly without a switch dialog`,async()=>{
 const calls=[],elements=new Map();
 const $=id=>{if(!elements.has(id))elements.set(id,{disabled:false,value:id==='setupEnvironmentName'?'New':id==='setupDockerSource'?(kind==='attach'?'existing':'new'):'container',classList:{add(){}}});return elements.get(id);};
 const context={$,setupCreating:false,setupWizardStep:3,setupEnvironmentKind:kind==='local'?'local':'docker',setupSelectedIcon:'rocket',setupInProgress:true,setupSessionStarted:true,document:{body:{classList:{remove(){}}}},action:fn=>{context.done=fn();},environmentOperation:async action=>{assert.notEqual(action,'select','creation must not request switch confirmation');calls.push(action);return {createdId:'new-id'};},performEnvironmentOperation:async(action,value)=>calls.push([action,value.id]),refreshRuntimeRegistry:async()=>{},switchPage:page=>calls.push(page),showEnvironmentCreated:()=>{},reloadAccountChats:async()=>{},validateSetupEnvironment(){},toast(){}};
 vm.runInNewContext(handler,context);$('setupFinish').onclick();await context.done;
 assert.deepEqual(calls,[kind==='local'?'createLocal':kind,['select',kind==='local'?null:'new-id'],kind==='local'?'cc':'runtime']);
 assert.equal(context.setupInProgress,false);
});
const operation=source.slice(source.indexOf('async function environmentOperation('),source.indexOf('async function performEnvironmentOperation('));
for(const [label,state,confirm] of [
 ['no current environment',{activeId:null,localEnabled:false,environments:[{id:'target'}]},false],
 ['deleted current environment',{activeId:'missing',localEnabled:false,environments:[{id:'target'}]},false],
 ['existing local environment',{activeId:null,localEnabled:true,environments:[{id:'target'}]},true],
 ['existing container',{activeId:'old',localEnabled:false,environments:[{id:'old'},{id:'target'}]},true],
 ['same environment',{activeId:'target',localEnabled:false,environments:[{id:'target'}]},false],
])test(`menu selection from ${label} ${confirm?'requires':'skips'} confirmation`,async()=>{
 let entered=false;
 const context={dockerEnvironmentState:state,performEnvironmentOperation:async()=>{entered=true;return state;},$:()=>{throw Error('confirmation requested');}};
 vm.createContext(context);vm.runInContext(operation,context);
 if(confirm)await assert.rejects(vm.runInContext("environmentOperation('select',{id:'target'})",context),/confirmation requested/);
 else await vm.runInContext("environmentOperation('select',{id:'target'})",context);
 assert.equal(entered,!confirm);
});
