import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {consoleOptions,validConsoleDirectory} from '../../../src/shared/console-preferences.mjs';
import {createPreferenceStore} from '../../../src/features/preferences/preference-store.mjs';
test('console settings persist independently and reject unsafe values',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'console-preferences-'));
 try{const file=path.join(dir,'prefs.json'),store=createPreferenceStore(file);await store.load();await store.save({consoleTheme:'system',consoleFontSize:18,consoleAutoConnect:false,consoleConfirmPaste:false,consoleLineHeight:1.4,consoleDirectories:{'["a","one"]':'/workspace/a b','["a","two"]':'/tmp'}});const actual=await createPreferenceStore(file).load();assert.equal(actual.consoleFontSize,18);assert.equal(actual.consoleAutoConnect,false);assert.equal(actual.consoleConfirmPaste,false);assert.equal(actual.consoleDirectories['["a","one"]'],'/workspace/a b');assert.equal(actual.consoleDirectories['["a","two"]'],'/tmp');
 for(const patch of [{consoleFontSize:99},{consoleScrollback:-1},{consoleLineHeight:0},{consoleCursor:'bad'},{consoleFont:'bad'},{consoleDirectories:{env:'relative'}},{consoleDirectories:{env:'/tmp\ncommand'}}])await assert.rejects(store.save(patch));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('theme follows app only when requested and directory values are literal absolute paths',()=>{
 assert.equal(consoleOptions({},false).theme.background,'#151820');assert.equal(consoleOptions({consoleTheme:'system'},false).theme.background,'#ffffff');assert.equal(consoleOptions({consoleTheme:'system'},true).theme.background,'#151820');assert.equal(consoleOptions({consoleTheme:'light'},true).theme.background,'#ffffff');
 for(const directory of ['','/workspace','/tmp/a b',"/tmp/$(echo literal)"])assert.equal(validConsoleDirectory(directory),true);
 for(const directory of ['~','../tmp','/tmp\0bad','/tmp\nwhoami'])assert.equal(validConsoleDirectory(directory),false);
});
