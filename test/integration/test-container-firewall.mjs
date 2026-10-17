import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {DockerEnvironments,workerArguments,directTaskArguments,resourcePrefix} from '../../src/features/environments/docker-environments.mjs';
import {workerImage,validateWorkerFirewall,ensureDirectNetwork} from '../../src/features/environments/container-reliability.mjs';
const m=new DockerEnvironments({sourceRoot:process.cwd()}),environmentId=randomUUID(),prefix=resourcePrefix('firewall-fixture',environmentId),network=prefix+'-private',worker=prefix+'-worker',gateway=prefix+'-gateway',peer=prefix+'-direct-peer',direct=prefix+'-direct-client';
const image=await workerImage(m,'dingtu-runtime:3-clean');
const inspect=async name=>JSON.parse(await m.command(['inspect','--format','{{json .}}',name]));
const probe=`const net=require('net');const s=net.connect(Number(process.argv[2]),process.argv[1]);s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(2));s.setTimeout(700,()=>{s.destroy();process.exit(3)});`;
const server=`require('net').createServer(s=>s.end('fixture')).listen(8080,'0.0.0.0');`;
try{
 await m.command(['network','create','--internal','--label','app=dingtu',network]);
 await ensureDirectNetwork(m,prefix);
 for(const [name,net] of [[gateway,network],[peer,prefix+'-direct-egress']])await m.command(['run','-d','--name',name,'--network',net,'--network-alias','fixture-peer','--cap-drop','ALL','--user','1000:1000','--entrypoint','node',image,'-e',server]);
 const gatewayIP=(await inspect(gateway)).NetworkSettings.Networks[network].IPAddress,peerIP=(await inspect(peer)).NetworkSettings.Networks[prefix+'-direct-egress'].IPAddress;
 await m.command(workerArguments({name:worker,network,gatewayIP,proxyURL:'http://fixture',image,spec:'firewall-test'}));
 for(let i=0;;i++){try{await validateWorkerFirewall(m,worker,await inspect(worker));break;}catch(e){if(i===20)throw e;await new Promise(r=>setTimeout(r,100));}}
 await m.command(['exec','--user','1000:1000',worker,'node','-e',probe,gatewayIP,'8080']);
 await assert.rejects(m.command(['exec','--user','1000:1000',worker,'node','-e',probe,peerIP,'8080']));
 await assert.rejects(m.command(['exec','--user','1000:1000',worker,'node','-e',probe,gatewayIP,'8081']));
 await m.command(directTaskArguments({prefix,name:direct,image,task:randomUUID(),command:'node',args:['-e',probe,'fixture-peer','8080']}));
 // Cancel before Docker has finished creating the direct execution container.
 m.get=async()=>({prefix,item:{imageName:'dingtu-runtime:3-clean'}});
 const launch=await m.directChatSpawner('fixture','fixture'),abort=new AbortController();
 const child=launch({command:'node',args:['-e','setInterval(()=>{},1000)'],signal:abort.signal});
 const ended=once(child,'close');abort.abort();await ended;
 const leftovers=await m.command(['ps','-aq','--filter','label=app=dingtu-direct','--filter','label=io.kuneco.environment='+prefix]);assert.equal(leftovers,'');
 assert.throws(()=>launch({command:'node',args:[],signal:abort.signal}),/取消/);
 // Stop/switch must invalidate old factories and clean tasks even with no live worker.
 const waitReady=child=>new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);});
 const longArgs=['-e',"process.stdout.write('ready');setInterval(()=>{},1000)"];
 const switched=launch({command:'node',args:longArgs});const switchExit=once(switched,'close');await waitReady(switched);
 const installing=m.runRuntimeInstaller('fixture','fixture',['node','-e','setInterval(()=>{},1000)']);
 const installationStopped=assert.rejects(installing,/Docker|停止或切换/);
 for(let i=0;;i++){
  if(await m.command(['ps','-q','--filter','label=app=dingtu-installer','--filter','label=io.kuneco.environment='+prefix]))break;
  if(i===50)throw Error('isolated installer did not start');await new Promise(r=>setTimeout(r,100));
 }
 m.load=async()=>({environments:[{id:environmentId}],localEnabled:true});
 const command=m.command.bind(m);let injectListingFailure=true;
 m.command=async(args,options)=>{
  if(injectListingFailure&&args[0]==='ps'&&args.includes('label=app=dingtu-direct')){injectListingFailure=false;throw Error('fixture cleanup listing failure');}
  return command(args,options);
 };
 await assert.rejects(m.stopOtherEnvironments('firewall-fixture',null),/fixture cleanup listing failure/);
 assert.throws(()=>launch({command:'node',args:[]}),/清理未完成/);
 await assert.rejects(m.directChatSpawner('fixture','fixture'),/清理未完成/);
 await m.stopOtherEnvironments('firewall-fixture',null);await switchExit;await installationStopped;
 m.command=command;
 assert.throws(()=>launch({command:'node',args:[]}),/停止或切换/);
 assert.equal(await m.command(['ps','-aq','--filter','label=io.kuneco.environment='+prefix]),'');
 // Unexpected Docker client death must not leave its daemon-side task alive.
 const relaunched=await m.directChatSpawner('fixture','fixture');
 const crashed=relaunched({command:'node',args:longArgs});const crashExit=once(crashed,'close');await waitReady(crashed);process.kill(crashed.pid,'SIGKILL');await crashExit;
 await m.stopDirectTasks(prefix);assert.equal(await m.command(['ps','-aq','--filter','label=io.kuneco.environment='+prefix]),'');
 // Re-enable only the disposable worker stopped by the switch, for the firewall assertions below.
 await m.command(['start',worker]);
 for(let i=0;;i++){try{await validateWorkerFirewall(m,worker,await inspect(worker));break;}catch(e){if(i===20)throw e;await new Promise(r=>setTimeout(r,100));}}
 // A killed attached CLI is not proof that a proxy task stopped in the worker.
 await m.command(['exec','--user','1000:1000',worker,'node','-e',"require('fs').writeFileSync('/tmp/dingtu-chat-proxy','http://fixture')"]);
 await m.command(['exec','--user','1000:1000',worker,'/usr/local/bin/node','-e',"const fs=require('fs');fs.mkdirSync('/home/node/.local/bin',{recursive:true});fs.writeFileSync('/home/node/.local/bin/node','#!/bin/sh\\necho shadowed > /home/node/node-shadow-executed\\nexit 93\\n',{mode:0o755});"]);
 const proxyLaunch=await m.spawner('fixture','fixture');
 const proxyChild=proxyLaunch({command:'/usr/local/bin/node',args:longArgs});const proxyExit=once(proxyChild,'close');await waitReady(proxyChild);
 const proxyTask=proxyChild.spawnargs[proxyChild.spawnargs.indexOf('/opt/dingtu/exec.mjs')+1];
 process.kill(proxyChild.pid,'SIGKILL');await proxyExit;
 for(let i=0;m.directTasks.has(proxyTask);i++){if(i===100)throw Error('proxy task cleanup did not finish');await new Promise(r=>setTimeout(r,100));}
 await m.command(['exec','--user','1000:1000',worker,'/usr/local/bin/node','-e',`const fs=require('fs');for(const p of ['/tmp/dingtu-${proxyTask}','/tmp/dingtu-${proxyTask}.cancel'])if(fs.existsSync(p))throw Error('residual proxy task');`]);
 await m.command(directTaskArguments({prefix,name:direct,image,task:randomUUID(),command:'/usr/local/bin/node',args:['-e','process.stdout.write("trusted wrapper")']}));
 await m.command(['exec','--user','1000:1000',worker,'/usr/local/bin/node','-e',"const fs=require('fs');if(fs.existsSync('/home/node/node-shadow-executed'))throw Error('untrusted node executed');fs.unlinkSync('/home/node/.local/bin/node');"]);
 // Raw-chain drops must precede Docker's embedded DNS translation (including IPv6 loopback).
 await m.command(['exec','--user','1000:1000',worker,'node','-e',`for(const [family,host] of [['udp4','127.0.0.1'],['udp6','::1']]){const s=require('dgram').createSocket(family);s.on('error',()=>{});s.send(Buffer.from('fixture'),53,host,()=>s.close());}`]);
 await m.command(['exec','--user','1000:1000',worker,'node','-e',`const s=require('dgram').createSocket('udp4');s.send(Buffer.from('fixture'),45678,'127.0.0.11',()=>s.close());`]);
 const resolverCounters=await m.command(['exec',worker,'iptables','-t','raw','-L','OUTPUT','-n','-v']);assert.match(resolverCounters,/\s[1-9]\d*\s+\d+\s+DROP[^\n]+127\.0\.0\.11/);
 for(const bin of ['iptables','ip6tables']){const rules=await m.command(['exec','--user','0',worker,bin,'-t','raw','-L','OUTPUT','-n','-v']);assert.match(rules,/\s[1-9]\d*\s+\d+\s+DROP\s+(?:udp|17)/);}
 // A local direct relay cannot be reached through shared localhost: distinct network/PID namespaces.
 const w=await inspect(worker);assert.deepEqual(Object.keys(w.NetworkSettings.Networks),[network]);
 await assert.rejects(m.command(['exec','--user','1000:1000',worker,'iptables','-P','OUTPUT','ACCEPT']));
 const before=await m.command(['exec',worker,'iptables','-t','raw','-S','OUTPUT']);
 await m.command(['exec',worker,'iptables','-t','raw','-D','OUTPUT','1']);
 await assert.rejects(validateWorkerFirewall(m,worker,await inspect(worker)),/规则/);
 assert.match(before,/--dport 53 -j DROP/);
 console.log(JSON.stringify({trustedTaskInterpreter:true,proxyGatewayAllowed:true,directPeerBlocked:true,otherGatewayPortBlocked:true,directTaskConnected:true,dockerDNSHighPortBlocked:true,dnsBeforeDNATBlocked:true,ipv6DNSBlocked:true,unprivilegedRulesImmutable:true,missingRuleRejected:true,switchCleanup:true,installerSwitchCleanup:true,cleanupFailureBlocksLaunch:true,cleanupRetryRecovers:true,staleLauncherRejected:true,dockerClientCrashCleaned:true,proxyClientCrashCleaned:true,directEarlyCancelCleaned:true,productionUntouched:true}));
}finally{
 await m.stopDirectTasks(prefix).catch(()=>{});
 for(const name of [worker,gateway,peer,direct])await m.command(['rm','-f',name]).catch(()=>{});
 await m.command(['network','rm',network,prefix+'-direct-egress']).catch(()=>{});
 for(const suffix of ['home','work'])await m.command(['volume','rm',worker+'-'+suffix]).catch(()=>{});
}
