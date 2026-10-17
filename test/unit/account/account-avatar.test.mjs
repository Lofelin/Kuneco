import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultAccountAvatar} from '../../../src/features/account/account-avatar.mjs';
import {AccountClient} from '../../../src/features/account/account-client.mjs';
const user={id:'user-a',username:'alice',name:'Alice'};
test('password avatars are stable across names, distinct across accounts and contain no identity',()=>{
 const avatar=defaultAccountAvatar(user,'https://account.test');
 assert.match(avatar,/^data:image\/svg\+xml;base64,/);
 assert.equal(avatar,defaultAccountAvatar({...user,name:'Changed',username:'renamed'},'https://account.test'));
 assert.notEqual(avatar,defaultAccountAvatar({...user,id:'user-b'},'https://account.test'));
 const svg=Buffer.from(avatar.split(',')[1],'base64').toString();
 assert.match(svg,/<svg/);assert.ok(!svg.includes('alice')&&!svg.includes('user-a'));
});
test('Google and uploaded avatars are preserved; signed out has no generated avatar',()=>{
 assert.equal(defaultAccountAvatar(null,''),null);
 assert.ok(defaultAccountAvatar({id:'google',name:'Google User'},''));
 assert.ok(defaultAccountAvatar({...user,avatarUrl:'data:image/png;base64,fixture'},''));
 const client=new AccountClient({serverURL:'http://localhost:8787'});client.user=user;
 assert.ok(client.state().avatar);client.avatar='data:image/png;base64,custom';
 assert.equal(client.state().avatar,client.avatar);
 client.user=null;client.avatar=null;assert.equal(client.state().avatar,null);
});

import {runtimeAccountAvatar,setAccountAvatar} from '../../../src/shared/ui/generated-avatar.mjs';
test('runtime fallback is stable and failed images recover',()=>{
 const entry={id:'codex',auth:{accountName:'Alice'}};
 const fallback=runtimeAccountAvatar(entry);
 assert.equal(fallback,runtimeAccountAvatar({...entry,version:'new'}));
 assert.notEqual(fallback,runtimeAccountAvatar({id:'codex',auth:{accountName:'Bob'}}));
 const element=new EventTarget();
 setAccountAvatar(element,'https://example.test/photo',fallback);
 assert.equal(element.image,'https://example.test/photo');
 element.dispatchEvent(new Event('wa-error'));assert.equal(element.image,fallback);
 setAccountAvatar(element,null,fallback);assert.equal(element.image,fallback);assert.equal(element.initials,'');
});
