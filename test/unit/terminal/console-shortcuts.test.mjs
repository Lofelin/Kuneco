import {normalizeShortcuts} from '../../../src/features/preferences/shortcuts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {consoleShortcutDefaults,normalizeConsoleShortcuts,validateConsoleShortcuts,consoleShortcutAction} from '../../../src/shared/console-shortcuts.mjs';
import {createPreferenceStore} from '../../../src/features/preferences/preference-store.mjs';

test('terminal bindings persist, can be cleared, reject conflicts and remain separate from app shortcuts',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kuneco-keys-'));
 try{
  const file=path.join(dir,'preferences.json'),store=createPreferenceStore(file);await store.load();
  const bindings={...consoleShortcutDefaults,clear:'Mod+Shift+J',copy:''};
  await store.save({consoleShortcuts:bindings});
  const reloaded=createPreferenceStore(file);await reloaded.load();assert.deepEqual(reloaded.get().consoleShortcuts,bindings);
  await assert.rejects(store.save({consoleShortcuts:{...bindings,clear:bindings.paste}}),/冲突/);
  await assert.rejects(store.save({consoleShortcuts:{...bindings,clear:'Mod+Q'}}),/保留/);
  assert.deepEqual(normalizeShortcuts(reloaded.get().shortcuts),normalizeShortcuts(store.get().shortcuts));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('terminal shortcuts respect platform modifiers, IME and unbound shell keys',()=>{
 assert.equal(validateConsoleShortcuts(consoleShortcutDefaults),true);
 assert.equal(consoleShortcutAction({key:'K',code:'KeyK',metaKey:true},undefined,'darwin'),'clear');
 assert.equal(consoleShortcutAction({key:'K',code:'KeyK',ctrlKey:true},undefined,'win32'),'clear');
 assert.equal(consoleShortcutAction({key:'c',code:'KeyC',ctrlKey:true},undefined,'darwin'),'interrupt');
 for(const event of [{key:'a',code:'KeyA',ctrlKey:true},{key:'d',ctrlKey:true},{key:'ArrowUp'},{key:'k',code:'KeyK',metaKey:true,isComposing:true}])assert.equal(consoleShortcutAction(event,undefined,'darwin'),null);
 assert.equal(consoleShortcutAction({key:'k',code:'KeyK',metaKey:true},{...consoleShortcutDefaults,clear:''},'darwin'),null);
 assert.equal(normalizeConsoleShortcuts({clear:'invalid'}).clear,consoleShortcutDefaults.clear);
});
