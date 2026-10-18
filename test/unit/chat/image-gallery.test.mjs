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
 stage.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaY:-100,clientX:100,clientY:100,cancelable:true}));assert.match(image.style.transform,/scale\(/);assert.equal(zoom.value,'custom');const custom=zoom.querySelector('[value=custom]')||Array.from(zoom.children).find(o=>o.value==='custom');assert.match(custom.label,/^\d+%$/);assert.notEqual(custom.disabled,true);
 controls.querySelector('[aria-label="重置图片缩放与位置"]').click();assert.equal(image.style.transform,'translate(0px,0px) scale(0.5)');
 scope='account/env/chat-b';gallery.sync();assert.equal(preview.open,false);assert.equal(image.hasAttribute('src'),false);
 gallery.open([],b);assert.equal(controls.querySelector('span').textContent,'1 / 1');assert.equal(controls.querySelector('[aria-label="下一张图片"]').disabled,true);
 dom.window.close();
});
