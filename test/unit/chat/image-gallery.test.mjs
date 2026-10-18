import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountImageGallery,zoomImageAt} from '../../../src/features/chat/image-gallery.mjs';
test('wheel zoom preserves the image coordinate under the cursor and clamps magnification',()=>{
 const state={scale:2,x:30,y:-20},point={x:130,y:60},next=zoomImageAt(state,4,point);
 assert.equal((point.x-next.x)/next.scale,(point.x-state.x)/state.scale);
 assert.equal((point.y-next.y)/next.scale,(point.y-state.y)/state.scale);
 assert.equal(zoomImageAt(state,99,point).scale,8);
});
test('gallery traverses only its snapshot, resets transforms, and clears on scope changes',()=>{
 const dom=new JSDOM('<app-dialog><div id="controls"></div><wa-select></wa-select><div id="stage"><img></div></app-dialog>',{pretendToBeVisual:true});
 const doc=dom.window.document,preview=doc.querySelector('app-dialog'),stage=doc.querySelector('#stage'),image=doc.querySelector('img'),controls=doc.querySelector('#controls'),zoom=doc.querySelector('wa-select');
 Object.defineProperties(stage,{clientWidth:{value:400},clientHeight:{value:300}});Object.defineProperties(image,{naturalWidth:{value:800},naturalHeight:{value:600}});
 let scope='account/env/chat-a',selected;
 const gallery=mountImageGallery({preview,stage,image,controls,zoom,scope:()=>scope,onSelect:item=>{selected=item;image.src=item.url;}});
 const a={url:'https://example.com/a.png'},b={url:'https://example.com/b.png'};
 gallery.open([a,b],a);assert.equal(selected,a);assert.equal(controls.querySelector('span').textContent,'1 / 2');
 preview.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(selected,b);
 for(const type of ['wa-hide','wa-after-hide'])zoom.dispatchEvent(new dom.window.Event(type,{bubbles:true}));assert.equal(image.src,b.url);assert.equal(controls.querySelector('span').textContent,'2 / 2');
 stage.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaY:-100,clientX:100,clientY:100,cancelable:true}));assert.match(image.style.transform,/scale\(/);assert.equal(zoom.value,'custom');const custom=zoom.querySelector('[value=custom]')||Array.from(zoom.children).find(o=>o.value==='custom');assert.match(custom.label,/^\d+%$/);assert.notEqual(custom.disabled,true);
 controls.querySelector('[aria-label="重置图片缩放与位置"]').click();assert.equal(image.style.transform,'translate(0px,0px) scale(0.5)');
 scope='account/env/chat-b';gallery.sync();assert.equal(preview.open,false);assert.equal(image.hasAttribute('src'),false);
 gallery.open([],b);assert.equal(controls.querySelector('span').textContent,'1 / 1');assert.equal(controls.querySelector('[aria-label="下一张图片"]').disabled,true);
 dom.window.close();
});

function interactiveGallery(){
 const dom=new JSDOM('<app-dialog><div id="controls"></div><wa-select></wa-select><div id="stage"><img></div></app-dialog>',{pretendToBeVisual:true});
 const doc=dom.window.document,preview=doc.querySelector('app-dialog'),stage=doc.querySelector('#stage'),image=doc.querySelector('img'),zoom=doc.querySelector('wa-select');
 let width=400,height=300,resize;
 Object.defineProperties(stage,{clientWidth:{get:()=>width},clientHeight:{get:()=>height}});
 Object.defineProperties(image,{naturalWidth:{value:800},naturalHeight:{value:600}});
 const captured=new Set();stage.setPointerCapture=id=>captured.add(id);stage.hasPointerCapture=id=>captured.has(id);stage.releasePointerCapture=id=>captured.delete(id);
 dom.window.ResizeObserver=class{constructor(callback){resize=callback;}observe(){}};
 const gallery=mountImageGallery({preview,stage,image,controls:doc.querySelector('#controls'),zoom,scope:()=>1,onSelect:item=>{image.src=item.url;}});
 const item={url:'https://example.com/a.png'};gallery.open([item],item);
 const pointer=(type,x,y,id=1)=>{const event=new dom.window.MouseEvent(type,{button:0,clientX:x,clientY:y,cancelable:true});Object.defineProperty(event,'pointerId',{value:id});stage.dispatchEvent(event);};
 const magnify=value=>{zoom.value=String(value);zoom.dispatchEvent(new dom.window.Event('change'));};
 return {dom,preview,stage,image,zoom,gallery,pointer,magnify,captured,resize:(w,h)=>{width=w;height=h;resize();}};
}

test('dragging has a 4px dead zone and cannot pan past the image edges',()=>{
 const f=interactiveGallery();try{
  f.magnify(100);f.pointer('pointerdown',100,100);assert.ok(f.captured.has(1));
  f.pointer('pointermove',102,102);assert.equal(f.image.style.transform,'translate(0px,0px) scale(1)');assert.equal(f.stage.classList.contains('image-gallery-dragging'),false);
  f.pointer('pointermove',104,100);assert.equal(f.image.style.transform,'translate(4px,0px) scale(1)');assert.ok(f.stage.classList.contains('image-gallery-dragging'));
  f.pointer('pointermove',10000,-10000);assert.equal(f.image.style.transform,'translate(200px,-150px) scale(1)');
  f.pointer('pointerup',10000,-10000,2);assert.ok(f.captured.has(1));
  f.pointer('pointerup',10000,-10000);assert.equal(f.captured.size,0);assert.equal(f.stage.classList.contains('image-gallery-dragging'),false);
  f.magnify(25);assert.equal(f.image.style.transform,'translate(0px,0px) scale(0.25)');
  f.pointer('pointerdown',100,100);f.pointer('pointermove',500,500);assert.equal(f.image.style.transform,'translate(0px,0px) scale(0.25)');
 }finally{f.gallery.close();f.dom.window.close();}
});

test('resize clamps manual pan and refits fitted images; cancel and close release capture',()=>{
 const f=interactiveGallery();try{
  f.magnify(100);f.pointer('pointerdown',100,100);f.pointer('pointermove',300,250);
  f.resize(700,500);assert.equal(f.image.style.transform,'translate(50px,50px) scale(1)');assert.equal(f.captured.size,0);
  f.pointer('pointerdown',100,100);f.pointer('pointercancel',100,100);assert.equal(f.captured.size,0);
  f.pointer('pointerdown',100,100);f.pointer('lostpointercapture',100,100);assert.equal(f.captured.size,0);
  f.pointer('pointerdown',100,100);f.preview.dispatchEvent(new f.dom.window.Event('wa-hide'));assert.equal(f.captured.size,0);
  f.zoom.value='fit';f.zoom.dispatchEvent(new f.dom.window.Event('change'));f.resize(200,150);assert.equal(f.image.style.transform,'translate(0px,0px) scale(0.25)');
  f.pointer('pointerdown',100,100);f.gallery.close();assert.equal(f.captured.size,0);assert.equal(f.image.hasAttribute('src'),false);
 }finally{f.dom.window.close();}
});
