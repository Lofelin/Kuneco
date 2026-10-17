export function recoverDeepSeekMessages(saved,history){
 if(!Array.isArray(history))return saved;
 const recovered=history.filter(m=>['user','assistant'].includes(m.role)).map(m=>{const parts=Array.isArray(m.content)?m.content:[];const text=typeof m.content==='string'?m.content:parts.filter(p=>p.type==='text').map(p=>p.text).join('\n');const images=parts.filter(p=>p.type==='image_url').map(p=>({name:'image.png',...(p.image_url.url.startsWith('data:')?{dataURL:p.image_url.url}:{url:p.image_url.url})}));return {role:m.role,text,...(images.length?{images}:{})};});
 const messages=saved || [];if(recovered.length<=messages.length)return messages;
 // Only append a proven continuation; never replace a divergent UI transcript.
 const clean=text=>String(text || '').replace(/\n?\[图片：[^\]]*\]/g,'').trim();
 if(!messages.every((m,i)=>m.role===recovered[i]?.role && clean(m.text)===clean(recovered[i].text)))return messages;
 return [...messages,...recovered.slice(messages.length)];
}
