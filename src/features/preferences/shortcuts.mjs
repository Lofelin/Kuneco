import {canonical,physical,shortcutFromEvent} from '../../shared/shortcut-keys.mjs';
export {shortcutFromEvent} from '../../shared/shortcut-keys.mjs';
export const shortcutDefaults=Object.freeze({newChat:'Mod+N',searchChat:'Mod+F',focusComposer:'Mod+L',stopReply:'Mod+Shift+Escape',toggleSidebar:'Mod+B',settings:'Mod+,',shortcuts:'Mod+Shift+,',nextTab:'Ctrl+Tab',previousTab:'Ctrl+Shift+Tab',closeTab:'Mod+Shift+W',pinTab:'Mod+Shift+P',browser:'Mod+Shift+B',automation:'Mod+Shift+A',runtimes:'Mod+Shift+R',console:'Mod+`'});
function reserved(binding){
 if(!binding)return false;
 const bits=binding.split('+'),key=bits.at(-1),command=bits.includes('Mod')||bits.includes('Meta')||bits.includes('Ctrl');
 return command&&(['C','V','X','A','Z','Q','H','M','0','=','-'].includes(key)&&(!bits.includes('Shift')||key==='Z'))||command&&key==='W'&&!bits.includes('Shift')||bits.includes('Alt')&&key==='Tab';
}
export function validateShortcuts(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('无效快捷键设置');
 const seen=[new Map(),new Map()];
 for(const [id,input] of Object.entries(value)){
  if(!Object.hasOwn(shortcutDefaults,id))throw new Error('未知快捷键操作：'+id);
  const binding=canonical(input);if(reserved(binding))throw new Error('该组合由系统保留，请换一个快捷键');
  if(!binding)continue;
  for(const [index,mac] of [false,true].entries()){const key=physical(binding,mac);if(seen[index].has(key))throw new Error('快捷键冲突，请为不同操作选择不同组合');seen[index].set(key,id);}
 }
 return true;
}
export function normalizeShortcuts(value){
 const result={...shortcutDefaults};
 if(!value||typeof value!=='object'||Array.isArray(value))return result;
 for(const id of Object.keys(result))if(Object.hasOwn(value,id)){try{result[id]=canonical(value[id]);}catch{}}
 try{validateShortcuts(result);return result;}catch{return {...shortcutDefaults};}
}
export function mountShortcuts({document,platform='',getBindings,actions,onError=()=>{}}){
 const listener=event=>{
  const path=event.composedPath?.()||[event.target];
  if(document.body?.matches('.auth-mode,.auth-pending,.environment-onboarding'))return;
  if(event.defaultPrevented||event.isComposing||event.keyCode===229||event.repeat||path.some(node=>node?.matches?.('[data-shortcut-recorder],.xterm,.xterm-helper-textarea,[data-terminal-input]')))return;
  if(document.querySelector('app-dialog[open],wa-dialog[open],dialog[open],wa-dropdown[open],wa-select[open],[role="menu"][data-open="true"]'))return;
  const input=shortcutFromEvent(event,platform);if(!input)return;
  const mac=/darwin|mac/i.test(platform),bindings=normalizeShortcuts(getBindings());
  for(const [id,binding] of Object.entries(bindings)){
   if(!binding||physical(binding,mac)!==physical(input,mac))continue;
   try{const result=actions[id]?.(event);if(result===false||!actions[id])return;event.preventDefault();event.stopPropagation();if(result?.catch)result.catch(onError);}catch(error){onError(error);}return;
  }
 };
 document.addEventListener('keydown',listener,true);return()=>document.removeEventListener('keydown',listener,true);
}
