import {renderActivities} from '../runtimes/runtime-activity.mjs';
export function reasoningView(content,{text='',durationMs=null,startedAt=null,complete=false,kind='thinking',activities=null}={},render){
 content.parentNode.querySelector('.bubble-label')?.remove();
 let details=content.parentNode.querySelector('.deepseek-reasoning');
 if(!details){details=document.createElement('details');details.className='deepseek-reasoning';details.open=!complete;const summary=document.createElement('summary');const icon=document.createElement('wa-icon');icon.src='assets/icons/atom.svg';const label=document.createElement('span');const arrow=document.createElement('wa-icon');arrow.src='assets/icons/chevron-right.svg';arrow.className='reasoning-chevron';summary.append(icon,label,arrow);details.append(summary,document.createElement('div'));content.before(details);}
 if(kind==='process')details.querySelector('summary>wa-icon:not(.reasoning-chevron)')?.remove();
 const state=content.parentNode.messageReasoning ||= {text:'',startedAt:startedAt ?? Date.now(),durationMs:null};
 state.kind=kind;if(activities)state.activities=activities;if(!complete && state.activities?.some(a=>a.type==='command_execution'&&a.status==='in_progress'))details.open=true;
 state.text=text;state.durationMs=durationMs;
 if(complete){if(state.durationMs===null && state.startedAt!==null)state.durationMs=Math.max(0,Date.now()-state.startedAt);details.dataset.complete='true';}
 const label=details.querySelector('summary span');
 if(complete){clearInterval(state.timer);label.textContent=state.durationMs===null?'已完成':`${kind==='process'?'用时':'已思考'} ${Math.max(1,Math.round(state.durationMs/1000))} 秒`;if(kind==='process')details.open=false;}
 else if(!label.querySelector('.reasoning-dots')){label.textContent='正在思考';const dots=document.createElement('span');dots.className='reasoning-dots';dots.setAttribute('aria-hidden','true');for(let i=0;i<3;i++){const dot=document.createElement('span');dot.textContent='.';dots.append(dot);}label.append(dots);}
 if(kind==='process' && !complete){const tick=()=>{label.textContent=`用时 ${Math.max(0,Math.floor((Date.now()-state.startedAt)/1000))} 秒 · 进行中`;};tick();if(!state.timer)state.timer=setInterval(tick,1000);}
 if(complete && !state.text.trim() && !state.activities?.length){details.lastChild.replaceChildren();const notice=document.createElement('p');notice.className='reasoning-unavailable';notice.textContent=kind==='process'?'运行时未返回可展示的过程':'模型未返回思考过程';details.lastChild.append(notice);}else render(details.lastChild,state.text);renderActivities(details.lastChild,state.activities);return details;
}
export function finishReasoning(content,render){
 const state=content?.parentNode?.messageReasoning;if(!state || content.parentNode.querySelector('.deepseek-reasoning')?.dataset.complete==='true')return;
 reasoningView(content,{...state,complete:true},render);
}
