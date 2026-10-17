import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultAccountAvatar} from '../src/account-avatar.mjs';
import {AccountClient} from '../src/account-client.mjs';
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
 assert.equal(defaultAccountAvatar({id:'google',name:'Google User'},''),null);
 assert.equal(defaultAccountAvatar({...user,avatarUrl:'data:image/png;base64,fixture'},''),null);
 const client=new AccountClient({serverURL:'http://localhost:8787'});client.user=user;
 assert.ok(client.state().avatar);client.avatar='data:image/png;base64,custom';
 assert.equal(client.state().avatar,client.avatar);
 client.user=null;client.avatar=null;assert.equal(client.state().avatar,null);
});
