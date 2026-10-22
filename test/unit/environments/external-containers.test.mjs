import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {listExternalContainers,inspectExternal} from '../../../src/features/environments/external-containers.mjs';
const owner='external-import-test',prefix='dingtu-'+createHash('sha256').update(owner).digest('hex').slice(0,12)+'-';
const row=(n,name,Labels='')=>({ID:String(n).repeat(64),Names:name,Labels,State:'running'});
function manager(rows,role){return {endpoint:'unix:///fixture.sock',directory:'/tmp/kuneco-external-list-fixture',command:async args=>{if(args[0]==='context')return '';if(args[0]==='ps')return rows.map(x=>JSON.stringify(x)).join('\n');if(args[0]==='inspect')return JSON.stringify([{Config:{Labels:{app:role},WorkingDir:'/workspace'}}]);throw Error('unexpected operation');}};}
test('existing-container import excludes internal browser, transport and task services while keeping work containers',async()=>{
 const rows=[row(1,prefix+'a-browser'),row(2,prefix+'a-gateway'),row(3,prefix+'a-worker'),row(4,'renamed-browser','app=kuneco-browser'),row(5,'renamed-transport','app=kuneco-browser-transport'),row(6,'my-service'),row(7,'task','app=dingtu-direct')];
 const result=await listExternalContainers(manager(rows),owner);
 assert.deepEqual(result.map(x=>x.name),[prefix+'a-worker','my-service']);
});
test('import rechecks inspected labels when a browser service was renamed or listing labels were stale',async()=>{
 const m=manager([row(8,'renamed-service')],'kuneco-browser');const [entry]=await listExternalContainers(m,owner);
 await assert.rejects(inspectExternal(m,owner,entry.key),/内部服务/);
});
