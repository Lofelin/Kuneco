const modifiers=['Mod','Ctrl','Alt','Shift'];
const specialKeys=new Set(['Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Backspace','Delete']);
export function canonical(value){
 if(value==='')return '';
 if(typeof value!=='string')throw new Error('快捷键必须是按键组合');
 const parts=value.split('+'),key=parts.pop();
 if(!key||parts.some(p=>!modifiers.includes(p))||new Set(parts).size!==parts.length||(!parts.includes('Mod')&&!parts.includes('Ctrl')&&!parts.includes('Alt'))||!(specialKeys.has(key)||/^[A-Za-z0-9,./;\[\]\\`=-]$/.test(key)))throw new Error('请使用 Command/Ctrl 或 Alt 加普通按键；Enter 保留用于发送');
 return [...modifiers.filter(m=>parts.includes(m)),key.length===1?key.toUpperCase():key].join('+');
}
export function physical(value,mac){return value.split('+').map(x=>x==='Mod'?(mac?'Meta':'Ctrl'):x).filter((x,i,a)=>a.indexOf(x)===i).sort().join('+');}
export function shortcutFromEvent(event,platform=''){
 const mac=/darwin|mac/i.test(platform),parts=[];
 if(mac?event.metaKey:event.ctrlKey)parts.push('Mod');
 if(mac&&event.ctrlKey)parts.push('Ctrl');
 if(event.altKey)parts.push('Alt');if(event.shiftKey)parts.push('Shift');
 let key=event.key;
 if(event.code?.startsWith('Key'))key=event.code.slice(3);
 else if(event.code?.startsWith('Digit'))key=event.code.slice(5);
 else if(event.code==='Comma')key=',';else if(event.code==='Backquote')key='`';
 if(['Control','Meta','Alt','Shift'].includes(key))return null;
 return [...parts,key?.length===1?key.toUpperCase():key].join('+');
}
