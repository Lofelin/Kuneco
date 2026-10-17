// After restoring history there is no live request to finish a pending user turn.
export function restoredChatStatus(view){
 const messages=view?.messages || [];
 if(view?.chatStatus==='running')return 'failed';
 const last=messages.findLast(message=>message.role==='user' || message.role==='error' || (message.role==='assistant' && message.text?.trim()));
 if(last?.role==='user' || last?.role==='error')return 'failed';
 if(view?.chatStatus==='failed')return 'failed';
 if(last?.role==='assistant')return 'done';
 return view?.chatStatus || 'idle';
}
