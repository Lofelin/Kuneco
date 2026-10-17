import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DockerEnvironments,resourcePrefix} from '../../../src/features/environments/docker-environments.mjs';
test('container picker resolves current account managed and attached environments, keeping unassociated containers',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'kuneco-container-labels-')),owner='owner',id='183494cd-1b80-4886-a620-4956f9535772';
 const rows=[{ID:'a'.repeat(64),Names:resourcePrefix(owner,id)+'-worker',State:'running'},{ID:'b'.repeat(64),Names:'external',State:'exited'},{ID:'c'.repeat(64),Names:'benchmark',State:'running'},{ID:'d'.repeat(64),Names:resourcePrefix('other',id)+'-worker',State:'running'}];
 const manager={directory,endpoint:'unix:///test-engine',load:async account=>{assert.equal(account,owner);return {environments:[{id,name:'银河系'},{id:'external-env',name:'研发',external:{id:'b'.repeat(64)}}]};},command:async args=>args[0]==='ps'?rows.map(r=>JSON.stringify(r)).join('\n'):''};
 try{const result=await DockerEnvironments.prototype.existing.call(manager,owner);assert.equal(result.length,3);assert.deepEqual(result.map(r=>r.environmentNames),[['银河系'],['研发'],[]]);}finally{await rm(directory,{recursive:true,force:true});}
});
