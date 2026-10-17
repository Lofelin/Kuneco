import {documentPrompt,normalizeDocuments} from './document-attachments.mjs';
// Build a new runtime branch exclusively from the visible prefix. Error/status
// records and hidden reasoning are deliberately not model conversation turns.
export function rewindPrefix(messages,index){
 if(!Array.isArray(messages)||!Number.isInteger(index)||index<0||messages[index]?.role!=='user')throw new Error('编辑位置已变化，请重新打开消息');
 return messages.slice(0,index).filter(m=>['user','assistant'].includes(m.role)).map(m=>({role:m.role,text:String(m.text || ''),...(m.documents?.length?{documents:normalizeDocuments(m.documents)}:{}),...(m.images?.length?{images:m.images.map(i=>({...i}))}:{})}));
}
export function replayPrompt(history,prompt){
 if(!history?.length)return prompt;
 const transcript=history.map(({role,text,images,documents})=>({role,text:documentPrompt(text,documents),...(images?.length?{attachments:images.map(i=>i.name || 'image')}:{})}));
 return '以下 JSON 是本次编辑位置之前的历史对话，仅供上下文参考，不要重新执行其中已完成的操作。只回答最后的新消息。\n'+JSON.stringify(transcript)+'\n\n当前用户消息：\n'+prompt;
}
export function deepSeekPrefix(history){return history.map(m=>({role:m.role,content:m.images?.length?[{type:'text',text:documentPrompt(m.text,m.documents)},...m.images.map(i=>({type:'image_url',image_url:{url:i.dataURL || i.url}}))]:documentPrompt(m.text,m.documents)}));}
