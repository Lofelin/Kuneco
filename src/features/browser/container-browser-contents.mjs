import {EventEmitter} from 'node:events';

// Fetch inside the page's container/network scope, never through the host UI.
const faviconExpression=`(async()=>{
 const links=[...document.querySelectorAll('link[rel~="icon"]')].map(link=>link.href);
 const candidates=[...new Set([...links,new URL('/favicon.ico',location.href).href])];
 for(const url of candidates){try{
  if(!/^(https?:|data:image\\/)/i.test(url))continue;
  const response=await fetch(url,{signal:AbortSignal.timeout(4000)});
  if(!response.ok)continue;
  const blob=await response.blob();if(!blob.type.startsWith('image/')||blob.size>262144)continue;
  return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>resolve('');reader.readAsDataURL(blob);});
 }catch{}}
 return '';
})()`;

// Desktop-compatible page interface; every website operation executes on the
// container CDP connection. The host view only displays image frames.
export class ContainerBrowserContents extends EventEmitter {
 constructor({engine,ready,nativeImage,viewer,allowed=()=>false,onPopup=()=>{},onNavigate=()=>{},onDialog=async()=>false,onFileChooser=async()=>{}}){
  super();Object.assign(this,{engine,ready,nativeImage,viewer,allowed,onPopup,onNavigate,onDialog,onFileChooser});this.url='about:blank';this.title='新标签页';this.zoom=1;this.destroyed=false;this.visible=false;this.size={width:1280,height:800};this.history={entries:[],currentIndex:0};this.frames=new Set();this.loadingFrames=new Set();
  this.debugger={sendCommand:async(method,params)=>{await this.initializeOnce();return this.engine.command(method,params,this.sessionId);}};
  this.navigationHistory={canGoBack:()=>this.history.currentIndex>0,canGoForward:()=>this.history.currentIndex<this.history.entries.length-1,goBack:()=>this.goHistory(-1),goForward:()=>this.goHistory(1)};
  this.listener=event=>{void this.handle(event).catch(()=>this.emit('did-fail-load',{},-2,'容器浏览器连接失败',this.url,true));};
 }
 initializeOnce(){if(this.initialized&&this.engine?.stopped)this.initialized=null;return this.initialized ||= this.initialize().catch(error=>{this.initialized=null;throw error;});}
 async initialize(){this.engine?.off('event',this.listener);this.engine=await this.ready();this.sessionId=null;this.targetId=null;this.frames.clear();this.loadingFrames.clear();if(this.destroyed)throw Error('标签已关闭');this.engine.on('event',this.listener);const {targetId}=await this.engine.command('Target.createTarget',{url:'about:blank'});this.targetId=targetId;if(this.destroyed){await this.engine.command('Target.closeTarget',{targetId});throw Error('标签已关闭');}const {sessionId}=await this.engine.command('Target.attachToTarget',{targetId,flatten:true});this.sessionId=sessionId;if(this.destroyed){await this.engine.command('Target.closeTarget',{targetId});throw Error('标签已关闭');}
  await this.engine.command('Page.enable',{},sessionId);await this.engine.command('Runtime.enable',{},sessionId);
  // Request interception prevents local/private URLs and agent-disallowed navigation,
  // including redirects. Firewall remains authoritative even if interception fails.
  await this.engine.command('Page.setInterceptFileChooserDialog',{enabled:true},sessionId);
  await this.resize(this.size,true);if(this.visible)await this.engine.command('Page.startScreencast',{format:'jpeg',quality:95,maxWidth:3840,maxHeight:2880,everyNthFrame:1},sessionId);return this;
 }
 async handle({method,params:p,sessionId}){
  if(this.destroyed)return;
  if(sessionId!==this.sessionId){if(method==='Page.fileChooserOpened'&&this.engine.policySession(sessionId)===this.sessionId)await this.onFileChooser({...p,cdpSessionId:sessionId},this);return;}
  if(method==='Page.screencastFrame'){await this.engine.command('Page.screencastFrameAck',{sessionId:p.sessionId},sessionId);if(this.visible&&!this.viewer.isDestroyed())this.viewer.send('container-browser:frame',p.data);}
  if(method==='Page.frameNavigated'&&!p.frame.parentId&&p.frame.url==='about:blank'&&this.requestedURL&&this.requestedURL!=='about:blank')return;
  if(method==='Page.frameNavigated'){this.frames.add(p.frame.id);this.onNavigate(p.frame.url);}
  if(method==='Page.frameAttached')this.frames.add(p.frameId);
  if(method==='Page.frameDetached')this.frames.delete(p.frameId);
  if(method==='Page.frameNavigated'&&!p.frame.parentId){this.url=p.frame.url;this.faviconVersion=(this.faviconVersion||0)+1;this.emit('page-favicon-updated',{},[]);this.emit('did-navigate',{},this.url);}
  if(method==='Page.navigatedWithinDocument'){this.url=p.url;this.emit('did-navigate-in-page',{},this.url);}
  if(method==='Page.frameStartedLoading'){this.loadingFrames.add(p.frameId);this.emit('did-start-loading');}
  if(method==='Page.frameStoppedLoading'){this.loadingFrames.delete(p.frameId);if(!this.loadingFrames.size)this.emit('did-stop-loading');}
  if(method==='Page.frameDetached'&&this.loadingFrames.delete(p.frameId)&&!this.loadingFrames.size)this.emit('did-stop-loading');
  if(method==='Page.loadEventFired'){
   const result=await this.engine.command('Runtime.evaluate',{expression:'document.title',returnByValue:true},sessionId);this.title=result.result.value||'网页';this.emit('page-title-updated',{},this.title);
   this.history=await this.engine.command('Page.getNavigationHistory',{},sessionId);this.emit('did-stop-loading');this.emit('did-finish-load');void this.updateFavicon().catch(()=>{});await this.refreshFrame().catch(()=>{});
  }
  if(method==='Page.fileChooserOpened'){try{await this.onFileChooser(p,this);}catch(error){this.emit('notice',error.message);}}
  if(method==='Page.javascriptDialogOpening'){let accept=false;if(p.type==='prompt')this.emit('notice','此网页请求文本输入，当前容器浏览器暂不支持该类网页弹窗。');else accept=await this.onDialog(p);await this.engine.command('Page.handleJavaScriptDialog',{accept:Boolean(accept)},sessionId);}
  if(method==='Page.windowOpen'&&this.allowed(p.url))this.onPopup(p.url);
  if(method==='Inspector.detached'){this.initialized=null;this.sessionId=null;this.frames.clear();this.emit('did-fail-load',{},-2,'页面连接已断开，请重新加载',this.url,true);}
 }
 isDestroyed(){return this.destroyed;}
 getURL(){return this.url;}
 getTitle(){return this.title;}
 async updateFavicon(){const version=this.faviconVersion,url=this.url,sessionId=this.sessionId,engine=this.engine;
  if(!/^https?:/.test(url)||!sessionId)return;
  const result=await engine.command('Runtime.evaluate',{expression:faviconExpression,awaitPromise:true,returnByValue:true},sessionId);
  const icon=result.result?.value;
  if(!this.destroyed&&this.engine===engine&&this.sessionId===sessionId&&this.url===url&&this.faviconVersion===version&&typeof icon==='string'&&/^data:image\//i.test(icon)&&icon.length<360000)this.emit('page-favicon-updated',{},[icon]);
 }
 getZoomFactor(){return this.zoom;}
 async loadURL(url){this.requestedURL=url;await this.initializeOnce();if(this.destroyed)throw Error('标签已关闭');if(!this.allowed(url))throw Error('容器浏览器禁止访问此地址');this.url=url;const result=await this.engine.command('Page.navigate',{url},this.sessionId);if(result.errorText){const error=Error(result.errorText);if(result.errorText==='net::ERR_ABORTED')error.code='ERR_ABORTED';throw error;}}
 async executeJavaScript(expression,userGesture=false){await this.initializeOnce();const result=await this.engine.command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture},this.sessionId);if(result.exceptionDetails)throw Error(result.exceptionDetails.text||'网页脚本执行失败');return result.result.value;}
 async refreshFrame(){if(!this.visible||this.destroyed||!this.sessionId)return;const engine=this.engine,sessionId=this.sessionId;const {data}=await engine.command('Page.captureScreenshot',{format:'jpeg',quality:95,captureBeyondViewport:false},sessionId);if(data&&this.visible&&!this.destroyed&&this.engine===engine&&this.sessionId===sessionId&&!this.viewer.isDestroyed())this.viewer.send('container-browser:frame',data);}
 async capturePage(){await this.initializeOnce();const {data}=await this.engine.command('Page.captureScreenshot',{format:'png'},this.sessionId);return this.nativeImage.createFromBuffer(Buffer.from(data,'base64'));}
 setZoomFactor(value){this.zoom=value;void this.initializeOnce().then(()=>this.resize(this.size,true)).catch(()=>{});}
 async resize(size,force=false){if(!force&&this.size.width===size.width&&this.size.height===size.height)return;this.size={width:Math.max(1,Math.round(size.width)),height:Math.max(1,Math.round(size.height))};if(!this.sessionId)return;
  const {windowId}=await this.engine.command('Browser.getWindowForTarget',{targetId:this.targetId});if(windowId!==undefined)await this.engine.command('Browser.setWindowBounds',{windowId,bounds:{...this.size,windowState:'normal'}});
  await this.engine.command('Emulation.setDeviceMetricsOverride',{...this.size,screenWidth:this.size.width,screenHeight:this.size.height,deviceScaleFactor:1,mobile:false,scale:1},this.sessionId);
  await this.engine.command('Emulation.setPageScaleFactor',{pageScaleFactor:this.zoom},this.sessionId);
 }
 setVisible(value){if(this.visible===value)return;this.visible=value;if(!this.initialized)return;void this.initializeOnce().then(()=>{if(this.visible!==value||this.destroyed)return;return this.engine.command(value?'Page.startScreencast':'Page.stopScreencast',value?{format:'jpeg',quality:95,maxWidth:3840,maxHeight:2880,everyNthFrame:1}:{},this.sessionId).then(()=>{if(value)return this.refreshFrame();});}).catch(()=>{});}
 stop(){if(!this.initialized)return;void this.initializeOnce().then(()=>this.engine.command('Page.stopLoading',{},this.sessionId)).catch(()=>{});}
 reload(){void this.initializeOnce().then(()=>this.engine.command('Page.reload',{},this.sessionId)).catch(()=>{});}
 async goHistory(delta){await this.initializeOnce();const history=await this.engine.command('Page.getNavigationHistory',{},this.sessionId);const entry=history.entries[history.currentIndex+delta];if(entry)await this.engine.command('Page.navigateToHistoryEntry',{entryId:entry.id},this.sessionId);}
 async input(value){await this.initializeOnce();if(!this.visible||this.destroyed)return;
  if(value.type==='text'){await this.engine.command('Input.insertText',{text:String(value.text).slice(0,20000)},this.sessionId);return;}
  if(value.type==='mouse'){const {event,x,y,button='none',buttons=0,deltaX=0,deltaY=0,clickCount=0}=value;if(!['mouseMoved','mousePressed','mouseReleased','mouseWheel'].includes(event)||![x,y,deltaX,deltaY].every(Number.isFinite)||!['none','left','right','middle'].includes(button))return;await this.engine.command('Input.dispatchMouseEvent',{type:event,x,y,button,buttons,deltaX,deltaY,clickCount},this.sessionId);}
  if(value.type==='key'){const event={type:value.event,key:String(value.key||'').slice(0,40),code:String(value.code||'').slice(0,40),windowsVirtualKeyCode:Number(value.keyCode)||0,modifiers:Number(value.modifiers)||0};if(!['keyDown','keyUp'].includes(event.type))return;if(event.type==='keyDown'&&event.key==='Enter'){event.text='\r';event.unmodifiedText='\r';}let prevented=false;this.emit('before-input-event',{preventDefault:()=>{prevented=true;}},{type:event.type,key:event.key,control:Boolean(event.modifiers&2),meta:Boolean(event.modifiers&4),shift:Boolean(event.modifiers&8)});if(!prevented)await this.engine.command('Input.dispatchKeyEvent',event,this.sessionId);}
 }
 findInPage(text,{forward=true}={}){void this.executeJavaScript(`window.find(${JSON.stringify(text)},false,${!forward},true)`).then(found=>this.emit('found-in-page',{}, {matches:found?1:0,activeMatchOrdinal:found?1:0,finalUpdate:true})).catch(()=>{});}
 stopFindInPage(){void this.executeJavaScript('getSelection()?.removeAllRanges()').catch(()=>{});}
 async downloadURL(url){await this.initializeOnce();if(!this.allowed(url))throw Error('当前代理或下载地址不可用');return this.engine.command('Page.navigate',{url},this.sessionId);}
 close(){if(this.destroyed)return;this.destroyed=true;this.engine?.off('event',this.listener);if(this.targetId)void this.engine.command('Target.closeTarget',{targetId:this.targetId}).catch(()=>{});this.emit('destroyed');}
}
