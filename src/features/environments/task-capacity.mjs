// Synchronous spawners cannot safely return a queued ChildProcess. Reject busy
// explicitly; callers may retry deliberately. Release only after daemon cleanup.
export class TaskCapacity {
 constructor({maxActive=2}={}){
  if(!Number.isSafeInteger(maxActive)||maxActive<1)throw new TypeError('Invalid task capacity');
  this.maxActive=maxActive;this.active=0;
 }
 reserve(){
  if(this.active>=this.maxActive){
   const error=new Error('直连或安装任务资源额度已满，请等待当前任务清理完成后重试。');
   error.code='CONTAINER_TASK_CAPACITY';throw error;
  }
  this.active++;let released=false;
  return ()=>{if(!released){released=true;this.active--;}};
 }
}
