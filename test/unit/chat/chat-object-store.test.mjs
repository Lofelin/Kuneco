import test from 'node:test';import assert from 'node:assert/strict';
import {encodeChatPayload,decodeChatPayload} from '../../../src/features/chat/chat-object-store.mjs';
test('many chats and large images round-trip with bounded requests and a constant-size manifest',async()=>{
 const objects=new Map(),put=async(id,value)=>{assert.ok(Buffer.byteLength(JSON.stringify(value))<1024*1024);objects.set(id,value);},get=async id=>objects.get(id);
 const image='data:image/png;base64,'+'a'.repeat(3*1024*1024);
 const payload={sessions:Array.from({length:200},(_,i)=>({id:String(i)})),views:[{id:'1',messages:[{role:'user',text:'图片',images:[{dataURL:image,name:'image.png'}]},{role:'assistant',text:'中文😀'.repeat(500000)}]}]};
 const manifest=await encodeChatPayload(payload,put);assert.ok(JSON.stringify(manifest).length<150);assert.ok(objects.size>20);assert.deepEqual(await decodeChatPayload(manifest,get),payload);assert.equal(payload.views[0].messages[0].images[0].dataURL,image);
 const bad=new Map(objects);bad.set(manifest.head,{data:'corrupted',next:null});await assert.rejects(()=>decodeChatPayload(manifest,async id=>bad.get(id)),/校验失败/);
 assert.deepEqual(await decodeChatPayload(payload,get),payload);
});
test('failed object upload never yields a manifest to publish',async()=>{await assert.rejects(()=>encodeChatPayload({views:[]},async()=>{throw Error('offline');}),/offline/);});
test('objects are partitioned by environment even for identical attachments',async()=>{
 const objects=new Map(),scopes=new Set();const payload={sessions:[{id:'a',environmentId:'00000000-0000-0000-0000-000000000001'},{id:'b',environmentId:'00000000-0000-0000-0000-000000000002'}],views:['a','b'].map(id=>({id,messages:[{role:'user',text:id,images:[{dataURL:'data:image/png;base64,abcd'}]}]}))};
 const manifest=await encodeChatPayload(payload,async(id,value,scope)=>{scopes.add(scope);objects.set(scope+':'+id,value);});assert.equal(scopes.size,3);assert.ok(scopes.has('_index'));
 assert.deepEqual(await decodeChatPayload(manifest,async(id,scope)=>objects.get(scope+':'+id)),payload);
});
