import {randomUUID} from 'node:crypto';

// Keep CDP commands short while a real IPC transaction is in progress. A login
// includes task cleanup, session persistence, authentication and account restore;
// it has a separate bounded deadline from the driver's individual CDP commands.
export async function runDesktopOperation({evaluate,until},expression,{name,timeoutMs=90000}={}) {
 const key='__kunecoDesktopOperation_'+randomUUID().replaceAll('-','');
 try {
  await evaluate(`(()=>{const operation={status:'pending'};window[${JSON.stringify(key)}]=operation;Promise.resolve().then(()=>(${expression})).then(()=>{operation.status='complete';},error=>{operation.status='failed';operation.error=error?.message || String(error);});})()`);
  const result=await until(()=>evaluate(`(()=>{const operation=window[${JSON.stringify(key)}];return operation?.status==='pending'?null:operation || {status:'failed',error:'Renderer operation state was lost'};})()`),timeoutMs);
  if(result.status==='failed')throw new Error(result.error);
 } catch(error) {
  throw new Error(`Desktop operation failed: ${name || 'IPC action'} (${timeoutMs}ms deadline): ${error.message}`,{cause:error});
 } finally {
  await evaluate(`delete window[${JSON.stringify(key)}]`).catch(()=>{});
 }
}
