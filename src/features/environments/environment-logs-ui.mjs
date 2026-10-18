import {renderLogEntry} from './log-details.mjs';
export function mountEnvironmentLogs({api,scope}){
 const dialog=document.createElement('app-dialog');dialog.className='environment-logs-dialog';dialog.label='环境日志';
 dialog.innerHTML=`<div slot="label" class="environment-logs-heading"><wa-icon src="assets/icons/server.svg"></wa-icon><span data-title>环境日志</span><span class="environment-log-summary" data-summary><span data-running-dot aria-hidden="true"></span><span data-running-label>正在读取…</span><span data-uptime></span><span data-runtimes></span></span></div><div class="environment-logs-toolbar"><wa-input data-search size="s" placeholder="搜索日志…" aria-label="搜索日志"><wa-icon slot="start" src="assets/icons/search.svg"></wa-icon></wa-input><div class="environment-log-levels" aria-label="日志级别"></div><app-button data-copy appearance="plain" size="s"><wa-icon slot="start" src="assets/icons/copy.svg"></wa-icon>复制</app-button><app-button data-clear variant="danger" size="s" title="仅清空当前显示，不删除底层日志"><wa-icon slot="start" src="assets/icons/trash-2.svg"></wa-icon>清空</app-button></div><p data-notice class="environment-logs-notice" role="status" hidden></p><div class="environment-log-output" tabindex="0" aria-label="日志内容"></div><div slot="footer" class="environment-logs-footer"><span><span data-count></span><span data-status role="status"></span></span><app-button data-more class="content-action" appearance="plain" size="s"><wa-icon slot="start" src="assets/icons/arrow-up.svg"></wa-icon>显示更早日志</app-button><app-button data-latest class="content-action" appearance="plain" size="s"><wa-icon slot="start" src="assets/icons/arrow-down.svg"></wa-icon>跳至最新日志</app-button></div>`;
 document.body.append(dialog);const find=s=>dialog.querySelector(s),output=find('.environment-log-output'),levels=new Set(['DEBUG','INFO','WARN','ERROR']);
 let target=null,entries=[],visible=[],timer,subscription=null,expanded=new Set(),followLatest=true,layoutVersion=0,layoutPending=false,displayLimit=300,olderAnchor=null;
 const view=document.defaultView;
 const frame=()=>new Promise(resolve=>view.requestAnimationFrame?view.requestAnimationFrame(resolve):view.setTimeout(resolve,0));
 async function settleScroll(){
  const version=++layoutVersion;layoutPending=true;
  await Promise.all([dialog.updateComplete,...[...output.querySelectorAll("app-button")].map(row=>row.updateComplete)]);
  await frame();
  if(version!==layoutVersion||!subscription)return;
  if(olderAnchor!==null){output.scrollTop=output.scrollHeight-olderAnchor;olderAnchor=null;}else if(followLatest&&!expanded.size)output.scrollTop=output.scrollHeight;
  await frame();if(version===layoutVersion)layoutPending=false;
 }
 output.addEventListener("scroll",()=>{if(!layoutPending)followLatest=output.scrollHeight-output.scrollTop-output.clientHeight<40;});
 output.addEventListener("wheel",event=>{if(event.deltaY<0)followLatest=false;},{passive:true});
 dialog.addEventListener("wa-after-show",()=>{void settleScroll();});
 const focusRow=async id=>{const row=[...output.querySelectorAll('[data-log-id]')].find(el=>el.dataset.logId===id);if(row){await row.updateComplete;if(row.isConnected)row.focus({preventScroll:true});}};
 const key=e=>String(e.sequence);const same=()=>target&&JSON.stringify(scope())===JSON.stringify(target);
 for(const level of levels){const c=document.createElement('app-button');c.setAttribute('aria-pressed','true');c.dataset.level=level;c.size='s';c.textContent=level+' 0';c.addEventListener('click',()=>{levels.has(level)?levels.delete(level):levels.add(level);c.setAttribute('aria-pressed',String(levels.has(level)));render();});find('.environment-log-levels').append(c);}
 function render(){
  const query=String(find('[data-search]').value || '').toLowerCase();visible=entries.filter(e=>levels.has(e.level)&&`${e.source} ${e.message} ${e.time}`.toLowerCase().includes(query));
  for(const c of dialog.querySelectorAll('[data-level]'))c.textContent=c.dataset.level+' '+entries.filter(e=>e.level===c.dataset.level).length;
  const focused=document.activeElement?.dataset?.logId;const scrollTop=output.scrollTop;const bottom=followLatest&&!expanded.size;output.replaceChildren();
  if(!visible.length){const empty=document.createElement('div');empty.className='app-empty-state';const h=document.createElement('h2'),p=document.createElement('p');h.textContent=entries.length?'没有匹配的日志':'暂无日志';p.textContent=entries.length?'请更换搜索词或日志级别。':'新日志会自动显示在这里。';empty.append(h,p);output.append(empty);}else{const seen=new Map();for(const e of visible.slice(-displayLimit)){const k=key(e),n=(seen.get(k)||0)+1;seen.set(k,n);const id=k+'#'+n;output.append(renderLogEntry(document,e,{id,expanded:expanded.has(id),onToggle:()=>{expanded.has(id)?expanded.delete(id):expanded.add(id);render();void focusRow(id);}}));}}

  find('[data-count]').textContent=`显示 ${Math.min(visible.length,displayLimit)} / ${visible.length} 行 · 共 ${entries.length} 行`;find('[data-more]').hidden=visible.length<=displayLimit;find('[data-copy]').disabled=!visible.length;find('[data-clear]').disabled=!entries.length;output.scrollTop=bottom?output.scrollHeight:scrollTop;void settleScroll();if(focused)void focusRow(focused);
 }
 function showMetadata(result){
  find('[data-title]').textContent=result.name+' · 环境日志';
  find('[data-notice]').textContent=result.notice||'';find('[data-notice]').hidden=!result.notice;
  find('[data-running-label]').textContent=result.status || '状态不可读取';find('[data-running-dot]').dataset.running=String(Boolean(result.running));
  const started=Date.now(),seconds=result.uptime;
  const update=()=>{const elapsed=Number.isFinite(seconds)?seconds+(result.running?Math.floor((Date.now()-started)/1000):0):null;find('[data-uptime]').textContent=elapsed===null?'':` · ${Math.floor(elapsed/3600)}h ${Math.floor(elapsed%3600/60)}m ${Math.floor(elapsed%60)}s`;};
  clearInterval(timer);update();if(result.running)timer=setInterval(update,1000);
  find('[data-runtimes]').textContent=Number.isInteger(result.runtimeCount)?` · ${result.runtimeCount} 个运行时`:'';
 }
 api.onEvent(({type,data})=>{
  if(type!=='environmentLogs'||!subscription||data.token!==subscription)return;
  if(data.closed||!same()){close();return;}
  if(data.metadata)showMetadata(data.metadata);
  if(data.entries){if(!followLatest)displayLimit+=data.entries.length;entries=[...entries,...data.entries].sort((a,b)=>a.time.localeCompare(b.time)||a.sequence-b.sequence);const retained=new Set(entries.map(e=>key(e)+'#1'));for(const id of expanded)if(!retained.has(id))expanded.delete(id);render();}
  if(data.state){find('[data-status]').textContent=data.state==='streaming'?' · 实时接收':data.state==='ended'?' · 日志流已结束':' · 无可用日志源';if(data.state!=='streaming')clearInterval(timer);}
  if(data.notice){find('[data-notice]').hidden=false;find('[data-notice]').textContent=data.notice;}
 });
 function close(){const token=subscription;subscription=null;layoutVersion++;layoutPending=false;dialog.open=false;clearInterval(timer);entries=[];visible=[];expanded.clear();output.replaceChildren();if(token)void api.dockerEnvironments('logsStop',{token}).catch(()=>{});}
 dialog.addEventListener('wa-hide',close);find('[data-search]').addEventListener('input',render);
 find('[data-copy]').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(visible.map(e=>`${e.time} ${e.level} [${e.source}] ${e.message}`).join('\n'));find('[data-status]').textContent='已复制';}catch{find('[data-status]').textContent='复制失败，请重试';}});
 find('[data-clear]').addEventListener('click',()=>{entries=[];expanded.clear();render();});
 find('[data-more]').addEventListener('click',()=>{followLatest=false;olderAnchor=output.scrollHeight-output.scrollTop;displayLimit+=300;render();});
 find('[data-latest]').addEventListener('click',()=>{followLatest=true;output.scrollTop=output.scrollHeight;void settleScroll();});
 document.querySelector('#viewEnvironmentLogs').addEventListener('click',()=>{
  if(subscription)close();clearInterval(timer);subscription=crypto.randomUUID();const token=subscription;target=scope();entries=[];expanded.clear();followLatest=true;displayLimit=300;olderAnchor=null;
  find('[data-search]').value='';find('[data-title]').textContent='环境日志';find('[data-notice]').hidden=true;find('[data-status]').textContent=' · 正在订阅…';find('[data-running-label]').textContent='正在读取…';find('[data-running-dot]').dataset.running='false';find('[data-uptime]').textContent='';find('[data-runtimes]').textContent='';
  dialog.open=true;render();
  void api.dockerEnvironments('logsStart',{...target,token}).catch(error=>{if(subscription!==token)return;find('[data-notice]').hidden=false;find('[data-notice]').textContent=error.message;find('[data-status]').textContent='订阅失败';});
 });
}
