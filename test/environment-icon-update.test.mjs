import test from 'node:test';
import assert from 'node:assert/strict';
import {DockerEnvironments} from '../src/docker-environments.mjs';
test('environment icon updates only the selected environment and validates before saving',async()=>{
 const manager=new DockerEnvironments({directory:'/unused',sourceRoot:process.cwd()});
 let data={localEnabled:true,localIcon:'monitor',environments:[{id:'one',icon:'trees'},{id:'two',icon:'moon'}]},saved=0;
 manager.load=async owner=>{assert.equal(owner,'owner');return structuredClone(data);};
 manager.save=async(owner,value)=>{assert.equal(owner,'owner');data=value;saved++;};
 await manager.changeEnvironmentIcon('owner','one','rocket');
 assert.equal(data.environments[0].icon,'rocket');assert.equal(data.environments[1].icon,'moon');
 await manager.changeEnvironmentIcon('owner',null,'star');assert.equal(data.localIcon,'star');
 await assert.rejects(manager.changeEnvironmentIcon('owner','one','invalid'),/有效/);
 await assert.rejects(manager.changeEnvironmentIcon('owner','missing','star'),/不存在/);
 await assert.rejects(manager.changeEnvironmentIcon(null,'one','star'),/登录/);
 assert.equal(saved,2);
});
