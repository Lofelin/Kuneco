// Disposable small-load fixture only. This measures shared-engine contention,
// not peak CLI memory or real upstream proxy throughput. No volumes or production mutations.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DockerEnvironments} from '../../src/features/environments/docker-environments.mjs';
import {TaskCapacity} from '../../src/features/environments/task-capacity.mjs';
const m=new DockerEnvironments({sourceRoot:process.cwd()}),tag='kuneco-capacity-'+randomUUID();
const command=m.command.bind(m),ids=[],leases=[],capacity=new TaskCapacity();
const start=async(suffix,code,memory)=>{
 const id=(await command(['run','-d','--name',tag+'-'+suffix,'--label','app=kuneco-capacity-fixture','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','0.25','--memory',memory,'--entrypoint','/usr/local/bin/node','dingtu-runtime:3-clean','-e',code])).trim();ids.push(id);return id;
};
const load=`const a=Buffer.alloc(24*1024*1024,1);setInterval(()=>{let n=0;for(let i=0;i<a.length;i+=64)n+=a[i];},40);`;
try{
 const memory=Number((await command(['info','--format','{{.MemTotal}}'])).trim());
 const gateway=await start('gateway',`require('node:http').createServer((q,s)=>s.end('ok')).listen(8080,'127.0.0.1');`,'256m');
 leases.push(capacity.reserve());const first=await start('task-a',load,'2g');
 leases.push(capacity.reserve());await start('task-b',load,'2g');
 assert.throws(()=>capacity.reserve(),{code:'CONTAINER_TASK_CAPACITY'});
 const probe=`(async()=>{let times=[];for(let i=0;i<30;i++){const t=performance.now();const r=await fetch('http://127.0.0.1:8080',{signal:AbortSignal.timeout(3000)});if(await r.text()!=='ok')throw Error('probe');times.push(performance.now()-t);await new Promise(r=>setTimeout(r,200));}console.log(JSON.stringify(times));})().catch(e=>{console.error(e);process.exit(1)});`;
 const times=JSON.parse(await command(['exec',gateway,'/usr/local/bin/node','-e',probe],{timeout:20000}));
 const stats=(await command(['stats','--no-stream','--format','{{json .}}',...ids])).trim().split('\n').map(JSON.parse).map(({Name,MemUsage,CPUPerc,PIDs})=>({name:Name,memory:MemUsage,cpu:CPUPerc,pids:PIDs}));
 await command(['rm','-f',first]);assert.equal((await command(['ps','-aq','--filter','id='+first])).trim(),'');leases[0]();
 leases.push(capacity.reserve());const replacement=await start('task-c',load,'2g');assert.ok(replacement);
 times.sort((a,b)=>a-b);
 console.log(JSON.stringify({engineMemoryBytes:memory,activeLimit:2,taskMemoryLimitBytes:2*1024**3,samples:times.length,probeErrors:0,p50Ms:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],busyRejected:true,cancelThenAdmit:true,stats,limitations:'Small 24 MiB per task fixture. Not a peak memory guarantee or real upstream proxy benchmark.',volumesUsed:false},null,2));
}finally{
 for(const id of ids)await command(['rm','-f',id]).catch(()=>{});
 for(const release of leases)release();
 const remaining=(await command(['ps','-aq','--filter','name='+tag])).trim();
 assert.equal(remaining,'','fixture containers must be removed');
}
