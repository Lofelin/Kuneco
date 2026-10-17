export function mountAssistantImagePreviews({root,context,read,preview}){
 const pending=new WeakMap();
 async function scan(){
  for(const content of root.querySelectorAll('.bubble.assistant>.markdown-body')){
   const paths=[...new Set([...content.querySelectorAll('code,a')].map(el=>el.tagName==='A'?el.getAttribute('href'):el.textContent).filter(p=>/^\/[^\0\n]+\.(png|jpe?g|gif|webp)$/i.test(p || '')))];
   for(const path of paths){
    const scope=context(),key=JSON.stringify([scope,path]);let entries=pending.get(content);if(!entries)pending.set(content,entries=new Map());
    if(content.querySelectorAll('[data-assistant-image]').length && [...content.querySelectorAll('[data-assistant-image]')].some(el=>el.imagePath===path))continue;
    if(entries.has(key))continue;entries.set(key,true);
    const text=content.dataset.rawText;
    try{
     const image=await read({path,...scope});if(!content.isConnected || text!==content.dataset.rawText || JSON.stringify(context())!==JSON.stringify(scope))continue;
     const button=document.createElement('app-button');button.setAttribute('layout','custom');button.className='message-image assistant-image-preview';button.dataset.assistantImage='';button.imagePath=path;button.previewImage=image;button.setAttribute('aria-label','预览图片 '+image.name);
     const img=document.createElement('img');img.src=image.dataURL;img.alt=image.name;button.append(img);button.onclick=()=>preview(image);content.append(button);
    }catch{/* Keep the original path/link available when the file has moved or is unavailable. */}
    finally{entries.delete(key);}
   }
  }
 }
 const observer=new MutationObserver(()=>void scan());observer.observe(root,{childList:true,subtree:true});void scan();return ()=>observer.disconnect();
}
