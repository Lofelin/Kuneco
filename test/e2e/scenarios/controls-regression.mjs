import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

// IDs refer to the assertions in the six removed smoke scripts, in source order.
export const controlsRegressionCoverage = Object.freeze({
 'action-button-layout': ['A1 visible geometry at 1400/800, normal/loading','A2 onboarding 6px padding and actual insets','A3 every semantic icon gap 6px and base column-gap 0','A4 label/parent bounds','A5 real external form association, invalid/valid/disabled/loading'],
 'interaction-border': ['B1 every actual option 12px/400/18px','B2 input/select focus and select-open indicators','B3 20 blur frames preserve default border and remove ring','B4 no border/outline/all transition','B5 no obsolete empty dialog fixture; real form association'],
 'transparent-actions': ['T1 real static/dynamic transparent controls','T2 host/base default, hover, active, mouseout, focus-visible background/border/shadow'],
 'session-model-picker': ['M1 cached registry open remains expanded during and after explicit asynchronous provider refresh','M2 combobox/listbox width equality','M3 toggle/outside/Escape/select close','M4 second model selection persists through IPC'],
 'console-settings': ['C1 manual/automatic connection counts','C2 real settings font size/light/system-dark theme','C3 multiline paste withheld until confirmed','C4 real paste dialog geometry','C5 cancel/Escape with no input','C6 confirmed bracketed paste exact payload','C7 pending paste discarded on real reset','C8 confirmation-disabled immediate paste'],
 preferences: ['Q1 two real running tasks and quit dialog geometry/icons','Q2 cancel and Escape keep application alive','Q3 existing real modal blocks quit without replacement','Q4 final confirmation exits actual application'],
});

function harness(ctx){
 const evaluate=(fn,...args)=>ctx.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
 const tick=()=>evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const point=async selector=>evaluate(async selector=>{
  const host=document.querySelector(selector);if(!host)throw Error('Missing actual application control '+selector);
  await host.updateComplete;host.scrollIntoView({block:'nearest',inline:'nearest'});
  const part=host.localName==='wa-select'?host.shadowRoot?.querySelector('[part~=combobox]'):host.shadowRoot?.querySelector('button');
  const r=(part || host).getBoundingClientRect();if(!r.width || !r.height)throw Error('Actual control is hidden: '+selector);
  return {x:r.left+r.width/2,y:r.top+r.height/2};
 },selector);
 const clickPoint=async p=>{for(const type of ['mouseMoved','mousePressed','mouseReleased'])await ctx.client.call('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});};
 const click=async selector=>{await clickPoint(await point(selector));await tick();};
 const escape=async()=>{for(const type of ['keyDown','keyUp'])await ctx.client.call('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await tick();};
 const setting=async key=>{
  if(!await evaluate(()=>document.getElementById('accountMenu').open))await click('#accountTrigger');
  await ctx.until(()=>evaluate(()=>document.getElementById('accountMenu').open));await click('#accountSettings');
  await click(`[data-setting="${key}"]`);await ctx.until(()=>evaluate(key=>document.querySelector(`.settings-panel[data-panel="${key}"]`).getBoundingClientRect().height>0,key));await tick();
 };
 const closed=id=>ctx.until(()=>evaluate(id=>{const d=document.getElementById(id);return !d.open&&!d.dialog.open;},id));
 const preferences=patch=>patch===undefined?evaluate(()=>workspace.preferences()):evaluate(patch=>workspace.preferences(patch),patch);
 return {evaluate,tick,point,click,clickPoint,escape,setting,closed,preferences};
}

function requireFixture(ctx,name){
 const fixture=ctx.controlsFixture?.[name];assert.ok(fixture,'Real-start controls regression requires controlsFixture.'+name);
 return fixture;
}

/** Actual startup/onboarding nodes must be exposed by real navigation, never reparented. */
async function measureActions(ctx,ids,reveal=async()=>{},finish=async()=>{}){
 const ui=harness(ctx),rows=[],targets=ids.map(id=>({id,selector:'#'+id}));
 try{
  for(const target of targets){
   // The fixture performs the real login/setup/environment/menu steps for this control.
   await reveal(target.id);await ui.tick();
   const old=await ui.evaluate(selector=>{const b=document.querySelector(selector);return {loading:b.loading};},target.selector);
   try{for(const width of [1400,800])for(const loading of [false,true]){
    await ctx.client.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    const row=await ui.evaluate(async(selector,loading)=>{
     const b=document.querySelector(selector);b.loading=loading;await b.updateComplete;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
     const base=b.shadowRoot.querySelector('[part~=base]'),label=b.shadowRoot.querySelector('[part~=label]'),br=base.getBoundingClientRect(),lr=label.getBoundingClientRect(),icon=b.querySelector('wa-icon[slot=start]');
     return {id:b.id,base:br.width,leftInset:icon?icon.getBoundingClientRect().left-br.left-parseFloat(getComputedStyle(base).borderLeftWidth):null,rightInset:br.right-lr.right-parseFloat(getComputedStyle(base).borderRightWidth),paddingLeft:getComputedStyle(base).paddingLeft,paddingRight:getComputedStyle(base).paddingRight,iconGap:icon?getComputedStyle(icon).marginInlineEnd:null,columnGap:getComputedStyle(base).columnGap,overflow:Math.max(0,lr.right-br.right,br.left-lr.left),rowOverflow:b.getBoundingClientRect().right-b.parentElement.getBoundingClientRect().right};
    },target.selector,loading);
    assert.ok(row.base>0,'A1 '+JSON.stringify(row));
    if(['setupRandomName','setupPrepareDocker','setupRefreshExisting'].includes(row.id)){assert.equal(row.paddingLeft,'6px','A2');assert.equal(row.paddingRight,'6px','A2');assert.ok(Math.abs(row.leftInset-6)<1,'A2 '+JSON.stringify(row));assert.ok(Math.abs(row.rightInset-6)<1,'A2 '+JSON.stringify(row));}
    if(row.iconGap!==null)assert.equal(row.iconGap,'6px','A3 '+row.id);assert.equal(row.columnGap,'0px','A3 '+row.id);assert.ok(row.overflow<1,'A4 '+JSON.stringify(row));assert.ok(row.rowOverflow<1,'A4 '+JSON.stringify(row));rows.push({width,loading,...row});
   }}finally{await ui.evaluate(async(selector,old)=>{const b=document.querySelector(selector);b.loading=old.loading;await b.updateComplete;},target.selector,old);await finish(target.id);}
  }
 }finally{await ctx.client.call('Emulation.clearDeviceMetricsOverride');}
 return rows;
}

/** Real, cancellable environment wizard; never clicks setupFinish or creates an environment. */
export async function verifyOnboardingControls(ctx){
 const ui=harness(ctx),output=[];
 await ui.click('[data-page="environments"]');await ui.click('#newEnvironment');
 await ctx.until(()=>ui.evaluate(()=>!document.getElementById('environmentSetup').classList.contains('hidden')));
 try{
  output.push(...await measureActions(ctx,['setupRandomName']));
  await ui.evaluate(async()=>{const name=document.getElementById('setupEnvironmentName');name.value='Controls regression draft';name.dispatchEvent(new Event('input',{bubbles:true}));await name.updateComplete;});
  await ui.click('#setupCreate');await ctx.until(()=>ui.evaluate(()=>!document.getElementById('setupTypeStep').classList.contains('hidden')));
  // newEnvironment starts the real wizard with Docker selected. No install runs.
  output.push(...await measureActions(ctx,['setupPrepareDocker']));
  await ui.evaluate(async()=>{const source=document.getElementById('setupDockerSource');source.value='existing';source.dispatchEvent(new Event('change'));await source.updateComplete;});
  await ctx.until(()=>ui.evaluate(()=>document.getElementById('setupRefreshExisting').getBoundingClientRect().height>0));
  output.push(...await measureActions(ctx,['setupRefreshExisting']));
  await ctx.until(()=>ui.evaluate(()=>[...document.querySelectorAll('#setupExistingContainer wa-option')].some(option=>option.textContent.includes('kuneco-e2e-console-'))));
  await ui.evaluate(async()=>{const select=document.getElementById('setupExistingContainer'),owned=[...select.querySelectorAll('wa-option')].find(option=>option.textContent.includes('kuneco-e2e-console-'));if(!owned)throw Error('Missing owned console fixture container');select.value=owned.value;select.dispatchEvent(new Event('change'));await select.updateComplete;});
  await ui.click('#setupCreate');await ctx.until(()=>ui.evaluate(()=>!document.getElementById('setupDetectView').classList.contains('hidden')));
  await ctx.until(()=>ui.evaluate(()=>!document.getElementById('setupDetect').disabled));output.push(...await measureActions(ctx,['setupDetect']));
 }finally{await ui.click('#setupCancel');await ctx.until(()=>ui.evaluate(()=>document.getElementById('environmentSetup').classList.contains('hidden')));}
 const directory=path.resolve('artifacts/controls-regression');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'onboarding.json'),JSON.stringify(output,null,2));
 console.log('PASS actual onboarding action controls: random name, Docker preparation, existing-container refresh and runtime detection, normal/loading at 1400/800; wizard cancelled before creation');return output;
}

export async function verifyActionLayoutRegression(ctx){
 const ui=harness(ctx),dialogs={browserSiteRefresh:'browserSiteDataDialog',refreshBrowserCookies:'browserCookiesDialog',environmentRetry:'environmentGate'};
 return measureActions(ctx,['browserSiteRefresh','refreshBrowserCookies','consoleConnect','browserSyncNow','verify','reload','environmentRetry'],async id=>{
  if(dialogs[id]){await ui.evaluate(id=>document.getElementById(id).show(),dialogs[id]);await ui.tick();}
  else if(id==='consoleConnect')await ui.click('[data-page="console"]');
  else if(id==='browserSyncNow')await ui.setting('browser');
  else if(id==='verify')await ui.setting('proxy');
  else if(id==='reload')await ui.click('[data-page="browser"]');
 },async id=>{if(dialogs[id])await ui.evaluate(id=>document.getElementById(id).hide(),dialogs[id]);});
}

async function verifyForm(ctx,ui){
 assert.equal(typeof ctx.getExitRequests,'function','A5 requires observed local proxy fixture requests');
 await ui.setting('proxy');await ui.click('#openProxyDialog');await ctx.until(()=>ui.evaluate(()=>document.getElementById('proxyDialog').open));
 const old=await ui.evaluate(()=>({fields:['host','port','username','password'].map(id=>[id,document.getElementById(id).value]),remember:document.getElementById('remember').checked}));
 const before=ctx.getExitRequests();
 try{
  assert.equal(await ui.evaluate(()=>document.getElementById('connect').getForm()===document.getElementById('proxyForm')),true,'A5 external form');
  await ui.evaluate(async()=>{for(const id of ['host','port']){const field=document.getElementById(id);field.value='';field.dispatchEvent(new Event('input',{bubbles:true}));await field.updateComplete;}});
  // The real proxy form deliberately uses novalidate; its production validator,
  // rather than a replacement form, must reject empty required connection fields.
  await ui.click('#connect');await ui.tick();assert.equal(ctx.getExitRequests(),before,'A5 invalid form reached proxy');
  await ui.evaluate(async port=>{for(const [id,value] of [['host','127.0.0.1'],['port',String(port)],['username','demo'],['password','secret']]){const field=document.getElementById(id);field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));await field.updateComplete;}document.getElementById('remember').checked=false;},ctx.proxyPort);
  await ctx.until(()=>ui.evaluate(()=>!document.getElementById('connect').disabled));await ui.click('#connect');
  await ctx.until(()=>ui.evaluate(()=>workspace.state().then(s=>s.network.state==='ready')));await ui.closed('proxyDialog');assert.ok(ctx.getExitRequests()>before,'A5 valid form did not reach local proxy');
  await ui.click('#openProxyDialog');await ctx.until(()=>ui.evaluate(()=>document.getElementById('proxyDialog').open));
  const validRequests=ctx.getExitRequests();
  for(const state of ['disabled','loading']){
   await ui.evaluate(async state=>{const b=document.getElementById('connect');b[state]=true;await b.updateComplete;},state);
   await ui.click('#connect');assert.equal(ctx.getExitRequests(),validRequests,'A5 '+state+' submitted');
   await ui.evaluate(async state=>{const b=document.getElementById('connect');b[state]=false;await b.updateComplete;},state);
  }
  return {associated:true,invalid:0,valid:1,disabled:1,loading:1};
 }finally{
  await ui.evaluate(async old=>{for(const [id,value] of old.fields){const field=document.getElementById(id);field.value=value;await field.updateComplete;}document.getElementById('remember').checked=old.remember;const b=document.getElementById('connect');b.loading=false;b.disabled=false;await document.getElementById('proxyDialog').hide();},old);
 }
}

async function verifyBorders(ctx,ui){
 await ui.click('[data-page="automation"]');await ui.click('#learningNew');
 await ctx.until(()=>ui.evaluate(()=>document.getElementById('learningDialog').open&&!document.getElementById('learningEngine').disabled));
 const sampleSource=`(el,part,state)=>{const style=getComputedStyle(el.shadowRoot.querySelector(part));return {id:el.id,state,at:performance.now(),border:style.borderColor,outline:style.outlineWidth,outlineColor:style.outlineColor,transition:style.transitionProperty,shadow:style.boxShadow,focusWithin:el.matches(':focus-within'),active:document.activeElement?.id,shadowActive:el.shadowRoot.activeElement?.getAttribute('part'),open:Boolean(el.open)};}`;
 const sample=async body=>ctx.evaluate(`(async()=>{const sample=${sampleSource};${body}})()`);
 const frames={out:[],closing:[],options:[],form:null};
 try{
  frames.out.push(...await sample(`const out=[],field=document.getElementById('learningName');await field.updateComplete;field.shadowRoot.querySelector('input').focus();await new Promise(requestAnimationFrame);out.push(sample(field,'[part~=base]','focus'));field.blur();for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);out.push(sample(field,'[part~=base]','blur-'+i));}return out;`));
  const select=await sample(`const select=document.getElementById('learningEngine'),out=[],closing=[];await select.updateComplete;select.focus();await new Promise(requestAnimationFrame);out.push(sample(select,'[part~=combobox]','focus'));await select.show();out.push(sample(select,'[part~=combobox]','open'));const hiding=select.hide();for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);closing.push(sample(select,'[part~=combobox]','closing-'+i));}await hiding;await select.updateComplete;return {out,closing};`);
  frames.out.push(...select.out);frames.closing=select.closing;
  // A closed popover may retain focus through its focus-restoration frame.
  // Move focus by a real pointer click before labelling subsequent frames "blur".
  await ui.click('#learningDialog .learning-settings h3');
  await ctx.until(()=>ui.evaluate(()=>{const select=document.getElementById('learningEngine');return !select.open&&!select.matches(':focus-within');}));
  frames.out.push(...await sample(`const select=document.getElementById('learningEngine'),out=[];for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);out.push(sample(select,'[part~=combobox]','blur-'+i));}return out;`));
  Object.assign(frames,await ui.evaluate(()=>({options:[...document.querySelectorAll('wa-option')].map(option=>{const host=getComputedStyle(option),label=option.shadowRoot?.querySelector('[part~=label]'),style=label?getComputedStyle(label):host;return {font:host.fontSize,weight:host.fontWeight,line:host.lineHeight,labelFont:style.fontSize,labelWeight:style.fontWeight,labelLine:style.lineHeight};}),form:document.getElementById('connect').getForm()?.id})));
  const evidenceDirectory=path.resolve('artifacts/controls-regression');await mkdir(evidenceDirectory,{recursive:true});await writeFile(path.join(evidenceDirectory,'border-frames.json'),JSON.stringify(frames,null,2)+'\n');
  assert.ok(frames.options.length>0,'B1 actual options');for(const option of frames.options){assert.equal(option.font,'12px','B1');assert.equal(option.weight,'400','B1');assert.equal(option.line,'18px','B1');assert.equal(option.labelFont,'12px','B1 actual label');assert.equal(option.labelWeight,'400','B1 actual label');assert.equal(option.labelLine,'18px','B1 actual label');}
  for(const id of ['learningName','learningEngine']){const blurred=frames.out.filter(row=>row.id===id&&row.state.startsWith('blur'));assert.equal(blurred.length,20,'B3');assert.equal(new Set(blurred.map(row=>row.border)).size,1,'B3 '+id);for(const row of blurred){assert.equal(row.focusWithin,false,'B3 genuine blur '+row.state);assert.equal(row.shadow,'none','B3 '+row.state);}}
  const opened=frames.out.find(row=>row.state==='open'),blurred=frames.out.find(row=>row.id==='learningEngine'&&row.state.startsWith('blur'));assert.notEqual(opened.border,blurred.border,'B2');assert.notEqual(opened.shadow,'none','B2');
  // Do not discard the close transition: every frame retains one of the same
  // neutral borders/rings, with no dark intermediate border or animation.
  const borders=new Set([opened.border,blurred.border]),rings=new Set([opened.shadow,'none']);assert.equal(frames.closing.length,20,'B3 closing transition frames');
  for(const row of frames.closing){assert.ok(borders.has(row.border),'B3 closing neutral border '+JSON.stringify(row));assert.ok(rings.has(row.shadow),'B3 closing neutral ring '+JSON.stringify(row));}
  for(const row of [...frames.out,...frames.closing])assert.ok(!/border|outline|all/.test(row.transition),'B4 '+JSON.stringify(row));assert.equal(frames.form,'proxyForm','B5');
 }finally{await ui.evaluate(()=>document.getElementById('learningDialog').hide());}
 return frames;
}

async function verifyTransparent(ctx,ui){
 // Exercise both supported CSS variants on already-mounted real controls,
 // including a dynamically mounted automation control; never manufacture buttons.
 const variants=await ui.evaluate(()=>[['cancelProxyDialog','transparent-action'],['learningCancel','text-button']].map(([id,variant])=>{const node=document.getElementById(id),className=node.className;node.classList.add(variant);return {id,className};}));
 await ctx.client.call('DOM.enable');await ctx.client.call('CSS.enable');
 const root=(await ctx.client.call('DOM.getDocument',{depth:0})).root;
 const nodes=(await ctx.client.call('DOM.querySelectorAll',{nodeId:root.nodeId,selector:'app-button[appearance=plain],app-button.transparent-action,app-button.text-button'})).nodeIds;
 assert.ok(nodes.length>0,'T1 actual transparent controls including dynamically mounted application buttons');
 const output=[];
 try{for(const nodeId of nodes){
  const description=(await ctx.client.call('DOM.describeNode',{nodeId,depth:1,pierce:true})).node;
  const shadow=description.shadowRoots?.[0];assert.ok(shadow,'T1 real app-button shadow root');
  const base=(await ctx.client.call('DOM.querySelector',{nodeId:shadow.nodeId,selector:'[part~=base]'})).nodeId;
  const object=(await ctx.client.call('DOM.resolveNode',{nodeId})).object;
  try{for(const state of [[],['hover'],['hover','active'],[],['focus','focus-visible']]){
   await ctx.client.call('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:state});await ctx.client.call('CSS.forcePseudoState',{nodeId:base,forcedPseudoClasses:state});
   const response=await ctx.client.call('Runtime.callFunctionOn',{objectId:object.objectId,returnByValue:true,functionDeclaration:`function(){return [this,this.shadowRoot.querySelector('[part~=base]')].map(element=>{const s=getComputedStyle(element);return {id:this.id,part:element===this?'host':'base',classes:this.className,appearance:this.getAttribute('appearance'),background:s.backgroundColor,border:s.borderTopColor,shadow:s.boxShadow};});}`});
   const styles=response.result.value;output.push({nodeId,state,styles});
   await writeFile(path.resolve('artifacts/controls-regression/transparent-states.json'),JSON.stringify(output,null,2)+'\n');
   for(const style of styles){assert.equal(style.background,'rgba(0, 0, 0, 0)','T2 '+style.id+' '+style.part+state);assert.equal(style.border,'rgba(0, 0, 0, 0)','T2 '+style.id+' '+style.part+state);assert.equal(style.shadow,'none','T2 '+style.id+' '+style.part+state);}
  }}finally{await ctx.client.call('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});await ctx.client.call('CSS.forcePseudoState',{nodeId:base,forcedPseudoClasses:[]});await ctx.client.call('Runtime.releaseObject',{objectId:object.objectId});}
 }
 }finally{await ui.evaluate(variants=>{for(const {id,className} of variants)document.getElementById(id).className=className;},variants);}
 return output;
}

async function verifyModelPicker(ctx,ui){
 const fixture=requireFixture(ctx,'models');
 await ui.click('[data-page="cc"]');await ctx.until(()=>ui.evaluate(()=>!document.getElementById('sessionModel').disabled));
 const original=await ui.evaluate(()=>document.getElementById('sessionModel').value),out=[],trace=[];
 const directory=path.resolve('artifacts/controls-regression');await mkdir(directory,{recursive:true});
 const record=async(stage,capture=false)=>{
  const snapshot=await ui.evaluate(async()=>{const select=document.getElementById('sessionModel'),state=await workspace.state(),session=state.aiSessions.find(s=>s.id===state.activeAISessionId);return {selectedEngine:state.selectedEngine,session:session?{id:session.id,engine:session.engine,model:session.model}:null,disabled:select.disabled,open:select.open,value:select.value,options:[...select.querySelectorAll('wa-option')].map(o=>({value:o.value,text:o.textContent})),warning:document.getElementById('newSessionStatus')?.textContent,events:window.__controlsModelEvents?.slice()};});trace.push({stage,...snapshot});await writeFile(path.join(directory,'model-events.json'),JSON.stringify(trace,null,2)+'\n');if(capture){const image=await ctx.captureUI();await writeFile(path.join(directory,'model-'+stage+'.png'),Buffer.from(image.data,'base64'));}
 };
 await ui.evaluate(()=>{const select=document.getElementById('sessionModel');window.__controlsModelEvents=[];window.__controlsModelListener=event=>window.__controlsModelEvents.push({event:event.type,at:performance.now(),open:select.open,value:select.value,focusWithin:select.matches(':focus-within')});for(const name of ['wa-show','wa-after-show','wa-hide','wa-after-hide','focusin','focusout'])select.addEventListener(name,window.__controlsModelListener);});
 await fixture.configure({delayMs:120,models:[{id:original,model:original,displayName:'Controls current model',isDefault:true},{id:'controls-b',model:'controls-b',displayName:'Controls model B',isDefault:false}]});
 await ui.evaluate(()=>workspace.runtimeInfo({refreshEngine:'codex'}));
 await ui.click('[data-page="runtime"]');await ctx.until(()=>ui.evaluate(()=>Boolean(document.querySelector('#sessionModel wa-option[value="controls-b"]'))));await ui.click('[data-page="cc"]');
 try{for(const mode of ['toggle','outside','escape','select']){
  console.log('controls model: '+mode+' open');await record(mode+'-before',true);
  await ui.click('#sessionModel');await ctx.until(()=>ui.evaluate(()=>document.getElementById('sessionModel').open));
  await ctx.until(()=>ui.evaluate(()=>document.querySelectorAll('#sessionModel wa-option').length===2&&Boolean(document.querySelector('#sessionModel wa-option[value="controls-b"]'))));
  await record(mode+'-opened',true);const before=await fixture.requests();
  // Opening normally refreshes the registry from its real cache. In addition,
  // overlap a genuine delayed provider refresh with the expanded native select.
  await ui.evaluate(()=>{window.__controlsModelRefresh=workspace.runtimeInfo({refreshEngine:'codex'});return true;});
  await ctx.until(async()=>await fixture.requests()>before);
  assert.equal(await ui.evaluate(()=>document.getElementById('sessionModel').open),true,'M1 '+mode+' stays open during real provider refresh');
  await ui.evaluate(async()=>{await window.__controlsModelRefresh;delete window.__controlsModelRefresh;});await ui.tick();
  assert.equal(await ui.evaluate(()=>document.getElementById('sessionModel').open),true,'M1 '+mode+' stays open after real provider refresh');
  assert.deepEqual(await ui.evaluate(()=>[...document.querySelectorAll('#sessionModel wa-option')].map(option=>option.value)),[original,'controls-b'],'M1 stable options after async refresh');
  const widths=await ui.evaluate(()=>{const s=document.getElementById('sessionModel');return [s.shadowRoot.querySelector('[part~=combobox]').getBoundingClientRect().width,s.shadowRoot.querySelector('[part~=listbox]').getBoundingClientRect().width];});assert.ok(Math.abs(widths[0]-widths[1])<1,'M2 '+JSON.stringify(widths));
  if(mode==='toggle')await ui.click('#sessionModel');else if(mode==='outside')await ui.click('#sessionTitle');else if(mode==='escape')await ui.escape();else{await ui.click('#sessionModel wa-option[value="controls-b"]');await ctx.until(()=>ui.evaluate(()=>workspace.state().then(state=>state.aiSessions.find(s=>s.id===state.activeAISessionId)?.model==='controls-b')));assert.equal(await ui.evaluate(()=>document.getElementById('sessionModel').value),'controls-b','M4');}
  await ctx.until(()=>ui.evaluate(()=>!document.getElementById('sessionModel').open));out.push({mode,widths});await record(mode+'-closed',true);
 }}catch(error){await record('failure',true);throw error;}finally{
  await fixture.restore();await ui.evaluate(()=>workspace.runtimeInfo({refreshEngine:'codex'}));
  if(await ui.evaluate(()=>document.getElementById('sessionModel').open))await ui.escape();
  await ui.click('#sessionModel');await ctx.until(()=>ui.evaluate(original=>Boolean([...document.querySelectorAll('#sessionModel wa-option')].find(option=>option.value===original)),original));
  const selector='#sessionModel wa-option[value='+JSON.stringify(original)+']';await ui.click(selector);await ctx.until(()=>ui.evaluate(()=>!document.getElementById('sessionModel').disabled&&!document.getElementById('sessionModel').open));
  await ui.evaluate(()=>{const select=document.getElementById('sessionModel');for(const name of ['wa-show','wa-after-show','wa-hide','wa-after-hide','focusin','focusout'])select.removeEventListener(name,window.__controlsModelListener);delete window.__controlsModelListener;delete window.__controlsModelEvents;});
 }
 return out;
}

async function verifyConsole(ctx,ui){
 const fixture=requireFixture(ctx,'console'),original=await ui.preferences();
 const originalTheme=await ui.evaluate(()=>document.getElementById('themeSelect').value);
 const snapshots=[];
 const observe=async()=>{try{const value=await fixture.snapshot();snapshots.push({at:Date.now(),opens:value.opens,token:value.token,inputs:value.inputs});return value;}catch(error){snapshots.push({at:Date.now(),error:error.message,stack:error.stack});throw error;}};
 const paste=text=>ui.evaluate(text=>{const target=document.querySelector('#containerTerminal .xterm-helper-textarea');if(!target)throw Error('Real xterm is not mounted');const data=new DataTransfer();data.setData('text/plain',text);target.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},text);
 const saveSetting=async(key,value)=>{
  await ui.setting('console');await ctx.until(()=>ui.evaluate(key=>{const control=document.getElementById(key);return Boolean(control)&&!control.disabled;},key));
  await ui.evaluate(async(key,value)=>{
   const control=document.getElementById(key);if(!control)throw Error('Missing actual console preference '+key);await control.updateComplete;
   if(['wa-switch','wa-checkbox'].includes(control.localName)){if(typeof value!=='boolean')throw Error('Boolean control requires a boolean: '+key);control.checked=value;}
   else control.value=String(value);
   control.dispatchEvent(new Event('change',{bubbles:true}));
  },key,value);
  await ctx.until(()=>ui.preferences().then(p=>p[key]===value));await ctx.until(()=>ui.evaluate(key=>!document.getElementById(key).disabled,key));
 };
 const inputs=async()=>(await observe()).inputs;
 const closed=()=>ui.closed('consolePasteDialog');
 try{
  await ui.preferences({consoleAutoConnect:false,consoleConfirmPaste:true});await fixture.prepare();
  const start=await observe();await ui.click('[data-page="console"]');await ctx.until(()=>ui.evaluate(()=>Boolean(document.querySelector('#containerTerminal .xterm-helper-textarea'))));assert.equal((await observe()).opens,start.opens,'C1 manual mode did not auto-connect');
  await ui.click('#consoleConnect');await ctx.until(async()=>(await observe()).opens===start.opens+1);await ctx.until(()=>ui.evaluate(()=>!document.getElementById('consoleConnect').loading));
  await saveSetting('consoleFontSize',18);await saveSetting('consoleTheme','light');await ui.click('[data-page="console"]');await ctx.until(()=>ui.evaluate(()=>document.getElementById('containerTerminal').style.background==='rgb(255, 255, 255)'));assert.equal(await ui.preferences().then(p=>p.consoleFontSize),18,'C2 real font setting saved');
  await fixture.output('\x1b[?2004h');await ui.tick();await ui.tick();
  const before=(await inputs()).length;await paste('first\nsecond');await ctx.until(()=>ui.evaluate(()=>document.getElementById('consolePasteDialog').open));assert.equal((await inputs()).length,before,'C3 paste withheld');
  const metrics=await ui.evaluate(()=>{const d=document.getElementById('consolePasteDialog'),r=d.dialog;return {open:r.open,filter:getComputedStyle(r,'::backdrop').backdropFilter,radius:getComputedStyle(r).borderRadius,header:getComputedStyle(d.shadowRoot.querySelector('[part~=header]')).borderBottomWidth,footer:getComputedStyle(d.shadowRoot.querySelector('[part~=footer]')).borderTopWidth};});assert.deepEqual(metrics,{open:true,filter:'blur(4px)',radius:'14px',header:'1px',footer:'1px'},'C4');
  await ui.click('#consolePasteDialog [slot=footer] app-button:first-child');await closed();assert.equal((await inputs()).length,before,'C5 cancel');
  await paste('first\nsecond');await ctx.until(()=>ui.evaluate(()=>document.getElementById('consolePasteDialog').open));await ui.escape();await closed();assert.equal((await inputs()).length,before,'C5 native Escape');
  await paste('first\nsecond');await ctx.until(()=>ui.evaluate(()=>document.getElementById('consolePasteDialog').open));await ui.click('#consolePasteDialog [slot=footer] app-button:last-child');await closed();await ctx.until(async()=>(await inputs()).length===before+1);const confirmed=(await inputs()).at(-1);assert.ok(confirmed.data.startsWith('\x1b[200~'),'C6 xterm bracketed paste');assert.ok(confirmed.data.endsWith('\x1b[201~'),'C6');assert.match(confirmed.data,/first\rsecond/,'C6 exact xterm newline conversion');
  await paste('stale\ntext');await ctx.until(()=>ui.evaluate(()=>document.getElementById('consolePasteDialog').open));await fixture.reset();await closed();
  // Calling the real mounted confirmation button after reset must not replay stale data.
  await ui.evaluate(()=>document.querySelector('#consolePasteDialog [slot=footer] app-button:last-child').click());assert.equal((await inputs()).length,before+1,'C7 stale session paste');
  await saveSetting('consoleAutoConnect',true);const opens=(await observe()).opens;await ui.click('[data-page="console"]');await ctx.until(async()=>(await observe()).opens===opens+1);
  await saveSetting('consoleConfirmPaste',false);await ui.click('[data-page="console"]');await paste('allowed\ntext');await ctx.until(async()=>(await inputs()).length===before+2);assert.equal(await ui.evaluate(()=>document.getElementById('consolePasteDialog').open),false,'C8 immediate paste');
  await saveSetting('consoleTheme','system');await ui.preferences({});await ui.evaluate(()=>{const s=document.getElementById('themeSelect');s.value='dark';s.dispatchEvent(new Event('change'));});await ui.click('[data-page="console"]');await ctx.until(()=>ui.evaluate(()=>document.getElementById('containerTerminal').style.background==='rgb(21, 24, 32)'));
  return {metrics,manualConnect:true,cancel:true,escape:true,confirm:true,stalePasteBlocked:true,autoConnect:true,theme:true};
 }catch(error){
  const diagnostic=await ui.evaluate(async()=>({status:document.getElementById('consoleStatus').textContent,page:[...document.querySelectorAll('.page')].filter(page=>!page.classList.contains('hidden')).map(page=>page.id),service:await workspace.console('status').then(value=>({ok:true,value}),error=>({ok:false,error:error.message})),button:{disabled:document.getElementById('consoleConnect').disabled,loading:document.getElementById('consoleConnect').loading,label:document.getElementById('consoleConnectLabel').textContent},xterm:Boolean(document.querySelector('#containerTerminal .xterm-helper-textarea')),trace:window.__desktopConsoleTrace})).then(actual=>({actual}),captureError=>({diagnosticError:captureError.stack}));
  const screenshot=await ctx.captureUI().then(value=>({value}),captureError=>({error:captureError.stack}));
  if(screenshot.value)await writeFile(path.resolve('artifacts/controls-regression/console-failure.png'),Buffer.from(screenshot.value.data,'base64'));
  await writeFile(path.resolve('artifacts/controls-regression/console-failure.json'),JSON.stringify({error:error.stack,snapshots,...diagnostic,screenshotError:screenshot.error},null,2)+'\n');throw error;
 }finally{
  await fixture.dispose();await ui.preferences(original);
  await ui.evaluate(theme=>{const control=document.getElementById('themeSelect');control.value=theme;control.dispatchEvent(new Event('change'));},originalTheme);
 }
}

/** Real desktop scenario. All boundary fixtures are required; missing coverage fails loudly. */
export async function verifyControlsRegression(ctx){
 const ui=harness(ctx),identity=await ui.evaluate(()=>({url:location.href,bridge:typeof workspace.state,ready:performance.getEntriesByName('chat-records-ready').length>0}));
 assert.match(identity.url,/\/src\/index\.html(?:[?#]|$)/);assert.equal(identity.bridge,'function');assert.equal(identity.ready,true);
 const result={identity,onboarding:await verifyOnboardingControls(ctx),actions:await verifyActionLayoutRegression(ctx)};
 result.form=await verifyForm(ctx,ui);console.log('PASS controls A1-A5 actual button geometry and proxy external form');
 result.borders=await verifyBorders(ctx,ui);console.log('PASS controls B1-B5 actual options and focus/open/close/blur frames');
 result.transparent=await verifyTransparent(ctx,ui);console.log('PASS controls T1-T2 actual transparent host/base interaction states');
 result.models=await verifyModelPicker(ctx,ui);console.log('PASS controls M1-M4 real asynchronous model refresh and selection IPC');
 result.console=await verifyConsole(ctx,ui);console.log('PASS controls C1-C8 real container terminal preferences and paste isolation');
 const directory=path.resolve('artifacts/controls-regression');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'results.json'),JSON.stringify({coverage:controlsRegressionCoverage,...result},null,2)+'\n');
 console.log('PASS real desktop controls regression: A1-A5 B1-B5 T1-T2 M1-M4 C1-C8; quit Q1-Q4 runs at suite termination');return result;
}

/** Root calls this last: confirmation intentionally closes the actual application. */
export async function verifyQuitControlsRegression(ctx){
 const ui=harness(ctx),fixture=requireFixture(ctx,'quit');await ui.preferences({confirmQuit:true});await fixture.startTasks();
 const opened=()=>ctx.until(()=>ui.evaluate(()=>document.getElementById('quitConfirmationDialog').open));
 const request=async()=>{await fixture.request();await opened();};
 await request();const metrics=await ui.evaluate(()=>{const d=document.getElementById('quitConfirmationDialog'),real=d.dialog;return {open:real.open,items:d.querySelectorAll('li').length,radius:getComputedStyle(real).borderRadius,filter:getComputedStyle(real,'::backdrop').backdropFilter,header:getComputedStyle(d.shadowRoot.querySelector('[part~=header]')).borderBottomWidth,footer:getComputedStyle(d.shadowRoot.querySelector('[part~=footer]')).borderTopWidth,buttons:[...d.querySelectorAll('app-button')].map(b=>({icon:Boolean(b.querySelector('wa-icon[slot=start]')),action:b.classList.contains('content-action')}))};});
 assert.equal(metrics.open,true,'Q1');assert.equal(metrics.items,2,'Q1 two actual running tasks');assert.equal(metrics.radius,'14px','Q1');assert.equal(metrics.filter,'blur(4px)','Q1');assert.equal(metrics.header,'1px','Q1');assert.equal(metrics.footer,'1px','Q1');assert.ok(metrics.buttons.every(b=>b.icon&&b.action),'Q1');
 await ui.click('#quitConfirmationDialog [slot=footer] app-button:first-child');await ui.closed('quitConfirmationDialog');assert.equal(await fixture.alive(),true,'Q2 cancel');
 await request();await ui.escape();await ui.closed('quitConfirmationDialog');assert.equal(await fixture.alive(),true,'Q2 Escape');
 await ui.setting('proxy');await ui.click('#openProxyDialog');await ctx.until(()=>ui.evaluate(()=>document.getElementById('proxyDialog').open));await fixture.request();await fixture.settled();
 const blocked=await ui.evaluate(()=>({existing:document.getElementById('proxyDialog').open,quit:document.getElementById('quitConfirmationDialog').open,count:[...document.querySelectorAll('app-dialog')].filter(d=>d.open).length}));assert.deepEqual(blocked,{existing:true,quit:false,count:1},'Q3 existing application modal blocks quit');assert.equal(await fixture.alive(),true,'Q3');await ui.click('#cancelProxyDialog');await ui.closed('proxyDialog');
 await request();await ui.evaluate(()=>{document.querySelector('#quitConfirmationDialog [slot=footer] app-button:last-child').shadowRoot.querySelector('button').click();return true;});await fixture.waitExit();assert.equal(await fixture.alive(),false,'Q4 confirmation exits actual Kuneco');
 assert.deepEqual(fixture.requests(),['window-close','app-quit','window-close','app-quit'],'Q1-Q4 actual native window and application quit entry points');
 console.log('PASS actual quit guard: Q1-Q4 real running tasks, native cancel/Escape, existing modal protection, final application exit');return {metrics,nativeRequests:fixture.requests(),cancel:true,escape:true,blocked:true,confirm:true};
}
