import test from 'node:test';
import assert from 'node:assert/strict';
import {deviceName} from '../../../src/features/environments/device-name.mjs';
import {DockerEnvironments} from '../../../src/features/environments/docker-environments.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('device name uses macOS ComputerName and falls back to the hostname',async()=>{
 assert.equal(await deviceName({platform:'darwin',execute:async(file,args)=>{assert.equal(file,'/usr/sbin/scutil');assert.deepEqual(args,['--get','ComputerName']);return {stdout:'  我的 MacBook Air\n'};},hostName:()=> 'network.local'}),'我的 MacBook Air');
 for(const execute of [async()=>{throw new Error('unavailable');},async()=>({stdout:'\n'})])assert.equal(await deviceName({platform:'darwin',execute,hostName:()=> 'network.local'}),'network.local');
 assert.equal(await deviceName({platform:'win32',hostName:()=> 'DESKTOP-123',execute:()=>assert.fail('macOS only')}),'DESKTOP-123');
});

test('local environment follows device changes across owners without replacing resources',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'kuneco-device-'));let name='设备一';
 const manager=new DockerEnvironments({directory,encrypt:Buffer.from,decrypt:b=>b.toString(),readDeviceName:async()=>name});manager.engineStatus=async()=>({ready:false});
 try{
  await manager.save('A',{activeId:null,localEnabled:true,localName:'旧自定义名称',localIcon:'monitor',environments:[]});
  assert.equal((await manager.state('A')).localName,'设备一');
  name='设备二';assert.equal((await manager.load('A')).localName,'设备二');assert.equal((await manager.state('B')).localName,'设备二');assert.equal((await manager.state(null)).localName,'设备二');
  await assert.rejects(manager.forgetLocal('A','旧自定义名称'),/一致/);
  assert.equal((await manager.load('A')).localEnabled,true);
 }finally{await rm(directory,{recursive:true,force:true});}
});
