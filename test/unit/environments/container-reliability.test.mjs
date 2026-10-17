import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureWorker,containerStatus,SPEC_LABEL,reliabilityArguments,ATTEMPT_LABEL} from '../../../src/features/environments/container-reliability.mjs';
const raw='-P OUTPUT ACCEPT\n-A OUTPUT -p udp -m udp --dport 53 -j DROP\n-A OUTPUT -p tcp -m tcp --dport 53 -j DROP';
const v6='-P OUTPUT DROP\n-A OUTPUT -o lo -j ACCEPT';
const v4='-P OUTPUT DROP\n-A OUTPUT -p udp -m udp --dport 53 -j REJECT --reject-with icmp-port-unreachable\n-A OUTPUT -p tcp -m tcp --dport 53 -j REJECT --reject-with icmp-port-unreachable\n-A OUTPUT -o lo -j ACCEPT\n-A OUTPUT -d 172.20.0.2/32 -p tcp -m tcp --dport 8080 -j ACCEPT';
const name='owned-worker',image='new-image',spec='new-spec';
const args=['run','-d','--network','private','--name',name,'--mount','type=volume,src=owned-worker-home,dst=/home/node',image];
function fixture({same=false,running=true,failRun=false,cancelAt,extraMount=false}={}){
 let current=true,ready=0,replacement=null;const calls=[];
 const old={NetworkSettings:{Networks:{private:{}}},Config:{Env:['DINGTU_GATEWAY_IP=172.20.0.2'],Image:same?image:'old',Labels:{app:'dingtu',[SPEC_LABEL]:same?spec:'old'}},State:{Running:running},Mounts:[{Type:'volume',Name:extraMount?'owned-worker-home-old':'owned-worker-home',Destination:'/home/node',RW:true}]};
 const manager={command:async a=>{calls.push(a);if(a[0]==='run'){const label=a.find(v=>v.startsWith(ATTEMPT_LABEL+'='));replacement={...old,Id:'attempt-id',Config:{...old.Config,Labels:{[ATTEMPT_LABEL]:label.slice(ATTEMPT_LABEL.length+1)}}};}if(a[0]===cancelAt)current=false;if(a.includes('{{json .}}'))return JSON.stringify(replacement || old);if(a.includes('{{json .State}}'))return JSON.stringify({Running:true});if(a[0]==='exec'&&a.includes('/usr/bin/test')&&++ready===1)throw Error('not ready yet');if(a.includes('-S'))return a.includes('raw')?(a.includes('/usr/sbin/ip6tables')?raw:raw.replace('-P OUTPUT ACCEPT','-P OUTPUT ACCEPT\n-A OUTPUT -d 127.0.0.11/32 -j DROP')):a.includes('/usr/sbin/ip6tables')?v6:v4;if(a[0]==='run'&&failRun)throw Error('run failed');return '';}};
 return {manager,calls,options:{name,image,spec,args,assertCurrent:()=>{if(!current)throw Error('cancelled');}}};
}
test('worker upgrade retains exact volumes and removes backup only after readiness',async()=>{
 const f=fixture();await ensureWorker(f.manager,f.options);
 assert.ok(f.calls.findIndex(a=>a[0]==='rm')>f.calls.findIndex(a=>a[0]==='exec'));
 assert.ok(f.calls.some(a=>a[0]==='run'&&a.includes(image)&&a.includes('type=volume,src=owned-worker-home,dst=/home/node')));assert.ok(!f.calls.flat().includes('-v'));
});
test('same-spec reconnect keeps running worker and never recreates it',async()=>{
 const f=fixture({same:true});await ensureWorker(f.manager,f.options);assert.ok(!f.calls.some(a=>['run','stop','rm','start'].includes(a[0])));
});
test('same-spec stopped worker waits for firewall initialization after start',async()=>{
 const f=fixture({same:true,running:false});await ensureWorker(f.manager,f.options);assert.equal(f.calls.filter(a=>a[0]==='start').length,1);assert.equal(f.calls.filter(a=>a[0]==='exec'&&a.includes('/usr/bin/test')).length,2);
});
test('failed replacement restores previous container without deleting any volume',async()=>{
 const f=fixture({failRun:true});await assert.rejects(ensureWorker(f.manager,f.options),/run failed/);
 assert.deepEqual(f.calls.slice(-2).map(a=>a[0]),['rename','start']);assert.ok(!f.calls.flat().includes('-v'));
});
test('cancelled replacement restores name but never restarts an obsolete environment',async()=>{
 const f=fixture({cancelAt:'run'});await assert.rejects(ensureWorker(f.manager,f.options),/cancelled/);
 assert.equal(f.calls.at(-1)[0],'rename');assert.ok(!f.calls.some(a=>a[0]==='start'));
});
test('mount prefixes cannot pass exact data preservation check',async()=>{
 const f=fixture({extraMount:true});await assert.rejects(ensureWorker(f.manager,f.options),/挂载/);assert.ok(!f.calls.some(a=>a[0]==='stop'));
});
test('diagnostics distinguish OOM, failed exit, initializing, unhealthy and unknown',()=>{
 assert.equal(containerStatus(null).statusText,'状态不可读取');assert.equal(containerStatus({OOMKilled:true,ExitCode:137}).statusText,'内存不足退出');assert.match(containerStatus({ExitCode:1}).statusText,/异常退出/);assert.equal(containerStatus({Running:true,Health:{Status:'starting'}}).statusText,'正在初始化');assert.equal(containerStatus({Running:true,Health:{Status:'unhealthy'}}).statusText,'容器自检失败');
 assert.ok(reliabilityArguments.includes('--init'));assert.ok(reliabilityArguments.includes('max-size=10m'));assert.ok(!reliabilityArguments.includes('--restart'));
});

test('concurrent worker preparations are serialized and stale waiter cannot mutate',async()=>{
 const f=fixture({same:true});let release;const paused=new Promise(r=>release=r),original=f.manager.command;let entered;
 const started=new Promise(r=>entered=r);f.manager.command=async a=>{if(a.includes('{{json .}}')){entered();await paused;}return original(a);};
 const one=ensureWorker(f.manager,f.options);await started;let valid=true;
 const two=ensureWorker(f.manager,{...f.options,assertCurrent:()=>{if(!valid)throw Error('cancelled waiter');}});const rejected=assert.rejects(two,/cancelled waiter/);valid=false;release();await one;await rejected;
 assert.equal(f.calls.filter(a=>a.includes('{{json .}}')).length,2);
});
for(const stage of ['inspect','stop','rename','start'])test(`worker invalidation during ${stage} prevents subsequent startup`,async()=>{
 const f=fixture({same:stage==='start',running:stage!=='start',cancelAt:stage});
 await assert.rejects(ensureWorker(f.manager,f.options),/cancelled/);
 assert.ok(!f.calls.some(a=>a[0]==='run'));
 if(stage!=='start')assert.ok(!f.calls.some(a=>a[0]==='start'));
});

for(const same of [false,true])test(`missing required mount blocks ${same?'reuse':'upgrade'} before mutations`,async()=>{
 const f=fixture({same});const original=f.manager.command;
 f.manager.command=async a=>{const value=await original(a);if(a.includes('{{json .}}')){const old=JSON.parse(value);old.Mounts=[];return JSON.stringify(old);}return value;};
 await assert.rejects(ensureWorker(f.manager,f.options),/挂载/);
 assert.ok(!f.calls.some(a=>['run','stop','rename','rm','start'].includes(a[0])));
});
