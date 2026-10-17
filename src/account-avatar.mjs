import {createHash} from 'node:crypto';
import {Avatar,Style} from '@dicebear/core';
import thumbs from '@dicebear/styles/thumbs.json' with {type:'json'};

// DiceBear core: MIT; Thumbs artwork: CC0 1.0.
// Generated locally, with no account information sent to an avatar service.
const style=new Style(thumbs),cache=new Map();
export function defaultAccountAvatar(user,serverURL){
 if(!user?.id || !user.username || user.avatarUrl)return null;
 const seed=createHash('sha256').update(JSON.stringify(['kuneco-avatar-v1',serverURL,user.id])).digest('hex');
 if(!cache.has(seed)){
  const svg=new Avatar(style,{seed,size:128}).toString();
  if(cache.size>=128)cache.delete(cache.keys().next().value);
  cache.set(seed,'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'));
 }
 return cache.get(seed);
}
