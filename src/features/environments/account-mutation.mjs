// Serialize the complete read/modify/write transaction, independently per account.
const queues=new WeakMap();
export async function accountMutation(manager,owner,operation){
 let pending=queues.get(manager);if(!pending){pending=new Map();queues.set(manager,pending);}
 const next=(pending.get(owner)||Promise.resolve()).catch(()=>{}).then(operation);
 pending.set(owner,next);
 try{return await next;}finally{if(pending.get(owner)===next)pending.delete(owner);}
}
