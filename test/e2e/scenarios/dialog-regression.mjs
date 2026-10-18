import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';


// Navigate through the real handlers before measuring a dialog inside a page.
async function prepareDialog(target){
 const d=typeof target==='number'?document.querySelectorAll('app-dialog')[target]:document.getElementById(target);
 const wait=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const visible=async element=>{for(let i=0;i<1000&&!element.getBoundingClientRect().height;i++)await new Promise(r=>setTimeout(r,10));if(!element.getBoundingClientRect().height)throw Error(d.id+' parent remained hidden');};
 if(d.id==='deepseekImagePreview'){
  document.querySelector('[data-page="cc"]').click();
  const state=await workspace.state(),view=state.chatViews.find(view=>view.messages?.some(message=>message.images?.length));
  if(!view)throw Error('Missing real image history for preview lifecycle');
  document.querySelector(`#sessionList [data-session-id="${view.id}"]`).click();
  for(let i=0;i<1000;i++){const current=await workspace.state();if(current.activeAISessionId===view.id&&document.querySelector('#chat .message-image'))break;await new Promise(r=>setTimeout(r,10));}
  if((await workspace.state()).activeAISessionId!==view.id||!document.querySelector('#chat .message-image'))throw Error('Image chat did not become ready');
  return;
 }
 const page=d.closest('[id^=page-]');if(page?.classList.contains('hidden')){const name=page.id.slice(5);if(name==='overview'){document.getElementById('accountTrigger').shadowRoot.querySelector('button').click();await wait();document.getElementById('accountSettings').click();}else{const nav=document.querySelector(`[data-page="${name}"]`);if(!nav)throw Error('Missing navigation to '+name);nav.click();}await visible(page);}
 const panel=d.closest('.settings-panel[data-panel]');if(panel){document.querySelector(`[data-setting="${panel.dataset.panel}"]`).click();await visible(panel);if(panel.dataset.panel==='git'){for(let i=0;i<1000&&document.getElementById('gitKeyDescription').getAttribute('aria-busy')==='true';i++)await new Promise(r=>setTimeout(r,10));if(document.getElementById('gitKeyDescription').getAttribute('aria-busy')==='true')throw Error('Git settings remained loading');}}
}

// Former app-dialog-smoke: run on every dialog already mounted by the real renderer.
export async function verifyDialogRegression(ctx){
 const e=(fn,...args)=>ctx.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
 const inventory=await e(()=>[...document.querySelectorAll('app-dialog')].map(d=>({id:d.id,label:d.label})));
 assert(inventory.length>=21,'the actual renderer mounts the static and dynamic dialog inventory');
 const evidence=[];
 for(let index=0;index<inventory.length;index++){
  await e(prepareDialog,index);
  const result=await e(async index=>{
   const d=document.querySelectorAll('app-dialog')[index],wasCustom=d.hasAttribute('custom-close'),withoutHeader=d.withoutHeader;
   const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const show=async()=>{if(d.id==='deepseekImagePreview'){const shown=new Promise(resolve=>d.addEventListener('wa-after-show',resolve,{once:true}));document.querySelector('#chat .message-image').click();await shown;await wait();}else await d.show();};
   const close=async action=>{await action();for(let i=0;i<80&&(d.open||d.dialog.open);i++)await new Promise(r=>setTimeout(r,10));if(d.open||d.dialog.open||d.dialog.matches(':modal'))throw Error(d.id+' retained modal');};
   try{
    d.removeAttribute('custom-close');d.withoutHeader=false;await d.updateComplete;await show();await wait();
    const header=d.shadowRoot.querySelector('[part=header]'),footer=d.shadowRoot.querySelector('[part=footer]'),backdrop=getComputedStyle(d.dialog,'::backdrop');
    const result={id:d.id,backdrop:backdrop.backgroundColor,filter:backdrop.backdropFilter,header:getComputedStyle(header).borderBottomWidth,footer:getComputedStyle(footer).borderTopWidth,hasFooter:Boolean(d.querySelector(':scope>[slot=footer]')),headerWidth:header.getBoundingClientRect().width,footerWidth:footer.getBoundingClientRect().width};
    const closeButton=d.shadowRoot.querySelector('.close');await closeButton.updateComplete;await close(()=>closeButton.shadowRoot.querySelector('button').click());
    await show();await close(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
    await show();await close(()=>{d.open=false;});
    await show();let hides=0;const listener=event=>{if(event.target===d)hides++;};d.addEventListener('wa-after-hide',listener);await close(()=>Promise.all([d.hide(),d.hide()]));d.removeEventListener('wa-after-hide',listener);result.hides=hides;
    await show();const prevent=event=>event.preventDefault();d.addEventListener('wa-hide',prevent);await d.hide();result.prevented=d.open&&d.dialog.open;d.removeEventListener('wa-hide',prevent);await close(()=>d.hide());return result;
   }finally{if(d.open)await d.hide();if(wasCustom)d.setAttribute('custom-close','');d.withoutHeader=withoutHeader;}
  },index);
  assert.equal(result.backdrop,'rgba(160, 165, 175, 0.18)',result.id);assert.equal(result.filter,'blur(4px)',result.id);assert.ok(result.headerWidth>0,result.id+' rendered header');
  if(result.id!=='deepseekImagePreview')assert.equal(result.header,'1px',result.id);
  if(result.hasFooter){assert.equal(result.footer,'1px',result.id);assert(Math.abs(result.headerWidth-result.footerWidth)<1,result.id);}
  assert.equal(result.hides,1,result.id);assert.equal(result.prevented,true,result.id);evidence.push(result);
 }
 const actual=[['gitPublicKeyDialog','gitPublicKeyClose'],['gitKeyDialog','gitKeyDialogClose'],['learningDialog','learningCancel'],['deepseekImageDialog','deepseekImageCancel'],['deepseekImagePreview','[aria-label="关闭图片预览"]'],['browserSiteDataDialog','browserSiteClose'],['browserClearDialog','browserClearCancel']];
 for(const [id,selector]of actual){
  await e(prepareDialog,id);
  await e(async(id,selector)=>{const d=document.getElementById(id);if(!d)throw Error('Missing real module dialog '+id);if(id==='deepseekImagePreview'){document.querySelector('#chat .message-image').click();for(let i=0;i<200&&!d.dialog.open;i++)await new Promise(r=>setTimeout(r,10));}else await d.show();const b=selector.startsWith('[')?d.querySelector(selector):document.getElementById(selector);await b.updateComplete;if(b.disabled)throw Error(id+' close disabled');b.shadowRoot.querySelector('button').click();},id,selector);
  await ctx.until(()=>e(id=>{const d=document.getElementById(id);return !d.open&&!d.dialog.open;},id));
 }
 assert.equal(await e(()=>document.getElementById('connect').getForm()?.id),'proxyForm');
 await mkdir('artifacts/dialog-regression',{recursive:true});await writeFile(path.resolve('artifacts/dialog-regression/results.json'),JSON.stringify({pass:true,source:'real renderer mounted dialogs',inventory,evidence,businessCloseHandlers:actual.length},null,2));
 console.log('PASS all mounted dialog lifecycles: '+inventory.length+' shells and '+actual.length+' real business close handlers');
}
