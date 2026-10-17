// These controls never schedule a request. A retry always requires a fresh click.
export function recoveryPresentation(recovery,now=Date.now()){
 const waiting=Number.isFinite(recovery?.retryAt)?Math.max(0,Math.ceil((recovery.retryAt-now)/1000)):null;
 const retryable=recovery?.automaticRetry===false && recovery?.manualRetry===true && recovery?.executionUnknown===false && [429,503].includes(recovery?.httpStatus);
 const reason=({ 'rate-limit':'请求受到限流','unavailable':'服务暂时不可用','authentication':'请检查 API Key','balance':'请检查账户余额','permission':'当前凭据没有请求权限','invalid-request':'请检查请求参数或上下文长度'})[recovery?.kind] || '请求失败';
 const detail=recovery?.executionUnknown?'之前可能已执行操作，请先核对结果；不会自动重发。':waiting>0?`服务要求等待 ${waiting} 秒；不会自动重发。`:waiting===0?'等待已结束，可手动重试；不会自动重发。':'服务未提供等待时间；不会自动重发。';
 return {reason,detail,waiting,retryable,disabled:!retryable || waiting>0};
}
export function mountChatRecovery({container,scope,onRetry}){
 const records=new Map();let timer=null;
 const panel=document.createElement('section');panel.className='chat-recovery';panel.hidden=true;container.append(panel);
 const title=document.createElement('p'),detail=document.createElement('p');detail.className='chat-recovery-detail';
 const retry=document.createElement('app-button');retry.className='content-action retry-action';retry.innerHTML='<wa-icon slot="start" src="./assets/icons/rotate-cw.svg"></wa-icon>重试';
 panel.append(title,detail,retry);let shown=null;
 const stop=()=>{if(timer!==null)clearTimeout(timer);timer=null;};
 const refresh=()=>{
  stop();const key=scope(),record=records.get(key);shown=record?key:null;panel.hidden=!record;if(!record)return;
  const state=recoveryPresentation(record.recovery);title.textContent=state.reason;detail.textContent=state.detail;retry.hidden=!state.retryable;retry.disabled=state.disabled||record.retrying;
  if(state.waiting>0)timer=setTimeout(refresh,1000);
 };
 retry.addEventListener('click',async()=>{const key=scope(),record=records.get(key);if(key!==shown||!record||record.retrying||recoveryPresentation(record.recovery).disabled)return;record.retrying=true;refresh();try{await onRetry(key,record);}finally{record.retrying=false;refresh();}});
 return {show(recovery,key=scope(),extra={}){records.set(key,{...extra,recovery});refresh();},clear(key=scope()){records.delete(key);refresh();},refresh,destroy(){stop();records.clear();panel.remove();}};
}
