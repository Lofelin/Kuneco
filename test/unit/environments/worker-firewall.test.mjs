import test from 'node:test';import assert from 'node:assert/strict';
import {validateWorkerFirewallRules} from '../../../src/features/environments/container-reliability.mjs';
import {directTaskArguments} from '../../../src/features/environments/docker-environments.mjs';
import {networkDisplayRows} from '../../../src/features/environments/container-display-rows.mjs';
const v4=['-P OUTPUT DROP','-A OUTPUT -p udp -m udp --dport 53 -j REJECT --reject-with icmp-port-unreachable','-A OUTPUT -p tcp -m tcp --dport 53 -j REJECT --reject-with icmp-port-unreachable','-A OUTPUT -o lo -j ACCEPT','-A OUTPUT -d 172.20.0.2/32 -p tcp -m tcp --dport 8080 -j ACCEPT'].join('\n');
const v6='-P OUTPUT DROP\n-A OUTPUT -o lo -j ACCEPT',raw='-P OUTPUT ACCEPT\n-A OUTPUT -p udp -m udp --dport 53 -j DROP\n-A OUTPUT -p tcp -m tcp --dport 53 -j DROP';
test('worker requires full ordered filter and pre-DNAT DNS rules for both families',()=>{
 const valid=[v4,v6,raw.replace('-P OUTPUT ACCEPT','-P OUTPUT ACCEPT\n-A OUTPUT -d 127.0.0.11/32 -j DROP'),raw,'172.20.0.2'];validateWorkerFirewallRules(...valid);
 for(let i=0;i<4;i++)for(const changed of [valid[i].split('\n').slice(0,-1).join('\n'),valid[i]+'\n-A OUTPUT -j ACCEPT',valid[i].split('\n').reverse().join('\n')]){const input=[...valid];input[i]=changed;assert.throws(()=>validateWorkerFirewallRules(...input));}
 assert.throws(()=>validateWorkerFirewallRules(v4.replace('-o lo','-m owner --gid-owner 1001'),v6,raw,raw,'172.20.0.2'));
});
test('direct execution shares only expected environment data and has separate network/PID/tmp',()=>{
 const args=directTaskArguments({prefix:'account-env',name:'direct-task',image:'image',task:'id',command:'node'});
 assert.equal(args[args.indexOf('--network')+1],'account-env-direct-egress');assert.ok(args.includes('--rm'));assert.ok(args.includes('--init'));assert.ok(args.includes('type=volume,src=account-env-worker-work,dst=/workspace'));assert.ok(args.includes('type=volume,src=account-env-worker-home,dst=/home/node'));assert.ok(args.includes('io.kuneco.environment=account-env'));for(const flag of ['--pid','--privileged','--cap-add','--publish'])assert.ok(!args.includes(flag));assert.ok(args.includes('ALL'));assert.ok(args.includes('NO_PROXY=*'));
});
test('display never claims firewall enforcement on unknown, stopped or external containers',()=>{
 assert.match(networkDisplayRows({available:true,verified:false,running:false})[0].value,/已停止/);
 assert.match(networkDisplayRows(null)[0].value,/不能确认/);
 assert.match(networkDisplayRows(null,{external:true})[0].value,/未验证/);
});
