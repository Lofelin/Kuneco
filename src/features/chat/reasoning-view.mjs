import {renderActivities} from '../runtimes/runtime-activity.mjs';
import {isReasoningTerminal,reasoningSnapshot,updateReasoningState} from './reasoning-state.mjs';
const views=new Set();
const seconds=ms=>`${Math.max(0,Math.floor(ms/1000))} 秒`;

export function reasoningView(content,options={},render){
 if(!content?.parentNode)return;
 const block=content.parentNode,previous=block.messageReasoning;
 if(previous && isReasoningTerminal(previous.phase))return block.querySelector('.deepseek-reasoning');
 const previousPhase=previous?.phase;
 const state=block.messageReasoning=updateReasoningState(previous,options);
 block.querySelector('.bubble-label')?.remove();
 let details=block.querySelector('.deepseek-reasoning');
 if(!details){
  details=document.createElement('details');details.className='deepseek-reasoning';
  const summary=document.createElement('summary'),icon=document.createElement('wa-icon'),label=document.createElement('span'),arrow=document.createElement('wa-icon');
  icon.src='assets/icons/atom.svg';arrow.src='assets/icons/chevron-right.svg';arrow.className='reasoning-chevron';
  summary.append(icon,label,arrow);details.append(summary,document.createElement('div'));content.before(details);
  // Record the user intent synchronously; native toggle events are asynchronous
  // and can be coalesced with a stream update or automatic completion collapse.
  summary.addEventListener('click',()=>{state.userExpanded=!details.open;details.dispatchEvent(new CustomEvent('reasoning-toggle',{bubbles:true}));});
  details.open=state.userExpanded ?? !isReasoningTerminal(state.phase);
 }
 if(state.kind==='process')details.querySelector('summary>wa-icon:not(.reasoning-chevron)')?.remove();
 if(previousPhase!==state.phase && (state.phase==='answering' || isReasoningTerminal(state.phase)))details.open=state.userExpanded ?? false;
 details.dataset.phase=state.phase;
 details.dataset.complete=String(isReasoningTerminal(state.phase));
 const label=details.querySelector('summary span');
 if(previousPhase && previousPhase!==state.phase && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)label.animate?.([{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:200,easing:'ease-out'});
 const tick=()=>{
  const value=reasoningSnapshot(state);state.durationMs=value.durationMs;
  const measured=state.kind==='process'?`用时 ${seconds(value.processMs)}`:value.thinkingMs || state.text.trim()?`已思考 ${seconds(value.thinkingMs)}`:`等待 ${seconds(value.waitingMs)}`;
  const title=state.phase==='waiting'?`等待响应 ${seconds(value.waitingMs)}`:state.phase==='thinking'?`正在思考 ${seconds(value.thinkingMs)}`:state.phase==='process'?`用时 ${seconds(value.processMs)} · 进行中`:state.phase==='answering'?`${measured} · 正在回答`:`${{completed:'已完成',stopped:'已停止',failed:'失败'}[state.phase]} · ${measured}`;
  let text=label.querySelector('.reasoning-status-text');
  if(!text){text=document.createElement('span');text.className='reasoning-status-text';label.replaceChildren(text);}
  text.textContent=title+(state.activities?.length?' · '+state.activities.length+' 项活动':'');
  const active=!isReasoningTerminal(state.phase);
  if(active && !label.querySelector('.reasoning-dots')){const dots=document.createElement('span');dots.className='reasoning-dots';dots.setAttribute('aria-hidden','true');for(let i=0;i<3;i++){const dot=document.createElement('span');dot.textContent='.';dots.append(dot);}label.append(dots);}
  if(!active)label.querySelector('.reasoning-dots')?.remove();
 };
 clearInterval(state.timer);state.timer=null;views.delete(state);tick();
 if(!isReasoningTerminal(state.phase)){state.timer=setInterval(tick,1000);state.timer.unref?.();views.add(state);}
 if(!state.text.trim() && !state.activities?.length){
  const notice=document.createElement('p');notice.className='reasoning-unavailable';
  notice.textContent=isReasoningTerminal(state.phase)?(state.kind==='process'?'运行时未返回可展示的过程':'模型未返回思考过程'):state.phase==='waiting'?'正在等待运行时响应':state.phase==='answering'?'模型未返回思考过程':'等待过程内容';
  details.lastChild.replaceChildren(notice);
 }else render(details.lastChild,state.text);
 renderActivities(details.lastChild,state.activities);
 return details;
}
export function finishReasoning(content,render,phase='completed'){
 const state=content?.parentNode?.messageReasoning;
 if(!state || isReasoningTerminal(state.phase))return;
 reasoningView(content,{phase},render);
}
export function clearReasoningTimers(){for(const state of views){clearInterval(state.timer);state.timer=null;}views.clear();}
