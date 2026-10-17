// Per-request deadlines. No retries, routing decisions, credentials or global state.
export function requestTimeout(phase) {
  return Object.assign(new Error(`请求超时（${phase}）`), {code:'REQUEST_TIMEOUT',phase});
}
export class RequestLifecycle {
  constructor({signal,timeouts={},stream=false}={}) {
    this.controller=new AbortController();this.signal=this.controller.signal;
    this.timeouts={queue:15000,connect:15000,tunnel:15000,tls:15000,headers:30000,body:30000,total:stream?0:60000,...timeouts};
    this.external=signal;this.cancel=()=>this.abort(signal.reason || Object.assign(new Error('请求已取消'),{name:'AbortError',code:'ABORT_ERR'}));
    signal?.addEventListener('abort',this.cancel,{once:true});
    if(signal?.aborted)this.cancel();
    if(!this.done && this.timeouts.total>0)this.totalTimer=setTimeout(()=>this.abort(requestTimeout('total')),this.timeouts.total);
    this.advance('queue');
  }
  rejectOnAbort(reject){
    if(this.signal.aborted){reject(this.signal.reason);return;}
    this.abortNotification=()=>reject(this.signal.reason);
    this.signal.addEventListener('abort',this.abortNotification,{once:true});
  }
  advance(phase){
    if(this.done || this.signal.aborted)return;
    this.phase=phase;clearTimeout(this.timer);
    if(this.timeouts[phase]>0)this.timer=setTimeout(()=>this.abort(requestTimeout(phase)),this.timeouts[phase]);
  }
  abort(error){if(!this.signal.aborted)this.controller.abort(error);this.finish();}
  finish(){this.done=true;clearTimeout(this.timer);clearTimeout(this.totalTimer);this.external?.removeEventListener('abort',this.cancel);this.signal.removeEventListener('abort',this.abortNotification);}
  bind(request,{customConnection=false}={}){
    request.once('socket',socket=>{
      if(customConnection || request.reusedSocket || !socket.connecting)this.advance('headers');
      else{this.advance('connect');socket.once('connect',()=>this.advance(socket.encrypted?'tls':'headers'));if(socket.encrypted)socket.once('secureConnect',()=>this.advance('headers'));}
    });
    request.once('response',response=>{this.advance('body');response.on('data',()=>this.advance('body'));response.once('end',()=>this.finish());response.once('error',()=>this.finish());});
    request.once('close',()=>this.finish());request.once('error',()=>this.finish());
  }
}
