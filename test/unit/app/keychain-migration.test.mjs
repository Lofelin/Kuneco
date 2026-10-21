import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {configureKeychainAccess,migrationHelper,prepareKeychainMigration,verifyKeychainMigration} from '../../../src/app/keychain-migration.mjs';

const marker = 'kuneco-keychain-migration-v1.json';
const fixture = fn => { const root=mkdtempSync(path.join(tmpdir(),'kuneco-keychain-test-'));try{return fn(root);}finally{rmSync(root,{recursive:true,force:true});} };
const storage = {isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from('encrypted:'+text),decryptString:bytes=>{const text=bytes.toString();if(!text.startsWith('encrypted:'))throw new Error('bad key');return text.slice(10);}};

test('real application retains native keychain access even if test environment variables are present',()=>{
 const calls=[],app={setName:name=>calls.push(name),setPath:()=>assert.fail('must retain real profile'),commandLine:{appendSwitch:()=>assert.fail('must retain native keychain')}};
 assert.equal(configureKeychainAccess({app,directory:'/tmp/ignored',platform:'darwin'}),'Kuneco');
 assert.deepEqual(calls,['Kuneco']);
});

test('test keychain is restricted to an explicit temporary profile and stable test identity',()=>fixture(root=>{
 const directory=path.join(root,'profile');mkdirSync(directory);const calls=[];
 const app={setName:name=>calls.push(['name',name]),setPath:(key,value)=>calls.push([key,value]),commandLine:{appendSwitch:key=>calls.push(['switch',key])}};
 assert.equal(configureKeychainAccess({app,fixtureMode:true,directory,platform:'darwin',temporaryRoot:root}),'Kuneco Test');
 assert.deepEqual(calls,[['userData',directory],['switch','use-mock-keychain'],['name','Kuneco Test']]);
 for(const unsafe of [undefined,'relative',root,path.dirname(root)])assert.throws(()=>configureKeychainAccess({app,fixtureMode:true,directory:unsafe,temporaryRoot:root}));
 const escape=path.join(root,'outside');symlinkSync(path.dirname(root),escape);
 assert.throws(()=>configureKeychainAccess({app,fixtureMode:true,directory:escape,temporaryRoot:root}));
 assert.equal(calls.length,3,'rejected profiles must not change the app');
}));

test('native migration uses an isolated keychain: copy, retry, conflict and source preservation', {skip:process.platform!=='darwin'},()=>fixture(root=>{
  const output=execFileSync(migrationHelper(),['--self-test',root],{encoding:'utf8',timeout:30000});
  assert.deepEqual(JSON.parse(output),{status:'self-test-passed'});
}));

test('verification covers all stored accounts and proxy records before committing migration',()=>fixture(root=>{
 const directory=path.join(root,'profile');mkdirSync(directory);
 for(const name of ['account-session.bin','chat-cache-first.bin','chat-cache-second.bin'])writeFileSync(path.join(directory,name),storage.encryptString('fixture'));
 for(const sub of ['docker-environments','connection-records']){mkdirSync(path.join(directory,sub));writeFileSync(path.join(directory,sub,'owner.bin'),storage.encryptString('fixture'));}
 writeFileSync(path.join(directory,'proxy.json'),JSON.stringify({secret:storage.encryptString('proxy-fixture').toString('base64')}));
 const before=readFileSync(path.join(directory,'account-session.bin'));
 let calls=0;
 const migration=prepareKeychainMigration({directory,executable:'/fixture/Kuneco',platform:'darwin',helper:()=>'/fixture/helper',run:(_binary,args)=>{calls++;return args[0]==='--migrate'?' {"status":"copied"}':'';}});
 assert.equal(migration.phase,'prepared');assert.equal(calls,2);
 verifyKeychainMigration({directory,storage,migration});
 const saved=JSON.parse(readFileSync(path.join(directory,marker),'utf8'));
 assert.equal(saved.phase,'verified');assert.equal(saved.verifiedRecords,6);
 assert.deepEqual(readFileSync(path.join(directory,'account-session.bin')),before);
 prepareKeychainMigration({directory,platform:'darwin',helper:()=>assert.fail('must not read old key again')});
}));

test('denial, conflicting keys or missing source cannot produce a verified marker',()=>fixture(root=>{
 for(const failure of ['denied','source-missing']){
  const directory=path.join(root,failure);mkdirSync(directory);writeFileSync(path.join(directory,'account-session.bin'),storage.encryptString('fixture'));
  assert.throws(()=>prepareKeychainMigration({directory,platform:'darwin',executable:'/fixture',helper:()=>'/fixture/helper',run:(_binary,args)=>{if(args[0]!=='--migrate')return '';if(failure==='denied')throw new Error('denied');return '{"status":"source-missing"}';}}));
  assert.equal(existsSync(path.join(directory,marker)),false);
 }
}));

test('undecryptable records stop startup without changing bytes or recording success',()=>fixture(directory=>{
 const ciphertext=Buffer.from('unreadable');writeFileSync(path.join(directory,'account-session.bin'),ciphertext);
 assert.throws(()=>verifyKeychainMigration({directory,storage,migration:{phase:'prepared'}}),/无法验证/);
 assert.equal(existsSync(path.join(directory,marker)),false);
 assert.deepEqual(readFileSync(path.join(directory,'account-session.bin')),ciphertext);
}));

test('non-macOS skips migration and corrupt markers stop startup',()=>fixture(directory=>{
 assert.equal(prepareKeychainMigration({platform:'linux'}),null);
 writeFileSync(path.join(directory,marker),'invalid');
 assert.throws(()=>prepareKeychainMigration({directory,platform:'darwin'}),/记录损坏/);
}));
