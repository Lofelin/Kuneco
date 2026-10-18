/*
Adapted collapse interaction from Caho1/open-claude-ui/code-examples/ChatMessageBubbles.tsx.
MIT License

Copyright (c) 2026 Caho1

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// Keep the original payload intact; bound only the text laid out by the browser.
export const PLAIN_MESSAGE_PAGE_SIZE=4000;
export function textRanges(text){
 const ranges=[];
 for(let start=0;start<text.length;){let end=Math.min(start+PLAIN_MESSAGE_PAGE_SIZE,text.length);
  if(end<text.length){const chunk=text.slice(start,end),boundary=Math.max(chunk.lastIndexOf(' '),chunk.lastIndexOf('\n'));if(boundary>PLAIN_MESSAGE_PAGE_SIZE/2)end=start+boundary+1;else if(/[\uD800-\uDBFF]/.test(text[end-1]))end--;}
  ranges.push([start,end]);start=end;
 }return ranges;
}
export function visibleTextRange(heights,top,height){
 let start=0,offset=0;while(start<heights.length-1 && offset+heights[start]<top){offset+=heights[start++];}
 let end=start,bottom=offset;while(end<heights.length && bottom<top+height){bottom+=heights[end++];}
 return {start:Math.max(0,start-1),end:Math.min(heights.length,end+1)};
}
export function renderPlainMessage(node,text){
 node.dataset.rawText=text;
 if(text.length<=PLAIN_MESSAGE_PAGE_SIZE){node.textContent=text;return;}
 const doc=node.ownerDocument,win=doc.defaultView,body=doc.createElement('div');
 let expanded=false,ranges=null,heights=[],frame=0,lastWidth=0;
 body.className='long-message-body';node.classList.add('long-message');
 const toggle=doc.createElement('app-button');toggle.type='button';toggle.setAttribute('appearance','plain');toggle.setAttribute('size','s');toggle.className='long-message-toggle';
 const draw=()=>{
  frame=0;if(!expanded)return;
  const width=body.clientWidth || 600,style=win.getComputedStyle(body),line=parseFloat(style.lineHeight)||24;
  if(width!==lastWidth){
   const ratio=body.scrollTop/Math.max(1,heights.reduce((a,b)=>a+b,0));lastWidth=width;
   const columns=Math.max(1,Math.floor(width/(parseFloat(style.fontSize)||14)*1.8));
   heights=ranges.map(([a,b])=>text.slice(a,b).split('\n').reduce((n,s)=>n+Math.max(1,Math.ceil(s.length/columns)),0)*line);
   body.scrollTop=ratio*heights.reduce((a,b)=>a+b,0);
  }
  const {start,end}=visibleTextRange(heights,body.scrollTop,body.clientHeight||600);
  const spacer=height=>{const el=doc.createElement('div');el.style.height=height+'px';el.setAttribute('aria-hidden','true');return el;};
  const before=spacer(heights.slice(0,start).reduce((a,b)=>a+b,0)),after=spacer(heights.slice(end).reduce((a,b)=>a+b,0)),parts=[];
  for(let i=start;i<end;i++){const el=doc.createElement('div');el.textContent=text.slice(...ranges[i]);parts.push(el);}
  body.replaceChildren(before,...parts,after);
  parts.forEach((el,i)=>{const h=el.getBoundingClientRect().height;if(h)heights[start+i]=h;});
  after.style.height=heights.slice(end).reduce((a,b)=>a+b,0)+'px';
 };
 const schedule=()=>{if(!frame)frame=win.requestAnimationFrame(draw);};
 body.addEventListener('scroll',schedule,{passive:true});
 const observer=win.ResizeObserver?new win.ResizeObserver(()=>{if(expanded)schedule();}):null;observer?.observe(body);
 const render=()=>{
  body.classList.toggle('is-collapsed',!expanded);body.classList.toggle('is-expanded',expanded);toggle.setAttribute('aria-expanded',String(expanded));toggle.textContent=expanded?'收起':'展开';
  if(expanded){ranges ||= textRanges(text);body.tabIndex=0;body.setAttribute('role','region');body.setAttribute('aria-label','完整消息，滚动阅读');draw();}
  else{if(frame){win.cancelAnimationFrame(frame);frame=0;}body.removeAttribute('tabindex');body.removeAttribute('role');body.removeAttribute('aria-label');body.scrollTop=0;lastWidth=0;body.textContent=text.slice(0,PLAIN_MESSAGE_PAGE_SIZE);}
 };
 toggle.onclick=()=>{expanded=!expanded;render();};node.replaceChildren(body,toggle);render();
}
