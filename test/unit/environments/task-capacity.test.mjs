import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskCapacity} from '../../../src/features/environments/task-capacity.mjs';
test('capacity is global to its holder, failure remains occupied until explicit cleanup release',()=>{
 const capacity=new TaskCapacity({maxActive:2});const a=capacity.reserve(),b=capacity.reserve();
 assert.throws(()=>capacity.reserve(),{code:'CONTAINER_TASK_CAPACITY'});
 assert.equal(capacity.active,2);a();a();assert.equal(capacity.active,1);
 const c=capacity.reserve();b();c();assert.equal(capacity.active,0);
});
test('reject invalid capacity rather than allowing unbounded launches',()=>{
 for(const maxActive of [0,-1,Infinity,1.5,NaN])assert.throws(()=>new TaskCapacity({maxActive}));
});
