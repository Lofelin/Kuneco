import {spawn} from 'node:child_process';
import {writeFileSync,unlinkSync,existsSync} from 'node:fs';
const [id,command,...args]=process.argv.slice(2);
if(!/^[a-f0-9-]{36}$/.test(id)||!command)process.exit(1);
const pidFile='/tmp/dingtu-'+id,cancelFile=pidFile+'.cancel';
const removeFiles=()=>{for(const file of [pidFile,cancelFile])try{unlinkSync(file);}catch{}};
// A cancellation can arrive before Docker starts this wrapper.
if(existsSync(cancelFile)){removeFiles();process.exit(143);}
const child=spawn(command,args,{stdio:'inherit',detached:true});
let stopping=false,exitCode=1,cleanupTimer;
const signalGroup=signal=>{
  if(!Number.isInteger(child.pid)||child.pid<=0)return false;
  try{process.kill(-child.pid,signal);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}
};
const finish=()=>{
  clearTimeout(cleanupTimer);
  removeFiles();
  process.exit(exitCode);
};
const stop=code=>{
  if(stopping)return;
  stopping=true;exitCode=code;
  // Keep the wrapper alive even if the group leader exits on TERM: descendants
  // can ignore it and still own inherited stdio or run background work.
  if(!signalGroup('SIGTERM'))return finish();
  cleanupTimer=setTimeout(()=>{signalGroup('SIGKILL');finish();},1000);
};
process.on('SIGTERM',()=>stop(143));
process.on('SIGINT',()=>stop(130));
child.once('spawn',()=>{
  // Cancellation signals this wrapper, which owns the bounded group shutdown.
  try{writeFileSync(pidFile,String(process.pid));}catch{return stop(1);}
  // Publishing the PID before checking closes the cancellation/start race.
  if(existsSync(cancelFile))stop(143);
});
child.once('error',()=>finish());
child.once('exit',code=>stop(code??1));
