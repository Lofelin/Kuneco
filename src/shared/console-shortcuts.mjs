import {canonical,physical,shortcutFromEvent} from './shortcut-keys.mjs';
export const consoleShortcutActions=[['copy','复制选中内容'],['paste','粘贴'],['selectAll','全选终端内容'],['clear','清空终端显示'],['scrollTop','滚动到顶部'],['scrollBottom','滚动到底部'],['interrupt','中断当前命令']];
export const consoleShortcutDefaults=Object.freeze({copy:'Mod+Shift+C',paste:'Mod+Shift+V',selectAll:'Mod+Shift+A',clear:'Mod+K',scrollTop:'Mod+Home',scrollBottom:'Mod+End',interrupt:'Ctrl+C'});
export function validateConsoleShortcuts(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('无效终端快捷键设置');
 const seen=[new Set(),new Set()];
 for(const [id,input] of Object.entries(value)){
  if(!Object.hasOwn(consoleShortcutDefaults,id))throw new Error('未知终端快捷键操作');
  const binding=canonical(input);if(!binding)continue;
  if(/^(Mod|Ctrl)\+(Q|W|H|M)$/.test(binding)||binding==='Alt+Tab')throw new Error('该组合由系统保留，请换一个快捷键');
  for(const [i,mac] of [false,true].entries()){const key=physical(binding,mac);if(seen[i].has(key))throw new Error('终端快捷键冲突，请选择其他组合');seen[i].add(key);}
 }
 return true;
}
export function normalizeConsoleShortcuts(value){
 const out={...consoleShortcutDefaults};
 if(value&&typeof value==='object'&&!Array.isArray(value))for(const id of Object.keys(out))if(Object.hasOwn(value,id))try{out[id]=canonical(value[id]);}catch{}
 try{validateConsoleShortcuts(out);return out;}catch{return {...consoleShortcutDefaults};}
}
export function consoleShortcutAction(event,bindings,platform=''){
 if(event.isComposing||event.keyCode===229)return null;
 const input=shortcutFromEvent(event,platform);if(!input)return null;
 const mac=/darwin|mac/i.test(platform);
 return Object.entries(normalizeConsoleShortcuts(bindings)).find(([,binding])=>binding&&physical(binding,mac)===physical(input,mac))?.[0]||null;
}
