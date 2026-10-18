export const preferenceDefaults=Object.freeze({shortcuts:Object.freeze({}),sendShortcut:'enter',chatFontSize:14,codeFontSize:13,confirmQuit:true,motion:'system',hourCycle:'system',timeDisplay:'absolute'});
export function normalizePreferences(value={}){
 const out={...preferenceDefaults,shortcuts:{}};
 if(!value || typeof value!=='object')return out;
 for(const [key,allowed] of Object.entries({sendShortcut:['enter','modifier'],motion:['system','reduce'],hourCycle:['system','12','24'],timeDisplay:['absolute','relative']}))if(allowed.includes(value[key]))out[key]=value[key];
 for(const key of ['chatFontSize','codeFontSize'])if(Number.isInteger(value[key])&&value[key]>=12&&value[key]<=20)out[key]=value[key];
 if(typeof value.confirmQuit==='boolean')out.confirmQuit=value.confirmQuit;
 if(value.shortcuts&&typeof value.shortcuts==='object'&&!Array.isArray(value.shortcuts))out.shortcuts={...value.shortcuts};
 return out;
}
export function shouldSend(event,preferences,platform){
 if(event.key!=='Enter'||event.shiftKey||event.altKey||event.isComposing||event.keyCode===229)return false;
 return preferences.sendShortcut==='modifier'?(platform==='darwin'?event.metaKey&&!event.ctrlKey:event.ctrlKey&&!event.metaKey):!event.metaKey&&!event.ctrlKey;
}
