import test from 'node:test';
import assert from 'node:assert/strict';
import {DockerEnvironments,resourcePrefix} from '../../../src/features/environments/docker-environments.mjs';
const a='11111111-1111-1111-1111-111111111111',b='22222222-2222-2222-2222-222222222222';
function fixture(){
 const manager=new DockerEnvironments({directory:'/unused',sourceRoot:process.cwd(),encrypt:Buffer.from,decrypt:b=>b.toString()});
 let data={activeId:a,localEnabled:true,environments:[{id:a},{id:b}]};
 const running=new Set([resourcePrefix('owner',a)+'-worker',resourcePrefix('owner',a)+'-gateway','unrelated-container']);
 const calls=[];
 manager.load=async()=>structuredClone(data);manager.save=async(_,value)=>{data=value;};
 manager.command=async args=>{
  calls.push(args);
  if(args[0]==='ps'){if(args.includes('--filter'))return '';return args.includes('{{.Names}}')?[...running].join('\n'):[...running].map((name,i)=>'c'+i+' '+name).join('\n');}
  if(args[0]==='stop'){running.delete(args.at(-1));return '';}
  if(args[0]==='inspect')return String(running.has(args.at(-1)));
  throw new Error('unexpected command');
 };
 manager.start=async(_,id)=>{calls.push(['start',id]);running.add(resourcePrefix('owner',id)+'-worker');};
 return {manager,running,calls};
}
test('switch stops old worker and gateway before starting target and preserves unrelated containers',async()=>{
 const {manager,running,calls}=fixture();await manager.activate('owner',b);
 assert.equal((await manager.load()).activeId,b);
 assert.deepEqual([...running],['unrelated-container',resourcePrefix('owner',b)+'-worker']);
 assert.equal(calls.at(-1)[0],'start');
});
test('local selection stops all registered containers without starting any',async()=>{
 const {manager,running,calls}=fixture();await manager.activate('owner',null);
 assert.equal((await manager.load()).activeId,null);assert.deepEqual([...running],['unrelated-container']);assert.ok(!calls.some(c=>c[0]==='start'));
});
test('stop failure prevents target startup and selection',async()=>{
 const {manager,calls}=fixture();manager.command=async args=>{calls.push(args);if(args[0]==='ps')return args.includes('--filter')?'':resourcePrefix('owner',a)+'-worker';throw new Error('stop failed');};
 await assert.rejects(manager.activate('owner',b),/stop failed/);assert.equal((await manager.load()).activeId,a);assert.ok(!calls.some(c=>c[0]==='start'));
});
test('invalid selection leaves running environments untouched',async()=>{
 const {manager,calls}=fixture();await assert.rejects(manager.activate('owner','missing'));assert.equal(calls.length,0);
});
test('startup failure cleans target without persisting a successful switch',async()=>{
 const {manager}=fixture();let cleaned=false;manager.start=async()=>{throw new Error('startup failed');};manager.stop=async(_,id)=>{cleaned=id===b;};
 await assert.rejects(manager.activate('owner',b),/目标环境启动失败/);assert.equal(cleaned,true);assert.equal((await manager.load()).activeId,a);
});
test('stopped managed engine resumes existing profile without changing mounts or rebuilding',async()=>{
 const {manager,calls}=fixture();let checks=0;
 manager.get=async()=>({item:{}});manager.engineStatus=async()=>({ready:++checks>1});
 manager.binary=async()=>'/opt/homebrew/bin/colima';manager.engineProcess=async(binary,args)=>calls.push([binary,...args]);
 await manager.ensureSelectedEngine('owner',a);
 assert.deepEqual(calls,[['/opt/homebrew/bin/colima','start','dingtu','--activate=false']]);
});
test('ready engine and external environments do not restart the managed engine',async()=>{
 const {manager}=fixture();manager.engineStatus=async()=>({ready:true});manager.engineProcess=()=>assert.fail('unexpected engine start');
 manager.get=async()=>({item:{}});await manager.ensureSelectedEngine('owner',a);
 manager.get=async()=>({item:{external:{id:'external'}}});await manager.ensureSelectedEngine('owner',a);
});
