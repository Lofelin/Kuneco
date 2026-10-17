import {Avatar,Style} from '@dicebear/core';
import thumbs from '@dicebear/styles/thumbs.json' with {type:'json'};
// DiceBear core: MIT; Thumbs artwork: CC0. Generated locally, never uploaded.
const style=new Style(thumbs),cache=new Map();
export function generatedAvatar(seed){
 if(!cache.has(seed)){
  const svg=new Avatar(style,{seed,size:128}).toString();
  if(cache.size>=128)cache.delete(cache.keys().next().value);
  cache.set(seed,'data:image/svg+xml;base64,'+btoa(Array.from(new TextEncoder().encode(svg),byte=>String.fromCharCode(byte)).join('')));
 }
 return cache.get(seed);
}
export function runtimeAccountAvatar(entry){
 const auth=entry.auth || {};
 return generatedAvatar(JSON.stringify(['kuneco-runtime-avatar-v1',entry.id,auth.accountId || auth.accountEmail || auth.accountName || 'unknown']));
}
const errorHandlers=new WeakMap();
export function setAccountAvatar(element,image,fallback){
 element.initials='';
 element.image=image || fallback;
 const previous=errorHandlers.get(element);if(previous)element.removeEventListener('wa-error',previous);
 const onError=()=>{if(element.image!==fallback)element.image=fallback;};
 errorHandlers.set(element,onError);element.addEventListener('wa-error',onError);
}
