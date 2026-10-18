import test from 'node:test';
import assert from 'node:assert/strict';
import {environmentDetailComplete,environmentRefreshDue} from '../../../src/features/environments/environment-refresh.mjs';
test('partial reads remain retryable, recovery becomes fresh, and successful data expires',()=>{
 const d={id:'a',baseSystem:{os:'Debian'},reliability:{worker:{available:false},gateway:{available:true},network:{available:true}}};
 const state={scope:'a',currentScope:'a',checkedAt:100,now:200};
 assert.equal(environmentRefreshDue({...state,dirty:!environmentDetailComplete(d)}),true);
 d.reliability.worker={available:true,status:'运行中'};
 assert.equal(environmentRefreshDue({...state,dirty:!environmentDetailComplete(d)}),false);
 assert.equal(environmentRefreshDue({...state,now:30100}),true);
 assert.equal(environmentRefreshDue({...state,currentScope:'b'}),true);
 d.baseSystem=null;assert.equal(environmentDetailComplete(d),false);
 d.reliability.worker.status='已停止';assert.equal(environmentDetailComplete(d),true);
 assert.equal(environmentDetailComplete({id:null}),true);
});
