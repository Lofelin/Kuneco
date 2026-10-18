// A partial inspection must never become a permanently successful cache entry.
export function environmentDetailComplete(detail){
 if(detail.id===null)return true;
 const r=detail.reliability;
 return Boolean(r?.worker?.available && (detail.external || (r.gateway?.available && r.network?.available)) && (r.worker.status==='已停止' || detail.baseSystem));
}
export function environmentRefreshDue({scope,currentScope,dirty,checkedAt,now=Date.now()}){
 return scope!==currentScope || dirty || now-checkedAt>=30000;
}
