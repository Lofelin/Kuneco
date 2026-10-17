import {createInterface} from 'node:readline';
export async function deepSeekMaintenance({spawnProcess,command,...input}){
 const child=spawnProcess({command:'node',args:['/home/node/.local/lib/dingtu/deepseek.mjs',command]});let output='',error='';
 child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2000000)child.kill();});child.stderr.on('data',chunk=>error=(error+chunk).slice(-1500));child.stdin.on('error',()=>{});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{if(code!==0)return reject(new Error(error||'上下文操作未完成'));try{resolve(JSON.parse(output));}catch{reject(new Error('运行时返回无效'));}});});child.stdin.end(JSON.stringify(input));return done;
}
export async function compactCodex({spawnProcess,executable,cwd,threadId,model,signal}){
 const child=spawnProcess({command:executable,args:['app-server','--listen','stdio://'],cwd,signal});const lines=createInterface({input:child.stdout});let seq=0,timer;const pending=new Map();
 try{return await new Promise((resolve,reject)=>{
  const request=(method,params)=>{pending.set(++seq,method);child.stdin.write(JSON.stringify({id:seq,method,params})+'\n');};
  timer=setTimeout(()=>reject(new Error('压缩超时，请检查运行时；未自动重试')),180000);child.once('error',reject);child.once('close',()=>reject(new Error('压缩进程已结束，未收到完成事件')));child.stdin.on('error',reject);
  lines.on('line',line=>{let e;try{e=JSON.parse(line);}catch{return;}
   if(e.error)return reject(new Error(e.error.message||'压缩失败'));
   const method=pending.get(e.id);if(method==='initialize'){child.stdin.write(JSON.stringify({method:'initialized'})+'\n');request('thread/resume',{threadId,cwd,model,approvalPolicy:'never',sandbox:'danger-full-access'});}
   if(method==='thread/resume')request('thread/compact/start',{threadId});
   const p=e.params||{};if(p.threadId&&p.threadId!==threadId)return;
   if(e.method==='item/completed'&&p.item?.type==='contextCompaction'||e.method==='thread/compacted')resolve({status:'completed',at:new Date().toISOString(),native:true,summary:'Codex 已完成原生上下文压缩；运行时未提供摘要正文。'});
   if(e.method==='error'&&!p.willRetry||e.method==='turn/completed'&&p.turn?.status!=='completed')reject(new Error(p.error?.message||p.turn?.error?.message||'压缩未完成'));
  });request('initialize',{clientInfo:{name:'kuneco',version:'0.1.0'},capabilities:{experimentalApi:false}});
 });}finally{clearTimeout(timer);lines.close();child.stdin.end();child.kill();}
}
