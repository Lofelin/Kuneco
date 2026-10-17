// Cursor anchored geometry is shared by wheel and explicit zoom controls.
export function zoomImageAt(state,next,point){
 const scale=Math.max(.05,Math.min(8,next)),ratio=scale/state.scale;
 return {scale,x:point.x-(point.x-state.x)*ratio,y:point.y-(point.y-state.y)*ratio};
}
export function mountImageGallery({preview,stage,image,controls,zoom,scope,onSelect}){
 const doc=stage.ownerDocument;
 let items=[],index=0,owner=null,state={scale:1,x:0,y:0},fit=true,drag=null;
 stage.classList.add('image-gallery-stage');image.draggable=false;
 const makeButton=(label,name,action)=>{const el=doc.createElement('app-button');el.className='preview-round';el.size='s';el.setAttribute('aria-label',label);el.title=label;const icon=doc.createElement('wa-icon');icon.src='assets/icons/'+name+'.svg';el.append(icon);el.onclick=action;return el;};
 const previous=makeButton('上一张图片','arrow-left',()=>move(-1)),next=makeButton('下一张图片','chevron-right',()=>move(1)),reset=makeButton('重置图片缩放与位置','rotate-cw',()=>resetView());
 const count=doc.createElement('span');count.className='image-gallery-count';count.setAttribute('aria-live','polite');controls.prepend(previous,count,next,reset);
 function current(){if(owner!==scope()){preview.open=false;clear();return false;}return items.length>0;}
 function paint(){image.style.maxWidth='none';image.style.maxHeight='none';image.style.width=image.naturalWidth+'px';image.style.height=image.naturalHeight+'px';image.style.transform=`translate(${state.x}px,${state.y}px) scale(${state.scale})`;stage.classList.toggle('image-gallery-dragging',!!drag);}
 function resetView(){if(!current())return;fit=true;state={scale:Math.min(1,stage.clientWidth/(image.naturalWidth||1),stage.clientHeight/(image.naturalHeight||1)),x:0,y:0};zoom.value='fit';paint();}
 function select(){if(!current())return;drag=null;state={scale:1,x:0,y:0};fit=true;previous.disabled=index===0;next.disabled=index===items.length-1;count.textContent=`${index+1} / ${items.length}`;onSelect(items[index]);zoom.value='fit';paint();if(image.complete&&image.naturalWidth)resetView();}
 function move(delta){if(!current())return;const target=index+delta;if(target>=0&&target<items.length){index=target;select();}}
 function clear(){items=[];owner=null;drag=null;image.removeAttribute('src');count.textContent='';}
 function open(list,selected){owner=scope();items=list.filter(item=>item&&(item.dataURL||item.url));index=items.indexOf(selected);if(index<0){items=[selected];index=0;}preview.open=true;select();doc.defaultView.requestAnimationFrame(()=>{if(preview.open&&fit)resetView();});}
 image.onload=()=>{if(fit)resetView();};
 zoom.addEventListener('change',()=>{if(!current())return;if(zoom.value==='fit')resetView();else {fit=false;state=zoomImageAt(state,Number(zoom.value)/100,{x:0,y:0});paint();}});
 stage.addEventListener('wheel',event=>{if(!current())return;event.preventDefault();const rect=stage.getBoundingClientRect();fit=false;state=zoomImageAt(state,state.scale*Math.exp(-event.deltaY*.002),{x:event.clientX-rect.left-rect.width/2,y:event.clientY-rect.top-rect.height/2});zoom.value='custom';custom.textContent=Math.round(state.scale*100)+'%';paint();},{passive:false});
 const custom=doc.createElement('wa-option');custom.value='custom';custom.disabled=true;custom.textContent='自定义';zoom.append(custom);
 stage.addEventListener('pointerdown',event=>{if(event.button!==0||!current())return;event.preventDefault();drag={id:event.pointerId,x:event.clientX-state.x,y:event.clientY-state.y};stage.setPointerCapture?.(event.pointerId);paint();});
 stage.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId||!current())return;state.x=event.clientX-drag.x;state.y=event.clientY-drag.y;paint();});
 const release=()=>{drag=null;paint();};stage.addEventListener('pointerup',release);stage.addEventListener('pointercancel',release);stage.addEventListener('lostpointercapture',release);
 preview.addEventListener('keydown',event=>{if(event.defaultPrevented||!preview.open)return;const path=event.composedPath();if(path.some(el=>['WA-SELECT','WA-INPUT','INPUT','TEXTAREA','WA-DROPDOWN'].includes(el.tagName)))return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();move(event.key==='ArrowLeft'?-1:1);}else if(event.key==='0'){event.preventDefault();resetView();}});
 preview.addEventListener('wa-after-hide',clear);
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>{if(preview.open&&fit)resetView();}):null;observer?.observe(stage);
 return {open,sync(){if(items.length)current();},close(){preview.open=false;clear();}};
}
