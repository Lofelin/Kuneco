import {createHash} from 'node:crypto';
import {generatedAvatar} from '../../shared/ui/generated-avatar.mjs';

// DiceBear core: MIT; Thumbs artwork: CC0 1.0.
// Generated locally, with no account information sent to an avatar service.
export function defaultAccountAvatar(user,serverURL){
 if(!user?.id)return null;
 const seed=createHash('sha256').update(JSON.stringify(['kuneco-avatar-v1',serverURL,user.id])).digest('hex');
 return generatedAvatar(seed);
}
