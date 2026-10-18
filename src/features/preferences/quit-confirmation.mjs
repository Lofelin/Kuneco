// A cancelled confirmation must never enter the irreversible shutdown barrier.
export function createQuitConfirmation({tasks,enabled,prompt,focus=()=>{},id=()=>String(Date.now())}){
 let pending;
 return {
  request(){if(pending){focus();return pending.promise;}const running=tasks();if(!enabled()||!running.length)return Promise.resolve(true);
   let resolve;const promise=new Promise(done=>{resolve=done;});pending={id:id(),resolve,promise};try{prompt({requestId:pending.id,tasks:running});}catch{pending.resolve(false);pending=null;}return promise;
  },
  answer(value){if(!pending||value?.requestId!==pending.id||typeof value.allow!=='boolean')return false;const old=pending;pending=null;old.resolve(value.allow);return true;},
  cancel(){if(pending){const old=pending;pending=null;old.resolve(false);}},
  get pending(){return Boolean(pending);}
 };
}
