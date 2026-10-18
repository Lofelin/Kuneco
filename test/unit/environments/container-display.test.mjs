import test from 'node:test';import assert from 'node:assert/strict';
import {readContainerDisplay} from '../../../src/features/environments/container-display.mjs';
import {containerDisplayRows} from '../../../src/features/environments/container-display-rows.mjs';
test('container display strips sensitive health output and labels, formats actual limits',async()=>{
 const d=await readContainerDisplay({command:async()=>JSON.stringify({state:{Running:true,Health:{Status:'healthy',Log:[{Output:'SECRET'}]}},init:true,memory:2147483648,cpus:2e9,pids:256,readonly:true,log:{Type:'local',Config:{'max-size':'10m','max-file':'3'}},spec:'private-label'})},'name','endpoint');
 assert.ok(!JSON.stringify(d).includes('SECRET'));assert.ok(!JSON.stringify(d).includes('private-label'));
 const rows=containerDisplayRows(d,{available:false});assert.match(rows.find(r=>r.label==='资源上限').worker,/2 CPU · 2 GiB · 256/);assert.equal(rows[0].gateway,'暂不可读取');assert.equal(rows.find(r=>r.label==='服务健康').worker,'正常');
});
test('unavailable and external containers do not claim managed guarantees',async()=>{
 assert.deepEqual(await readContainerDisplay({command:async()=>{throw Error();}},'missing'),{available:false});
 const rows=containerDisplayRows({available:true,status:'已停止',health:null},{},{external:true});assert.ok(!rows.some(r=>r.label==='规格管理'));assert.equal(rows[1].worker,'未配置');
});

test('health states remain truthful and expose only safe failure metadata',async()=>{
 for(const [health,expected] of [['starting','检查中'],['unhealthy','异常'],['unexpected','未知'],[null,'未配置']])assert.equal(containerDisplayRows({available:true,health},{}).find(r=>r.label==='服务健康').worker,expected);
 const value=await readContainerDisplay({command:async()=>JSON.stringify({state:{Health:{Status:'unhealthy',Log:[{Output:'SECRET TOKEN',ExitCode:7,End:'2026-10-18T04:00:00Z'}]}}})},'worker');
 assert.equal(value.healthExitCode,7);assert.equal(value.healthCheckedAt,'2026-10-18T04:00:00.000Z');assert.ok(!JSON.stringify(value).includes('SECRET'));
});
