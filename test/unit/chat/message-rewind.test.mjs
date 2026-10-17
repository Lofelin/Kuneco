import test from 'node:test';
import assert from 'node:assert/strict';
import {rewindPrefix,replayPrompt,deepSeekPrefix} from '../../../src/features/chat/message-rewind.mjs';
import {mergeChatPayload} from '../../../src/features/chat/chat-sync.mjs';
test('rewind keeps only turns before the edited user and excludes errors and hidden reasoning',()=>{
 const messages=[{role:'user',text:'remember blue',images:[{dataURL:'data:image/png;base64,YQ=='}]},{role:'assistant',text:'blue',reasoning:{text:'private'}},{role:'error',text:'old failure'},{role:'user',text:'edit me'},{role:'assistant',text:'removed secret'}];
 const prefix=rewindPrefix(messages,3);
 assert.equal(prefix.length,2);assert.equal(prefix[1].reasoning,undefined);
 const prompt=replayPrompt(prefix,'new question');assert.match(prompt,/remember blue/);assert.doesNotMatch(prompt,/removed secret|old failure|edit me|private/);
 assert.equal(deepSeekPrefix(prefix)[0].content[1].image_url.url,messages[0].images[0].dataURL);
 assert.deepEqual(rewindPrefix(messages,0),[]);assert.throws(()=>rewindPrefix(messages,2));
});
test('cloud merge cannot restore a deleted tail when another device appends',()=>{
 const a={role:'user',text:'a'},b={role:'assistant',text:'b'},c={role:'user',text:'c'};
 assert.throws(()=>mergeChatPayload({messages:[a,b]},{messages:[a]},{messages:[a,b,c]}),/无法自动合并/);
 assert.deepEqual(mergeChatPayload({messages:[a,b]},{messages:[a]},{messages:[a,b]}),{messages:[a]});
});

test('DeepSeek sends the rebuilt prefix and persists only its new continuation',async()=>{
 const {mkdtemp,rm,readFile}=await import('node:fs/promises');const {tmpdir}=await import('node:os');
 const {configureDeepSeek,runDeepSeekCLI}=await import('../../../src/features/runtimes/deepseek-runtime.mjs');
 const directory=await mkdtemp(tmpdir()+'/rewind-');const sessionId='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';let sent;
 try{
  await configureDeepSeek(directory,{apiKey:'fixture-private-key'},async()=>({data:[{id:'deepseek-flash'}]}));
  const request=async(_proxy,_key,_route,body)=>{sent=structuredClone(body.messages);return {choices:[{message:{content:'answer'}}]};};
  await runDeepSeekCLI('chat',{sessionId,prompt:'deleted old history'},{directory,request});
  await runDeepSeekCLI('chat',{sessionId,history:[{role:'user',content:'retained'}],prompt:'edited'},{directory,request});
  assert.deepEqual(sent.map(m=>m.content),['retained','edited']);
  await runDeepSeekCLI('chat',{sessionId,prompt:'next'},{directory,request});
  assert.deepEqual(sent.map(m=>m.content),['retained','edited','answer','next']);
  assert.doesNotMatch(await readFile(directory+'/'+sessionId+'.json','utf8'),/deleted old history/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
