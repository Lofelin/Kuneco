// Cursor anchored geometry is shared by wheel and explicit zoom controls.
export function zoomImageAt(state,next,point){
 const scale=Math.max(.05,Math.min(8,next)),ratio=scale/state.scale;
 return {scale,x:point.x-(point.x-state.x)*ratio,y:point.y-(point.y-state.y)*ratio};
}
// Keep each image edge reachable; images smaller than the viewport stay centered.
export function clampImagePan(state,{width,height,viewportWidth,viewportHeight}){
 const limitX=Math.max(0,(width*state.scale-viewportWidth)/2),limitY=Math.max(0,(height*state.scale-viewportHeight)/2);
 return {...state,x:Math.max(-limitX,Math.min(limitX,state.x)),y:Math.max(-limitY,Math.min(limitY,state.y))};
}
export function mountImageGallery({preview,stage,image,controls,zoom,scope,onSelect,labels={}}){
 const doc=stage.ownerDocument;
 zoom.classList.add('image-gallery-zoom');
 let items=[],index=0,owner=null,state={scale:1,x:0,y:0},fit=true,drag=null;
 stage.classList.add('image-gallery-stage');image.draggable=false;
 const makeButton=(label,name,action)=>{const el=doc.createElement('app-button');el.className='preview-round';el.size='s';el.setAttribute('aria-label',label);el.title=label;const icon=doc.createElement('wa-icon');icon.src='assets/icons/'+name+'.svg';el.append(icon);el.onclick=action;return el;};
 const previous=makeButton(labels.previous||'上一张图片','arrow-left',()=>move(-1)),next=makeButton(labels.next||'下一张图片','chevron-right',()=>move(1)),reset=makeButton(labels.reset||'重置图片缩放与位置','rotate-cw',()=>resetView());
 const count=doc.createElement('span');count.className='image-gallery-count';count.setAttribute('aria-live','polite');controls.prepend(previous,count,next,reset);
 function current(){if(owner!==scope()){preview.open=false;clear();return false;}return items.length>0;}
 function paint(){state=clampImagePan(state,{width:image.naturalWidth,height:image.naturalHeight,viewportWidth:stage.clientWidth,viewportHeight:stage.clientHeight});image.style.maxWidth='none';image.style.maxHeight='none';image.style.width=image.naturalWidth+'px';image.style.height=image.naturalHeight+'px';image.style.transform=`translate(${state.x}px,${state.y}px) scale(${state.scale})`;stage.classList.toggle('image-gallery-dragging',!!drag?.active);}
 function release(event){if(!drag||(event?.pointerId!=null&&event.pointerId!==drag.id))return;const id=drag.id;drag=null;try{if(stage.hasPointerCapture?.(id))stage.releasePointerCapture(id);}catch{/* The pointer may already have been released by the browser. */}paint();}
 function resetView(){if(!current())return;release();fit=true;state={scale:Math.min(1,stage.clientWidth/(image.naturalWidth||1),stage.clientHeight/(image.naturalHeight||1)),x:0,y:0};zoom.value='fit';paint();}
 function select(){if(!current())return;release();state={scale:1,x:0,y:0};fit=true;previous.disabled=index===0;next.disabled=index===items.length-1;count.textContent=`${index+1} / ${items.length}`;onSelect(items[index]);zoom.value='fit';paint();if(image.complete&&image.naturalWidth)resetView();}
 function move(delta){if(!current())return;const target=index+delta;if(target>=0&&target<items.length){index=target;select();}}
 function clear(){release();items=[];owner=null;image.removeAttribute('src');count.textContent='';}
 function open(list,selected){owner=scope();items=list.filter(item=>item&&(item.dataURL||item.url));index=items.indexOf(selected);if(index<0){items=[selected];index=0;}preview.open=true;select();doc.defaultView.requestAnimationFrame(()=>{if(preview.open&&fit)resetView();});}
 image.onload=()=>{if(!current())return;if(fit)resetView();else paint();};
 zoom.addEventListener('change',()=>{if(!current())return;release();if(zoom.value==='fit')resetView();else if(zoom.value!=='custom'){fit=false;state=zoomImageAt(state,Number(zoom.value)/100,{x:0,y:0});paint();}});
 stage.addEventListener('wheel',event=>{if(!current())return;event.preventDefault();release();const rect=stage.getBoundingClientRect();fit=false;state=zoomImageAt(state,state.scale*Math.exp(-event.deltaY*.002),{x:event.clientX-rect.left-rect.width/2,y:event.clientY-rect.top-rect.height/2});custom.label=Math.round(state.scale*100)+'%';custom.textContent=custom.label;zoom.value='custom';paint();},{passive:false});
 const custom=doc.createElement('wa-option');custom.value='custom';custom.label='自定义';custom.textContent=custom.label;zoom.append(custom);
 stage.addEventListener('pointerdown',event=>{if(event.button!==0||drag||!current())return;event.preventDefault();drag={id:event.pointerId,startX:event.clientX,startY:event.clientY,x:state.x,y:state.y,active:false};try{stage.setPointerCapture?.(event.pointerId);}catch{/* Detached stages cannot capture a pointer. */}});
 stage.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId||!current())return;const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;if(!drag.active&&Math.hypot(dx,dy)<4)return;drag.active=true;state.x=drag.x+dx;state.y=drag.y+dy;paint();});
 stage.addEventListener('pointerup',release);stage.addEventListener('pointercancel',release);stage.addEventListener('lostpointercapture',release);
 preview.addEventListener('keydown',event=>{if(event.defaultPrevented||!preview.open)return;const path=event.composedPath();if(path.some(el=>['WA-SELECT','WA-INPUT','INPUT','TEXTAREA','WA-DROPDOWN'].includes(el.tagName)))return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();move(event.key==='ArrowLeft'?-1:1);}else if(event.key==='0'){event.preventDefault();resetView();}});
 preview.addEventListener('wa-hide',event=>{if(event.target===preview)release();});
 preview.addEventListener('wa-after-hide',event=>{if(event.target===preview)clear();});
 const Observer=doc.defaultView.ResizeObserver||globalThis.ResizeObserver;
 const observer=Observer?new Observer(()=>{if(!preview.open||!current())return;release();if(fit)resetView();else paint();}):null;observer?.observe(stage);
 return {open,sync(){if(items.length)current();},close(){preview.open=false;clear();}};
}
