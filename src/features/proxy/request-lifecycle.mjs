// Bounded, credential-free timings. Buckets separate request class, reuse and outcome.
export class PerformanceStats {
  constructor(){this.buckets=new Map();}
  reuse(){const result={};for(const [key,b] of this.buckets){const [kind,mode]=key.split('.');const item=result[kind] ||= {cold:0,reused:0,unassigned:0};item[mode]+=b.count;}for(const item of Object.values(result)){const n=item.cold+item.reused;item.reuseRate=n?item.reused/n:null;}return result;}
  start(kind){return new PhaseTimings(sample=>{const key=`${kind}.${sample.mode}.${sample.outcome}`;let bucket=this.buckets.get(key);if(!bucket){bucket={count:0,samples:[]};this.buckets.set(key,bucket);}this.cached=null;bucket.count++;bucket.samples.push(sample.phases);if(bucket.samples.length>128)bucket.samples.shift();});}
  snapshot(){if(this.cached)return this.cached;return this.cached=Object.fromEntries([...this.buckets].map(([key,b])=>{const phases={};for(const sample of b.samples)for(const [phase,value] of Object.entries(sample))(phases[phase] ||= []).push(value);return [key,{count:b.count,windowSamples:b.samples.length,phases:Object.fromEntries(Object.entries(phases).map(([phase,values])=>{values.sort((a,b)=>a-b);return [phase,{samples:values.length,p50Ms:Math.round(values[Math.ceil(values.length*.5)-1]*100)/100,p95Ms:Math.round(values[Math.ceil(values.length*.95)-1]*100)/100}];}))}];}));}
}
export class PhaseTimings {
  constructor(record){this.record=record;this.started=this.changed=performance.now();this.phase='queue';this.phases={};this.mode='unassigned';}
  advance(phase){if(this.done||phase===this.phase)return;const now=performance.now();this.phases[this.phase]=(this.phases[this.phase]||0)+now-this.changed;this.changed=now;this.phase=phase;if(phase==='connect')this.mode='cold';}
  finish(outcome){if(this.done)return;const now=performance.now();this.phases[this.phase]=(this.phases[this.phase]||0)+now-this.changed;this.phases.total=now-this.started;this.done=true;this.record({mode:this.mode,outcome,phases:this.phases});}
}
export function requestTimeout(phase) {return Object.assign(new Error(`请求超时（${phase}）`),{code:'REQUEST_TIMEOUT',phase});}
export class RequestLifecycle {
  constructor({signal,timeouts={},stream=false,timings}={}) {
    this.controller=new AbortController();this.signal=this.controller.signal;this.timings=timings;this.cleanups=[];
    this.timeouts={queue:15000,connect:15000,tunnel:15000,tls:15000,upload:30000,downstream:30000,headers:30000,body:30000,total:stream?0:60000,...timeouts};
    this.external=signal;this.cancel=()=>this.abort(signal.reason || Object.assign(new Error('请求已取消'),{name:'AbortError',code:'ABORT_ERR'}));
    signal?.addEventListener('abort',this.cancel,{once:true});if(signal?.aborted)this.cancel();
    if(!this.done&&this.timeouts.total>0)this.totalTimer=setTimeout(()=>this.abort(requestTimeout('total')),this.timeouts.total);
    this.advance(timings?.phase || 'queue');
  }
  rejectOnAbort(reject){if(this.signal.aborted){reject(this.signal.reason);return;}this.abortNotification=()=>reject(this.signal.reason);this.signal.addEventListener('abort',this.abortNotification,{once:true});}
  advance(phase){if(this.done||this.signal.aborted)return;this.phase=phase;this.timings?.advance(phase);clearTimeout(this.timer);if(this.timeouts[phase]>0)this.timer=setTimeout(()=>this.abort(requestTimeout(phase)),this.timeouts[phase]);}
  abort(error){if(!this.signal.aborted)this.controller.abort(error);this.finish(error?.code==='REQUEST_TIMEOUT'?'timeout':'cancelled');}
  finish(outcome='error'){
    if(this.done)return;this.done=true;clearTimeout(this.timer);clearTimeout(this.totalTimer);this.external?.removeEventListener('abort',this.cancel);this.signal.removeEventListener('abort',this.abortNotification);
    for(const clean of this.cleanups)clean();this.cleanups=[];
    this.timings?.finish(this.signal.aborted?(this.signal.reason?.code==='REQUEST_TIMEOUT'?'timeout':'cancelled'):outcome);
  }
  bind(request,{customConnection=false,uploadSource,downstream}={}){
    let responseSeen=false,ready=false;
    const watch=(emitter,event,fn)=>{emitter.on(event,fn);this.cleanups.push(()=>emitter.off(event,fn));};
    const sent=()=>{if(ready&&!responseSeen)this.advance(request.writableFinished?'headers':'upload');};
    watch(request,'finish',sent);
    if(uploadSource)watch(uploadSource,'data',()=>{if(this.phase==='upload')this.advance('upload');});
    watch(request,'drain',()=>{if(this.phase==='upload')this.advance('upload');});
    watch(request,'socket',socket=>{
      if(this.timings)this.timings.mode=request.reusedSocket?'reused':'cold';
      const connected=()=>{ready=true;sent();};
      if(customConnection||request.reusedSocket||!socket.connecting)connected();
      else{this.advance('connect');watch(socket,'connect',()=>{if(socket.encrypted)this.advance('tls');else connected();});if(socket.encrypted)watch(socket,'secureConnect',connected);}
    });
    watch(request,'response',response=>{
      responseSeen=true;this.responseOutcome=response.statusCode>=400?'http-error':'success';this.advance('body');
      const flow=()=>{if(!response.readableEnded)this.advance(downstream&&response.isPaused()?'downstream':'body');};
      watch(response,'data',flow);
      if(downstream){
        watch(response,'pause',flow);watch(response,'resume',flow);
        watch(downstream,'drain',()=>{if(this.phase==='downstream')this.advance('downstream');});
        watch(downstream,'finish',()=>this.finish(this.responseOutcome));watch(downstream,'close',()=>this.finish(downstream.writableFinished?this.responseOutcome:'cancelled'));
      }
      watch(response,'end',()=>{if(downstream&&!downstream.writableFinished)this.advance('downstream');else this.finish(this.responseOutcome);});
      watch(response,'error',()=>this.finish());
    });
    // Progress through a backed-up local socket must not count as upstream idle.
    if(uploadSource||downstream){let written=request.socket?.bytesWritten||0,delivered=downstream?.socket?.bytesWritten||0;
      const interval=setInterval(()=>{const next=request.socket?.bytesWritten||0,out=downstream?.socket?.bytesWritten||0;if(this.phase==='upload'&&next>written)this.advance('upload');if(this.phase==='downstream'&&out>delivered)this.advance('downstream');written=next;delivered=out;},Math.max(10,Math.min(1000,this.timeouts.upload/4,this.timeouts.downstream/4)));this.cleanups.push(()=>clearInterval(interval));
    }
    watch(request,'close',()=>{if(!responseSeen||!downstream||downstream.writableFinished)this.finish(downstream?.writableFinished?this.responseOutcome:'error');});watch(request,'error',()=>this.finish());
  }
}
