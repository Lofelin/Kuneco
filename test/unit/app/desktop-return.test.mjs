import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createDesktopReturn} from '../../../src/app/desktop-return.mjs';
test('desktop return only raises the app through its unguessable loopback route',async()=>{
 let opened=0;const endpoint=await createDesktopReturn(()=>opened++);
 try{
  const missing=await fetch(new URL('/auth/return/wrong',endpoint.url));assert.equal(missing.status,404);assert.equal(opened,0);
  const rejected=await fetch(endpoint.url,{method:'POST'});assert.equal(rejected.status,404);assert.equal(opened,0);
  const hostRejected=await new Promise((resolve,reject)=>{http.get(endpoint.url,{headers:{host:'evil.test'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);});assert.equal(hostRejected,404);assert.equal(opened,0);
  const result=await fetch(endpoint.url);assert.equal(result.status,200);assert.equal(opened,1);assert.match(await result.text(),/已打开Kuneco/);assert.equal(result.headers.get('cache-control'),'no-store');
 }finally{endpoint.close();}
});
