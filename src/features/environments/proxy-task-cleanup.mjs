// Cancellation belongs to the container task, not to its attached Docker CLI.
export const cancelProxyTaskSource = `
const fs=require('node:fs');
const [id,mark]=process.argv.slice(1);
if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid task ID');
const file='/tmp/dingtu-'+id,cancel=file+'.cancel';
if(mark==='1')fs.writeFileSync(cancel,'',{mode:0o600});
let pid;try{pid=Number(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')process.exit(0);throw error;}
if(!Number.isInteger(pid)||pid<=1)throw Error('Invalid task PID');
let argv;try{argv=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\\0');}catch(error){if(error.code==='ENOENT'){for(const f of [file,cancel])try{fs.unlinkSync(f);}catch{}process.exit(0);}throw error;}
if(!argv.includes('/opt/dingtu/exec.mjs')||!argv.includes(id))throw Error('Task PID ownership mismatch');
try{process.kill(pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
const deadline=Date.now()+5000;
const timer=setInterval(()=>{if(!fs.existsSync(file)){clearInterval(timer);return;}if(Date.now()>=deadline){clearInterval(timer);console.error('Task cancellation not completed');process.exitCode=1;}},50);
`;

export function trackProxyTask(manager,owner,id,prefix,task,child,externalCancel){
 const kill=child.kill.bind(child);let closed=false,cancelling;
 const cancel=(mark=true)=>{
  if(cancelling)return cancelling;
  const pending=externalCancel?externalCancel():manager.exec(owner,id,['node','-e',cancelProxyTaskSource,task,mark?'1':'0'],{timeout:10000});
  cancelling=pending;void pending.catch(()=>{if(cancelling===pending)cancelling=null;});return pending;
 };
 manager.directTasks ||= new Map();manager.directTasks.set(task,{prefix,cancel});
 const report=error=>{
  manager.directStopFailures ||= new Set();manager.directStopFailures.add(prefix);
  if(!closed&&child.listenerCount('error'))child.emit('error',error);
  console.error('代理任务清理失败：'+error.message);
 };
 child.kill=(type='SIGTERM')=>{void cancel().then(()=>kill(type)).catch(report);return true;};
 child.once('close',(code,signal)=>{
  closed=true;
  void cancel(Boolean(signal)||code!==0).then(()=>manager.directTasks.delete(task)).catch(report);
 });
 return child;
}
