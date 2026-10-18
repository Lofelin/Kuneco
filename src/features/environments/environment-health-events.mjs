import {normalizeEnvironmentPreferences} from '../../shared/environment-preferences.mjs';
import {spawn} from 'node:child_process';
export function observeEnvironmentHealth({docker,owner,id,prefix,journal,launch=spawn,checkIntervalMs,getPreferences=()=>({})}){
 let stopped=false,child,timer;const seenChecks=new Map();
 const delay=()=>checkIntervalMs??normalizeEnvironmentPreferences(getPreferences()).environmentHealthInterval*1000;
 const record=(source,level,message,stateKey,details={})=>journal.record(owner,id,{source,level,message,...details},stateKey).catch(()=>{});
 const ready=(async()=>{
  if(!owner||!id)return;
  const {item}=await docker.get(owner,id),endpoint=item.external?.endpoint||docker.endpoint;
  const sources=item.external?[['Container',item.external.id]]:[['Worker container',prefix+'-worker'],['Proxy gateway',prefix+'-gateway']];
  const binary=await docker.binary('docker');if(stopped)return;
  child=launch(binary,['--host',endpoint,'events','--filter','type=container',...sources.flatMap(([,name])=>['--filter','container='+name]),'--format','{{json .}}'],{cwd:docker.sourceRoot,env:{...process.env,DOCKER_HOST:'',DOCKER_CONTEXT:docker.context},stdio:['ignore','pipe','pipe']});
  let partial='';child.stdout.setEncoding('utf8');child.stderr.resume();
  child.stdout.on('data',chunk=>{
   if(stopped)return;partial+=chunk;const lines=partial.split('\n');partial=lines.pop().slice(-65536);
   for(const line of lines){try{
    const value=JSON.parse(line),name=value.Actor?.Attributes?.name;
    const source=sources.find(([,n])=>n===name||n===value.Actor?.ID)?.[0];if(!source)continue;
    const action=value.Action||value.status;
    if(action.startsWith('health_status:')){const status=action.split(':')[1].trim();void record('Service health',status==='unhealthy'?'ERROR':'INFO',source+' health: '+status,source+':health');}
    else if(['start','stop','die','kill','restart','oom','destroy'].includes(action))void record('Environment lifecycle',['die','oom'].includes(action)?'WARN':'INFO',source+': '+action+(value.Actor?.Attributes?.exitCode?' · exit code: '+value.Actor.Attributes.exitCode:''));
   }catch{}}
  });
  child.on('error',()=>{if(!stopped)void record('Service health','WARN','Container event subscription failed; reopen the environment');});
  child.on('close',()=>{if(!stopped)void record('Service health','WARN','Container event subscription ended; reopen the environment');});
  const inspect=async(initial=false)=>{for(const [source,name] of sources){
   try{const state=JSON.parse(await docker.command(['inspect','--format','{{json .State}}',name],{endpoint,timeout:5000}));if(stopped)return;
    for(const check of state.Health?.Log||[]){
     if(!check.End||!Number.isInteger(check.ExitCode)||check.End<=(seenChecks.get(name)||'')||!Number.isFinite(Date.parse(check.End)))continue;
     seenChecks.set(name,check.End);
     const duration=Date.parse(check.End)-Date.parse(check.Start);
     if(normalizeEnvironmentPreferences(getPreferences()).environmentHealthDebug)void record('Service health','DEBUG',source+' health check completed · result='+(check.ExitCode===0?'passed':'failed')+' · exit_code='+check.ExitCode+' · completed_at='+check.End+(Number.isFinite(duration)?' · duration_ms='+Math.max(0,duration):''),undefined,{eventId:name+':health:'+check.End,time:new Date(check.End).toISOString()});
    }
    const health=state.Health?.Status||'not configured';if(initial)void record('Service health',health==='unhealthy'?'ERROR':'INFO',source+': '+(state.Running?'running':'stopped')+' · health: '+health,source+':initial');
   }catch{if(!stopped)void record('Service health','WARN',source+' state is unavailable',source+':initial');}
  }};
  const poll=async()=>{await inspect();if(!stopped){timer=setTimeout(poll,delay());timer.unref?.();}};
  await inspect(true);if(!stopped){timer=setTimeout(poll,delay());timer.unref?.();}
 })().catch(()=>{if(!stopped)void record('Service health','WARN','Health monitoring unavailable; check the container engine');});
 return {ready,stop(){stopped=true;clearTimeout(timer);if(child){child.kill();const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},1000);timer.unref();child.once('close',()=>clearTimeout(timer));}}};
}
