import {normalizeShortcuts,validateShortcuts} from './shortcuts.mjs';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {normalizePreferences,preferenceDefaults} from '../../shared/preferences.mjs';
export function createPreferenceStore(file){
 let value={...preferenceDefaults},queue=Promise.resolve();
 return {get:()=>({...value}),async load(){try{value=normalizePreferences(JSON.parse(await readFile(file,'utf8')));value.shortcuts=normalizeShortcuts(value.shortcuts);}catch(error){if(error.code!=='ENOENT')throw new Error('偏好设置读取失败，原文件已保留');}return {...value};},save(patch){
  const run=queue.catch(()=>{}).then(async()=>{
   if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('无效偏好设置');
   if(Object.hasOwn(patch,'shortcuts'))validateShortcuts(patch.shortcuts);
   const next=normalizePreferences({...value,...patch});
   for(const [key,item] of Object.entries(patch))if(!Object.hasOwn(preferenceDefaults,key)||(key==='shortcuts'?JSON.stringify(next[key])!==JSON.stringify(item):next[key]!==item))throw new Error('无效偏好设置：'+key);
   await writeFile(file+'.tmp',JSON.stringify(next),{mode:0o600});await rename(file+'.tmp',file);value=next;return {...value};
  });queue=run;return run;
 }};
}
