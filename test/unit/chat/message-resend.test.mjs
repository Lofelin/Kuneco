import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../../src/app/renderer.js',import.meta.url),'utf8');
test('edited resend appends with attachments without clearing the composer draft or earlier messages',async()=>{
 const bubbles=[{role:'user',text:'original'}],prompt={value:'unsent draft'},images=[{url:'https://example.com/a.png'}];let sent,saves=0;
 const context=vm.createContext({Date,selectedEngine:'deepseek',activeChatId:'same-chat',chatSessions:[{id:'same-chat',title:'Existing'}],api:{cc:async message=>{sent=message;}},renderSessionList(){},bubble:(role,text,engine,pending,attachments,reasoning,createdAt)=>{bubbles.push({role,text,attachments,createdAt});return {};},deepseekComposer:{clear(){throw Error('draft must remain');}},$:()=>prompt,reasoningView(){},updateChatMessage(){},reply:null,saveChatView(){saves++;}});
 vm.runInContext(source.slice(source.indexOf('async function sendChatMessage('),source.indexOf("$('chatForm').onsubmit=")),context);
 await context.sendChatMessage({text:'edited',images,thinking:'enabled'});
 assert.equal(sent.images,images);assert.equal(bubbles[0].text,'original');assert.equal(bubbles[1].text,'edited');assert.equal(bubbles[1].attachments,images);assert.ok(Date.parse(bubbles[1].createdAt));assert.equal(prompt.value,'unsent draft');assert.equal(saves,1);
 context.api.cc=async()=>{throw Error('offline');};await assert.rejects(context.sendChatMessage({text:'retry',images}),/offline/);assert.equal(bubbles.length,3);assert.equal(prompt.value,'unsent draft');
});
