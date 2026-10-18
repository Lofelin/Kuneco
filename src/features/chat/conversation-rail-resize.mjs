// Keep the conversation list usable without consuming the chat column.
export function mountConversationRailResize({rail,storage=localStorage}){
 const layout=rail.parentElement,doc=rail.ownerDocument,win=doc.defaultView;
 const divider=doc.createElement('div');divider.className='conversation-rail-splitter';divider.tabIndex=0;
 for(const [name,value] of Object.entries({role:'separator','aria-label':'调整会话列表宽度','aria-orientation':'vertical'}))divider.setAttribute(name,value);
 rail.append(divider);
 let preferred=null,drag=null;
 try{const saved=Number(storage.getItem('conversation-rail-width'));if(saved>0&&Number.isFinite(saved))preferred=saved;}catch{}
 const limits=()=>({min:Math.min(180,Math.max(0,layout.clientWidth-280)),max:Math.max(180,Math.min(480,layout.clientWidth-360))});
 const apply=()=>{const {min,max}=limits();const width=Math.max(min,Math.min(max,preferred??(win.innerWidth<=1150?208:236)));rail.style.width=width+'px';divider.setAttribute('aria-valuemin',String(min));divider.setAttribute('aria-valuemax',String(max));divider.setAttribute('aria-valuenow',String(Math.round(width)));};
 const save=()=>{try{if(preferred===null)storage.removeItem('conversation-rail-width');else storage.setItem('conversation-rail-width',String(preferred));}catch{}};
 const finish=()=>{if(!drag)return;const id=drag.id;drag=null;doc.body.classList.remove('resizing-conversation-rail');if(divider.hasPointerCapture(id))divider.releasePointerCapture(id);save();};
 divider.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();drag={id:e.pointerId,x:e.clientX,width:rail.getBoundingClientRect().width};divider.setPointerCapture(e.pointerId);doc.body.classList.add('resizing-conversation-rail');});
 divider.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const {min,max}=limits();preferred=Math.max(min,Math.min(max,drag.width+e.clientX-drag.x));apply();});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])divider.addEventListener(type,finish);
 win.addEventListener('blur',finish);
 divider.addEventListener('dblclick',()=>{preferred=null;apply();save();});
 divider.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const {min,max}=limits();preferred=e.key==='Home'?min:e.key==='End'?max:Math.max(min,Math.min(max,rail.getBoundingClientRect().width+(e.key==='ArrowLeft'?-20:20)));apply();save();});
 new win.ResizeObserver(apply).observe(layout);win.addEventListener('resize',apply);apply();
}
