// Bounds requests before Node Agent's asynchronous connection creation and queue.
export class BoundedRequests {
  constructor(limit=4,capacity=16){this.limit=limit;this.capacity=capacity;this.active=0;this.queue=[];this.closed=false;}
  async acquire(signal,timeout=15000){
    signal?.throwIfAborted();
    if(this.closed)throw Object.assign(new Error('请求作用域已关闭'),{name:'AbortError'});
    if(this.active<this.limit){this.active++;return this.release();}
    if(this.queue.length>=this.capacity)throw Object.assign(new Error('请求繁忙，请稍后重试'),{code:'REQUEST_BUSY'});
    return new Promise((resolve,reject)=>{
      const item={resolve,reject,clean:()=>{clearTimeout(item.timer);signal?.removeEventListener('abort',cancel);}};
      const cancel=()=>{const index=this.queue.indexOf(item);if(index<0)return;this.queue.splice(index,1);item.clean();reject(signal?.aborted?signal.reason:Object.assign(new Error('请求排队超时'),{code:'REQUEST_TIMEOUT',phase:'queue'}));};
      this.queue.push(item);if(timeout>0)item.timer=setTimeout(cancel,timeout);signal?.addEventListener('abort',cancel,{once:true});
    });
  }
  release(){let done=false;return ()=>{if(done)return;done=true;this.active--;const next=this.queue.shift();if(next){next.clean();this.active++;next.resolve(this.release());}};}
  close(){this.closed=true;for(const item of this.queue.splice(0)){item.clean();item.reject(Object.assign(new Error('请求作用域已关闭'),{name:'AbortError'}));}}
}
