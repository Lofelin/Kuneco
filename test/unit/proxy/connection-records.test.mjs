import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ConnectionRecords} from '../../../src/features/proxy/connection-records.mjs';

test('Connection records survive reload, serialize writes and remain account scoped',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-records-'));
 const options={directory,encrypt:text=>Buffer.from(text).reverse(),decrypt:value=>Buffer.from(value).reverse().toString()};
 try{
  const store=new ConnectionRecords(options);
  await Promise.all(Array.from({length:205},(_,i)=>store.append('owner-a','连接 '+i)));
  assert.equal((await store.list('owner-a')).length,200);
  assert.deepEqual(await store.list('owner-b'),[]);
  await store.append('owner-b','账号 B');
  await store.append('owner-a','http://user:secret@192.0.2.1:8080 请求失败');
  const restored=new ConnectionRecords(options),records=await restored.list('owner-a');
  assert.equal(records[0].message,'http://***@192.0.2.1:8080 请求失败');
  assert.equal((await restored.list('owner-b'))[0].message,'账号 B');
  assert.ok(!records.some(record=>record.message==='账号 B'));
  const raw=await readFile(store.file('owner-a'));
  assert.ok(!raw.toString().includes('连接'));assert.ok(!raw.toString().includes('secret'));
  assert.equal((await stat(store.file('owner-a'))).mode&0o777,0o600);
  await assert.rejects(store.list(null),/登录/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('connection records isolate environments including identical messages and unknown legacy entries',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dingtu-record-scopes-'));
 const store=new ConnectionRecords({directory,encrypt:Buffer.from,decrypt:value=>value.toString()});
 try{
  await store.append('a','同一事件',null);await store.append('a','同一事件','docker-a');await store.append('a','另一个事件','docker-b');
  assert.deepEqual((await store.list('a',null)).map(x=>x.message),['同一事件']);
  assert.deepEqual((await store.list('a','docker-a')).map(x=>x.message),['同一事件']);
  assert.deepEqual((await store.list('a','docker-b')).map(x=>x.message),['另一个事件']);
  assert.deepEqual(await store.list('b','docker-a'),[]);
 }finally{await rm(directory,{recursive:true,force:true});}
});
