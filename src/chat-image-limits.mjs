// These are per-message image transport safeguards, never an account/history quota.
export const CHAT_IMAGE_MAX_BYTES=64*1024*1024;
export const CHAT_IMAGE_BUDGET=280*1024*1024;
export function validateChatImages(files,{draftBytes=0}={}){
 let added=0;
 for(const file of files){if(file.size>CHAT_IMAGE_MAX_BYTES)throw new Error(`图片“${file.name || '粘贴的图片'}”超过单张 64 MiB，未添加。请缩小图片后重试。`);added+=4*Math.ceil(file.size/3)+1024;}
 if(draftBytes+added>CHAT_IMAGE_BUDGET)throw new Error('本次发送的图片总量过大，未添加。请分批发送。');
}
