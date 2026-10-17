import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {notificationDelivery,normalizeNotificationPreferences,notificationStorageKey} from '../../../src/features/notifications/notification-preferences.mjs';
import {mountNotificationSettings} from '../../../src/features/notifications/notification-settings.mjs';
test('notification gates default to existing in-app behavior, keep channels independent and reject unknown categories',()=>{
 assert.deepEqual(notificationDelivery({},'runtime'),{inApp:true,desktop:false});
 assert.deepEqual(notificationDelivery({inApp:false,desktop:true},'runtime'),{inApp:false,desktop:true});
 assert.deepEqual(notificationDelivery({desktop:true,runtime:false},'runtime'),{inApp:false,desktop:false});
 assert.deepEqual(notificationDelivery({desktop:true},'unknown'),{inApp:false,desktop:false});
 assert.equal(normalizeNotificationPreferences({inApp:'false'}).inApp,true);
 assert.notEqual(notificationStorageKey('a'),notificationStorageKey('b'));
});
test('settings persist per account, suppress selected categories, and roll back on storage failures',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid'});const old=globalThis.document;globalThis.document=dom.window.document;
 try{const sent=[],shown=[],storage=dom.window.localStorage,controller=mountNotificationSettings({host:document.querySelector('#root'),storage,api:{notification:async(action,value)=>{if(action==='status')return {supported:true};sent.push(value);}}});await Promise.resolve();controller.setOwner('a');
 const toggle=key=>{const el=document.querySelector(`[data-notification="${key}"]`);el.checked=!el.checked;el.dispatchEvent(new dom.window.Event('change'));};
 toggle('chat');controller.deliver('hidden','chat',t=>shown.push(t));assert.equal(shown.length,0);
 toggle('desktop');controller.deliver('shown','network',t=>shown.push(t));assert.equal(shown.length,1);assert.equal(sent[0].owner,'a');
 controller.setOwner('b');assert.equal(document.querySelector('[data-notification="chat"]').checked,true);assert.equal(document.querySelector('[data-notification="desktop"]').checked,false);
 controller.setOwner('a');assert.equal(document.querySelector('[data-notification="chat"]').checked,false);
 const proto=Object.getPrototypeOf(storage),save=proto.setItem;proto.setItem=()=>{throw new Error('full')};toggle('chat');assert.equal(document.querySelector('[data-notification="chat"]').checked,false);proto.setItem=save;
 }finally{globalThis.document=old;dom.window.close();}
});
