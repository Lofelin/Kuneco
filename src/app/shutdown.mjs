// Keep the application alive until cleanup succeeds. Successful steps are not
// repeated; failed steps remain retryable without rerunning an in-flight step.
export function createShutdownBarrier(steps){
 let requested=false,complete=false,pending;
 const done=new Set(),running=new Map();
 return {
  get requested(){return requested;},get complete(){return complete;},
  run(){
   requested=true;
   if(complete)return Promise.resolve();
   if(pending)return pending;
   const work=steps.map((step,index)=>{
    if(done.has(index))return Promise.resolve();
    if(running.has(index))return running.get(index);
    const attempt=Promise.resolve().then(step).then(()=>{done.add(index);}).finally(()=>running.delete(index));
    running.set(index,attempt);return attempt;
   });
   pending=Promise.all(work).then(()=>{complete=true;}).finally(()=>{pending=null;});
   return pending;
  }
 };
}
