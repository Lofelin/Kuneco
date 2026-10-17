import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDirectFirewallRules} from '../../../src/features/environments/container-reliability.mjs';
const base='-P OUTPUT DROP\n-A OUTPUT -m owner --gid-owner 1001 -j ACCEPT\n-A OUTPUT -o lo -j ACCEPT';
test('explicit direct GID is compatible while unrestricted proxy egress is rejected',()=>{
 validateDirectFirewallRules(base+'\n-A OUTPUT -d 172.20.0.2/32 -p tcp -m tcp --dport 8080 -j ACCEPT',base,'172.20.0.2');
 for(const bad of [base.replace('DROP','ACCEPT'),base+'\n-A OUTPUT -j ACCEPT',base.replace('1001','1000'),base+'\n-A OUTPUT -d 1.1.1.1/32 -j ACCEPT'])assert.throws(()=>validateDirectFirewallRules(bad,base,'172.20.0.2'));
 assert.throws(()=>validateDirectFirewallRules(base,base+'\n-A OUTPUT -j ACCEPT','172.20.0.2'));
});
