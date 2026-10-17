import {randomUUID} from 'node:crypto';
// Only the SDK's real permission callback enters this broker. Approval is not execution success.
export function createToolApprovalBroker(){
 const pending=new Map();
 function request({toolName,input,toolUseID,signal,scope,emit,title,description,decisionReason}){
  return new Promise(resolve=>{
   const id=randomUUID(),activityId=toolUseID||id;
   const finish=(allow,reason)=>{const record=pending.get(id);if(!record)return;pending.delete(id);signal?.removeEventListener('abort',abort);emit('ccApprovalDone',{id,activityId,status:allow?'allowed':reason==='cancelled'?'cancelled':'denied',reason});emit('ccActivity',{id:activityId,type:'tool_call',provider:'claude',toolName,title:toolName,status:allow?'in_progress':reason==='cancelled'?'stopped':'failed',authorization:allow?'allowed':reason,error:allow?undefined:reason==='cancelled'?'请求已取消':'用户拒绝执行'});resolve(allow?{behavior:'allow',updatedInput:input}:{behavior:'deny',message:reason==='cancelled'?'请求已取消':'用户拒绝执行'});};
   const abort=()=>finish(false,'cancelled');pending.set(id,{scope,finish});
   if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
   emit('ccActivity',{id:activityId,type:'tool_call',provider:'claude',toolName,title:toolName,input,status:'pending_approval',authorization:'pending'});
   emit('ccApproval',{id,activityId,toolName,input,title,description,decisionReason});
  });
 }
 function decide(id,allow,scope){const record=pending.get(id);if(!record)throw Error('授权请求已过期');if(typeof allow!=='boolean'||JSON.stringify(record.scope)!==JSON.stringify(scope))throw Error('授权请求不属于当前账号或环境');record.finish(allow,allow?'allowed':'user_denied');return true;}
 function cancelAll(){for(const record of [...pending.values()])record.finish(false,'cancelled');}
 return {request,decide,cancelAll};
}
