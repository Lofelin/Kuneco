import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

function pdf(){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',...['First page','Second page'].map(t=>{const s=`BT /F1 32 Tf 60 700 Td (${t}) Tj ET`;return `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;})];
 let text='%PDF-1.4\n',offsets=[0];objects.forEach((s,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${s}\nendobj\n`;});const xref=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(text).toString('base64');
}
/** Run after workspace.mjs creates its guest Codex session, before settings/account switches. */
export async function verifyChatInteraction(context){
 const {evaluate:expression,until,client,captureUI}=context;
 const evaluate=(fn,...args)=>expression(`(${fn.toString()})(...${JSON.stringify(args)})`);
 const tick=()=>evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const output=path.resolve('artifacts/chat-interaction-polish');await mkdir(output,{recursive:true});
 const capture=async name=>{const screenshot=await captureUI();await writeFile(path.join(output,name+'.png'),Buffer.from(screenshot.data,'base64'));};
 const initial=await evaluate(()=>({url:location.href,theme:document.body.className,column:document.querySelector('.chat-column')?.getAttribute('style'),effortHidden:document.getElementById('sessionEffort')?.hidden,attachments:document.querySelectorAll('#deepseekAttachments .attachment-removable').length}));
 assert.match(initial.url,/\/src\/index\.html(?:[?#]|$)/,'must execute in the real Kuneco main page');
 assert.equal(initial.attachments,0,'run before adding drafts to the isolated desktop-test session');
 const readiness=()=>evaluate(()=>({chatVisible:!document.getElementById('page-cc').classList.contains('hidden'),models:document.querySelectorAll('#sessionModel wa-option').length,efforts:document.querySelectorAll('#sessionEffort wa-option').length,modelDisabled:document.getElementById('sessionModel').disabled,addMounted:!!document.getElementById('deepseekAddImages'),addHidden:document.getElementById('deepseekAddImages')?.hidden,addDisabled:document.getElementById('deepseekAddImages')?.disabled,galleryMounted:!!document.querySelector('#deepseekImagePreview .image-gallery-stage'),currentSession:document.querySelector('#sessionList [data-session-id].active')?.dataset.sessionId||null}));
 // Closing a blank tab removes its DOM before asynchronous session activation ends.
 await until(async()=>{const state=await readiness();return state.chatVisible&&state.models>0&&state.efforts>0&&!state.modelDisabled&&state.addMounted&&!state.addHidden&&!state.addDisabled&&state.galleryMounted;}).catch(async error=>{throw new Error('Real composer did not become ready after guest session activation: '+JSON.stringify(await readiness())+'; '+error.message);});
 const widths=[];let primaryError;
 try{
async function checkZoomMenu(selector,name){
 const labels=await evaluate(async selector=>{
  const zoom=document.querySelector(selector),option=zoom.querySelector('[value=custom]'),measure=document.createElement('canvas').getContext('2d'),result=[];
  for(const text of ['适应窗口','68%','100%','800%']){
   option.label=text;option.textContent=text;zoom.value='custom';await option.updateComplete;await zoom.updateComplete;await new Promise(r=>requestAnimationFrame(r));
   const input=zoom.shadowRoot.querySelector('[part~=display-input]'),style=getComputedStyle(input);measure.font=style.font;
   result.push({text,value:input.value,width:zoom.getBoundingClientRect().width,available:input.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),needed:measure.measureText(text).width});
  }
  zoom.value='fit';zoom.dispatchEvent(new Event('change'));await zoom.updateComplete;return result;
 },selector);
 for(const label of labels){assert.equal(label.value,label.text);assert.equal(label.width,120);assert(label.needed<=label.available,JSON.stringify(label));}
 for(const dark of [false,true]){
  await evaluate(async(selector,dark)=>{document.body.classList.toggle('dark',dark);document.body.classList.toggle('wa-dark',dark);document.body.classList.toggle('wa-light',!dark);const zoom=document.querySelector(selector);await zoom.show();},selector,dark);await until(()=>evaluate(selector=>{const zoom=document.querySelector(selector),list=zoom.shadowRoot.querySelector('[part~=listbox]'),rect=list.getBoundingClientRect();return zoom.open&&rect.width>0&&rect.height>0;},selector));await tick();
  const menu=await evaluate(selector=>{const zoom=document.querySelector(selector),list=zoom.shadowRoot.querySelector('[part~=listbox]');return {trigger:zoom.getBoundingClientRect().width,width:list.getBoundingClientRect().width,radius:getComputedStyle(list).borderRadius,options:[...zoom.querySelectorAll('wa-option')].map(option=>{const label=option.shadowRoot.querySelector('[part~=label]'),style=getComputedStyle(label),range=document.createRange();range.selectNodeContents(label);return {text:option.textContent,height:range.getBoundingClientRect().height,labelWidth:label.getBoundingClientRect().width,textWidth:range.getBoundingClientRect().width,whiteSpace:style.whiteSpace,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight};})};},selector);
  assert(Math.abs(menu.trigger-120)<1);assert(menu.width>=128,JSON.stringify({name,dark,menu}));assert.equal(menu.radius,'14px');
  for(const option of menu.options){assert.equal(option.whiteSpace,'nowrap');assert(option.height<=19,JSON.stringify(option));assert(option.textWidth<=option.labelWidth+.5,JSON.stringify(option));assert.equal(option.fontSize,'12px');assert.equal(option.fontWeight,'400');assert.equal(option.lineHeight,'18px');}
  await capture(name+(dark?'-dark':'-light'));await evaluate(async selector=>{const zoom=document.querySelector(selector);zoom.querySelector('[value="100"]').dispatchEvent(new MouseEvent('mouseup',{bubbles:true,composed:true,button:0}));await zoom.updateComplete;await zoom.hide();},selector);await until(()=>evaluate(selector=>{const zoom=document.querySelector(selector),rect=zoom.shadowRoot.querySelector('[part~=listbox]').getBoundingClientRect();return !zoom.open&&rect.width===0&&rect.height===0;},selector));await tick();
  assert(await evaluate(selector=>{const zoom=document.querySelector(selector),dialog=zoom.closest('app-dialog'),image=dialog?.querySelector('img');return zoom.value==='100'&&dialog.open&&image?.hasAttribute('src')&&image.naturalWidth>0;},selector),'Choosing zoom must keep the preview and original image alive');
 }

}
 for(const width of [600,576,480,384,320,280])for(const effort of [true,false]){
  await evaluate((width,effort)=>{const column=document.querySelector('.chat-column');column.style.width=width+'px';column.style.flex='0 0 '+width+'px';document.getElementById('sessionEffort').hidden=!effort;},width,effort);await tick();
  const geometry=await evaluate(()=>{const form=document.getElementById('chatForm').getBoundingClientRect();return [...document.querySelectorAll('.compose-footer app-button,.compose-footer wa-select')].filter(element=>!element.hidden&&element.getBoundingClientRect().width).map(element=>{const r=element.getBoundingClientRect();return {id:element.id,left:r.left-form.left,right:r.right-form.left,width:r.width,bottom:r.bottom,formWidth:form.width,formBottom:form.bottom};});});
  for(const g of geometry){assert(g.width>10,JSON.stringify(g));assert(g.left>=-.5&&g.right<=g.formWidth+.5,JSON.stringify({width,effort,g}));assert(g.bottom<=g.formBottom+.5,JSON.stringify(g));}
  widths.push({width,effort,geometry});if(effort&&[600,384,280].includes(width))await capture('composer-'+width);
 }
 await evaluate(initial=>{const column=document.querySelector('.chat-column');if(initial.column===null)column.removeAttribute('style');else column.setAttribute('style',initial.column);document.getElementById('sessionEffort').hidden=initial.effortHidden;},initial);await tick();
 const fades=await evaluate(async()=>{const el=document.getElementById('contentTabs'),saved=el.getAttribute('style'),left=el.scrollLeft,tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));try{el.style.width='40px';el.style.maxWidth='40px';el.style.flex='0 0 40px';await tick();const read=()=>({start:parseFloat(getComputedStyle(el).getPropertyValue('--scroll-fade-start')),end:parseFloat(getComputedStyle(el).getPropertyValue('--scroll-fade-end'))});el.scrollLeft=0;await tick();const top=read();el.scrollLeft=(el.scrollWidth-el.clientWidth)/2;await tick();const middle=read();el.scrollLeft=el.scrollWidth;await tick();return {axis:el.dataset.scrollFade,overflow:el.scrollWidth-el.clientWidth,top,middle,bottom:read()};}finally{if(saved===null)el.removeAttribute('style');else el.setAttribute('style',saved);el.scrollLeft=left;}});
 assert.equal(fades.axis,'horizontal');assert(fades.overflow>0,JSON.stringify(fades));assert.equal(fades.top.start,0);assert.equal(fades.bottom.end,0);assert(fades.middle.start>0&&fades.middle.end>0,JSON.stringify(fades));
 // Native DOM paste/drop events exercise the already mounted composer handlers.
 await evaluate(async data=>{
  const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1200;const ctx=canvas.getContext('2d');ctx.fillStyle='#dde9f5';ctx.fillRect(0,0,1600,1200);ctx.fillStyle='#314c70';ctx.font='64px sans-serif';ctx.fillText('Kuneco real composer',120,180);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),transfer=new DataTransfer();transfer.items.add(new File([blob],'desktop-interaction.png',{type:'image/png'}));transfer.items.add(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'desktop-interaction.pdf',{type:'application/pdf'}));
  document.getElementById('prompt').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true,composed:true}));
 },pdf());
 await until(()=>evaluate(()=>!document.getElementById('deepseekAttachments').hidden&&!!document.querySelector('#deepseekAttachments [aria-label="预览图片 desktop-interaction.png"]')&&!!document.querySelector('#deepseekAttachments [aria-label="预览附件 desktop-interaction.pdf"]')));
 await evaluate(async()=>{const button=document.querySelector('#deepseekAttachments [aria-label="预览图片 desktop-interaction.png"]');await button.updateComplete;button.click();});
 await until(()=>evaluate(()=>document.querySelector('#deepseekImagePreview').open&&document.querySelector('#deepseekImagePreview img').naturalWidth===1600));await tick();
 await checkZoomMenu('#deepseekPreviewZoom','image-zoom-menu');
 const backdrop=await evaluate(()=>{const dialog=document.getElementById('deepseekImagePreview').shadowRoot.querySelector('dialog'),style=getComputedStyle(dialog,'::backdrop');return {color:style.backgroundColor,filter:style.backdropFilter};});assert.equal(backdrop.filter,'blur(4px)');assert.equal(backdrop.color,'rgba(160, 165, 175, 0.18)');
 await evaluate(()=>{const zoom=document.getElementById('deepseekPreviewZoom');zoom.value='200';zoom.dispatchEvent(new Event('change'));});
 const stage=await evaluate(()=>{const r=document.querySelector('#deepseekImagePreview .image-gallery-stage').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
 const transform=()=>evaluate(()=>document.querySelector('#deepseekImagePreview img').style.transform),before=await transform();
 const mouse=(type,x,y,extra={})=>client.call('Input.dispatchMouseEvent',{type,x,y,button:'left',...extra});
 await mouse('mouseMoved',stage.x,stage.y);await mouse('mousePressed',stage.x,stage.y,{clickCount:1,buttons:1});await mouse('mouseMoved',stage.x+2,stage.y+1,{buttons:1});await tick();assert.equal(await transform(),before,'real gallery keeps 4px drag dead zone');
 await mouse('mouseMoved',stage.x+140,stage.y+90,{buttons:1});await mouse('mouseReleased',stage.x+140,stage.y+90,{clickCount:1,buttons:0});assert.notEqual(await transform(),before,'real gallery pans after the dead zone');await capture('gallery-drag');
 await evaluate(()=>{const zoom=document.getElementById('deepseekPreviewZoom');zoom.value='fit';zoom.dispatchEvent(new Event('change'));});assert.match(await transform(),/^translate\(0px,\s*0px\)/);
 await evaluate(()=>document.querySelector('#deepseekImagePreview [aria-label="关闭图片预览"]').click());await until(()=>evaluate(()=>{const preview=document.getElementById('deepseekImagePreview'),dialog=preview.shadowRoot.querySelector('dialog');return !preview.open&&!dialog.open&&dialog.getBoundingClientRect().width===0;}));await tick();
 await evaluate(async()=>{const button=document.querySelector('#deepseekAttachments [aria-label="预览附件 desktop-interaction.pdf"]');await button.updateComplete;button.click();});
 await until(()=>evaluate(()=>{const d=document.querySelector('.chat-pdf-preview');return d?.open&&d.querySelector('img')?.naturalWidth>0&&!d.querySelector('img').hidden;}));
 await checkZoomMenu('.chat-pdf-preview wa-select','pdf-zoom-menu');assert.equal(await evaluate(()=>document.querySelector('.chat-pdf-preview .image-gallery-count').textContent),'1 / 2');
 await evaluate(()=>document.querySelector('.chat-pdf-preview [aria-label="下一页"]').click());await until(()=>evaluate(()=>{const dialog=document.querySelector('.chat-pdf-preview');return dialog.querySelector('.image-gallery-count').textContent==='2 / 2'&&dialog.querySelector('.pdf-preview-status').hidden;}));await capture('pdf-second-page');
 await evaluate(()=>document.querySelector('.chat-pdf-preview').hide());await until(()=>evaluate(()=>!document.querySelector('.chat-pdf-preview')));
 // Supplementary local receipts use production renderers inside the real chat;
 // no workspace IPC bridge or runtime/server response is replaced.
 const supplemental=await evaluate(async()=>{
  const [{renderFileDiffs},{renderReviewDiff},{adoptCodeBlocks}]=await Promise.all([import('./features/chat/file-diff.mjs'),import('./features/chat/review-diff.mjs'),import('./features/chat/code-blocks.mjs')]);
  const host=document.createElement('section');host.dataset.desktopInteractionSupplement='';document.getElementById('chat').append(host);
  try{
   const change={path:'local-desktop-receipt.js',before:'line\n'.repeat(5000),after:'line\n'.repeat(5000)+'new\n'};
   renderFileDiffs(host,{changes:[change]});const collapsedDiff=host.querySelectorAll('.diff-line').length;host.querySelector('summary').click();const openedDiff=host.querySelectorAll('.diff-line').length;const modes=host.querySelector('wa-radio-group');await modes.updateComplete;await Promise.all([...modes.querySelectorAll('wa-radio')].map(item=>item.updateComplete));modes.value='split';modes.dispatchEvent(new Event('change'));const columns=host.querySelectorAll('pre').length;
   host.replaceChildren();renderReviewDiff(host,change);const collapsedReview=host.querySelectorAll('.review-code-line').length;await host.querySelector('app-button').updateComplete;host.querySelector('app-button').click();const openedReview=host.querySelectorAll('.review-code-line').length;
   host.replaceChildren();const source='const value = 1;\n',pre=document.createElement('pre'),code=document.createElement('code');code.textContent=source;pre.append(code);host.append(pre);let blocks=adoptCodeBlocks(host);const text=blocks[0].querySelector('code').firstChild;getSelection().setBaseAndExtent(text,0,text,5);const next=document.createElement('pre'),nextCode=document.createElement('code');nextCode.textContent=source+'// appended';next.append(nextCode);host.replaceChildren(next);blocks=adoptCodeBlocks(host,{previous:blocks});await blocks[0].querySelector('[aria-label="显示代码行号"]').updateComplete;blocks[0].querySelector('[aria-label="显示代码行号"]').click();return {collapsedDiff,openedDiff,columns,collapsedReview,openedReview,reused:text===blocks[0].querySelector('code').firstChild,source:blocks[0].querySelector('code').textContent,lines:blocks[0].querySelector('pre').dataset.lines};
  }finally{getSelection().removeAllRanges();host.remove();}
 });
 assert.equal(supplemental.collapsedDiff,0);assert(supplemental.openedDiff>5000);assert.equal(supplemental.columns,2);assert(supplemental.collapsedReview<10);assert(supplemental.openedReview>5000);assert(supplemental.reused);assert.equal(supplemental.source,'const value = 1;\n// appended');assert.equal(supplemental.lines,'1\n2');
 await writeFile(path.join(output,'results.json'),JSON.stringify({mainPage:initial.url,widths,fades,backdrop,supplemental},null,2));
 console.log('PASS real Kuneco chat interactions: mounted composer, native attachment paste, image/PDF previews and supplementary production Diff/code renderers');
 }catch(error){primaryError=error;console.error('Chat interaction primary failure:',error);throw error;}finally{
  try{await evaluate(async initial=>{const column=document.querySelector('.chat-column');if(initial.column===null)column.removeAttribute('style');else column.setAttribute('style',initial.column);document.getElementById('sessionEffort').hidden=initial.effortHidden;document.body.className=initial.theme;document.getElementById('deepseekImagePreview').open=false;document.querySelector('.chat-pdf-preview')?.hide();for(const name of ['desktop-interaction.png','desktop-interaction.pdf']){const button=document.querySelector('#deepseekAttachments [aria-label="移除附件 '+name+'"]');if(button){await button.updateComplete;button.click();}}document.querySelector('[data-desktop-interaction-supplement]')?.remove();},initial);}catch(error){if(primaryError)console.error('Chat interaction cleanup failure:',error);else throw error;}
 }
}
