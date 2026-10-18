import {renderTurnChangeCard} from './turn-change-card.mjs';
import {reducedMotion} from '../../shared/ui/motion.mjs';
import {renderReviewDiff} from './review-diff.mjs';
import {renderFileDiffs} from './file-diff.mjs';
const button=(label,icon,fn)=>{const b=document.createElement('app-button');b.type='button';b.className='content-action';const i=document.createElement('wa-icon');i.slot='start';i.src='assets/icons/'+icon+'.svg';b.append(i,document.createTextNode(label));b.addEventListener('click',fn);return b;};
const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
const fmt=n=>Number.isFinite(n)?n.toLocaleString():'未知';
export {sandboxHTML} from './artifact-sandbox.mjs';
export function mountInsightsPanel({page,api,scope,updateMarkdown,onOpenFullView,onExitFullView,onScopeChange}){
 const workspace=document.createElement('div');workspace.className='chat-workspace';const column=document.createElement('div');column.className='chat-column';
 for(const id of ['chat','chatJumpLatest','approval','chatForm'])column.append(document.getElementById(id));
 const turnBar=document.createElement('div');turnBar.className='turn-changes-bar';turnBar.hidden=true;column.insertBefore(turnBar,column.querySelector('#chatForm'));
 const aside=document.createElement('aside');aside.className='chat-insights';aside.setAttribute('aria-label','对话产物');
 const divider=document.createElement('div');divider.className='chat-splitter';divider.tabIndex=0;divider.setAttribute('role','separator');divider.setAttribute('aria-label','调整产物侧栏宽度');divider.setAttribute('aria-orientation','vertical');
 workspace.append(column);page.append(workspace);
 const dock=document.createElement('div');dock.className='window-insights';dock.append(divider,aside);document.body.append(dock);
 const trigger=document.createElement('app-button');trigger.id='toggleArtifacts';trigger.className='icon-button insights-trigger';trigger.setAttribute('appearance','plain');trigger.setAttribute('aria-controls','artifactWindowPanel');const icon=document.createElement('wa-icon');icon.src='assets/icons/panel-right.svg';icon.setAttribute('aria-hidden','true');trigger.append(icon);document.body.append(trigger);dock.id='artifactWindowPanel';
 const fullHost=document.createElement('section');fullHost.id='page-insights';fullHost.className='page hidden insights-full-page';page.parentElement.append(fullHost);
 const expand=button('','maximize',()=>fullView?exitFullView():onOpenFullView?.({view:preferences.view||'changes',scopeKey:key()}));expand.id='expandInsights';expand.className='icon-button insights-trigger insights-expand';expand.setAttribute('appearance','plain');expand.setAttribute('icon-only','');expand.setAttribute('aria-label','进入完整视图');expand.title='进入完整视图';document.body.append(expand);
 let fullView=false;
 function exitFullView(){onExitFullView?.();setOpen(true);save();}
 function setFullView(view){fullView=Boolean(view);expand.title=fullView?'退出完整视图':'进入完整视图';expand.setAttribute('aria-label',expand.title);expand.querySelector('wa-icon').src='assets/icons/'+(fullView?'minimize':'maximize')+'.svg';document.body.classList.toggle('insights-full-mode',fullView);if(fullView){preferences.view=view;setOpen(false);fullHost.append(aside);save();render();}else{dock.append(aside);} }
 const changesEntry=button('变更','file-text',()=>openChanges('conversation'));changesEntry.id='sessionChangesEntry';changesEntry.className='session-changes-entry menu-action';page.querySelector('.session-information').prepend(changesEntry);
 const usage=document.createElement('section');usage.className='session-usage';usage.setAttribute('aria-label','用量与上下文');page.querySelector('.session-information').append(usage);
 const infoMenu=page.querySelector('#sessionInfoMenu'), menuBody=page.querySelector('.session-information');
 const detail=document.createElement('div');detail.className='session-detail-flyout';detail.setAttribute('popover','manual');detail.setAttribute('role','region');document.body.append(detail);
 const info=document.createElement('section');info.append(menuBody.querySelector('h2'),menuBody.querySelector('dl'));info.hidden=true;usage.hidden=true;detail.append(info,usage);
 const hideDetail=()=>{if(detail.matches(':popover-open'))detail.hidePopover();};
 const positionDetail=()=>{const r=infoMenu.shadowRoot.querySelector('[part~=menu]').getBoundingClientRect();detail.style.width=Math.min(340,innerWidth-24)+'px';detail.style.left=Math.max(12,r.left-detail.offsetWidth-12)+'px';detail.style.top=Math.max(12,Math.min(r.top,innerHeight-detail.offsetHeight-12))+'px';};
 const showDetail=(section,label)=>{hideDetail();info.hidden=section!==info;usage.hidden=section!==usage;detail.setAttribute('aria-label',label);detail.showPopover();positionDetail();if(!reducedMotion())detail.animate([{opacity:0,transform:'translateX(10px)'},{opacity:1,transform:'translateX(0)'}],{duration:160,easing:'ease-out'});};
 for(const [label,icon,section] of [['会话信息','file-text',info],['用量与上下文','boxes',usage]]){const row=button(label,icon,()=>showDetail(section,label));row.className='session-detail-entry menu-action';row.setAttribute('aria-haspopup','true');const arrow=document.createElement('wa-icon');arrow.src='assets/icons/chevron-left.svg';arrow.slot='end';row.append(arrow);menuBody.append(row);}
 infoMenu.addEventListener('wa-hide',hideDetail);window.addEventListener('resize',hideDetail);
 document.addEventListener('pointerdown',e=>{if(!detail.contains(e.target)&&!infoMenu.contains(e.target))hideDetail();});
 detail.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();hideDetail();page.querySelector('#sessionInfoTrigger').focus();}});
 let current='',version=0,data=null,activeArtifact=null,preferences={};const undoStates=new Map();
 const tabs=()=>preferences.openTabs||['changes'];
 const addTab=view=>{preferences.openTabs=[...new Set([...tabs(),view])];preferences.view=view;};
 const key=()=>JSON.stringify(scope());const save=()=>{try{localStorage.setItem('chat-insights:'+current,JSON.stringify(preferences));}catch{}};
 const setOpen=open=>{preferences.open=Boolean(open);dock.classList.toggle('insights-open',preferences.open);dock.inert=!preferences.open;dock.setAttribute('aria-hidden',String(!preferences.open));trigger.setAttribute('aria-expanded',String(preferences.open));trigger.setAttribute('aria-label',preferences.open?'收起产物侧栏':'展开产物侧栏');trigger.title=trigger.getAttribute('aria-label');};
 trigger.addEventListener('click',()=>{if(fullView){exitFullView();return;}const opening=!preferences.open;if(opening){preferences.view='changes';preferences.openTabs=['changes'];}setOpen(opening);save();if(opening){render();void refresh(true);}});
 page.querySelector('#sessionInfoMenu').addEventListener('wa-show',()=>void refresh(true));
 const section=(name,id)=>{const d=document.createElement('details');d.open=preferences[id]??true;d.append(text('summary',name));d.addEventListener('toggle',()=>{if(!d.isConnected)return;preferences[id]=d.open;save();});aside.append(d);return d;};
 const error=e=>{const p=text('p',e.message||String(e));p.className='insights-error';p.setAttribute('role','alert');aside.append(p);};
 async function preview(artifact,host,latest=false){const requestKey=current,requestVersion=version;host.replaceChildren(text('p','正在读取产物…'));try{const result=await api.chatArtifact({...scope(),id:artifact.id,version:!latest});if(current!==requestKey||version!==requestVersion)return;host.replaceChildren(text('p',(result.snapshot?'生成时版本':'当前环境文件')+' · '+artifact.path));
  if(result.kind==='image'){const img=document.createElement('img');img.src=result.dataURL;img.alt=artifact.path;host.append(img);}
  else if(result.kind==='html'){const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';frame.title='隔离的 HTML 产物预览';frame.src=result.url;const source=document.createElement('details');source.append(text('summary','查看源代码'),text('pre',result.text));host.append(frame,source);}
  else if(result.kind==='markdown'){const content=document.createElement('div');updateMarkdown(content,result.text);host.append(content);}
  else host.append(text('pre',result.text));
 }catch(e){if(current===requestKey)host.replaceChildren(text('p','预览失败：'+e.message));}}
 const countLabel=file=>file?.added===null?'无法统计':`+${file?.added??0} −${file?.removed??0}`;
 const appendCounts=(host,value)=>{if(value?.added===null){host.append(text('span','无法统计'));return;}const a=text('span','+'+(value?.added??0)),d=text('span','−'+(value?.removed??0));a.className='change-additions';d.className='change-deletions';host.append(a,document.createTextNode(' '),d);};
 function openChanges(id){addTab('changes');preferences.reviewTurn=id;page.querySelector('#sessionInfoMenu').open=false;setOpen(true);save();render();void refresh(true);}
 async function confirmUndo(turn){
  const dialog=document.createElement('app-dialog');dialog.label='撤销本轮文件变更';
  const description=text('p','将恢复这 '+turn.files.length+' 个文件的修改前状态。撤销前核对文件内容；检测到后续修改时停止，并保留恢复备份。');
  const list=document.createElement('ul');for(const file of turn.files)list.append(text('li',file.path));
  let decide;const choice=new Promise(resolve=>decide=resolve);
  const cancel=button('取消','x',()=>{decide(false);dialog.open=false;});cancel.slot='footer';
  const confirm=button('确认撤销','check',()=>{decide(true);dialog.open=false;});confirm.classList.add('primary');confirm.slot='footer';
  dialog.append(description,list,cancel,confirm);document.body.append(dialog);dialog.addEventListener('wa-after-hide',event=>{if(event.target===dialog){decide(false);dialog.remove();}});
  await dialog.updateComplete;dialog.open=true;return choice;
 }
 async function undoTurn(turn){
  const requestKey=current,requestScope={...scope()};if(undoStates.get(turn.id)?.pending||!turn.undo?.available||data?.running)return;
  if(!await confirmUndo(turn)||requestKey!==current||key()!==requestKey)return;
  undoStates.set(turn.id,{pending:true});renderTurnChanges();
  try{const result=await api.chatUndo({...requestScope,turnId:turn.id});undoStates.set(turn.id,{reverted:true,backups:result?.backups});}
  catch(error){undoStates.set(turn.id,{error:error.message});}
  if(current===requestKey){await refresh(true);renderTurnChanges();}
 }
 function renderTurnChanges(){
  turnBar.hidden=true;
  changesEntry.replaceChildren();const icon=document.createElement('wa-icon');icon.src='assets/icons/file-text.svg';icon.slot='start';changesEntry.append(icon,text('strong','变更'));const totals=text('span','');totals.className='change-entry-totals';const files=data?.conversationChanges?.files||[];totals.append(text('span',files.length+' 个文件'));if(files.length){const known=files.filter(f=>Number.isFinite(f.added)&&Number.isFinite(f.removed));if(known.length){totals.append(document.createTextNode(' · '));appendCounts(totals,{added:known.reduce((n,f)=>n+f.added,0),removed:known.reduce((n,f)=>n+f.removed,0)});}}changesEntry.append(totals);changesEntry.disabled=!scope().chatId;
  const turns=data?.changeHistory||[];
  const live=new Set(turns.map(turn=>turn.id));
  for(const host of page.querySelectorAll('.turn-change-card'))if(!live.has(host.dataset.turnId))host.remove();
  const chat=column.querySelector('#chat');
  for(const turn of [...turns].reverse()){
   if(!turn.files.length)continue;
   let host=[...page.querySelectorAll('.turn-change-card')].find(node=>node.dataset.turnId===turn.id);
   if(!host){host=document.createElement('section');host.dataset.turnId=turn.id;}
   const nodes=[...chat.querySelectorAll('.bubble.assistant')];
   const message=nodes.find(node=>node.messageFileChangeTurnId===turn.id);
   if(message)message.append(host);else{turnBar.append(host);turnBar.hidden=false;}
   renderTurnChangeCard(host,turn,{running:Boolean(data?.running),undoState:undoStates.get(turn.id),onReview:path=>{preferences.reviewFile=path||null;if(path)(preferences.reviewExpanded||={})[turn.id+':'+path]=true;openChanges(turn.id);},onUndo:()=>void undoTurn(turn)});
  }
 }
 function renderChanges(){
  aside.classList.add('changes-review');
  const change=preferences.reviewTurn&&preferences.reviewTurn!=='conversation'?data?.changeHistory?.find(turn=>turn.id===preferences.reviewTurn):data?.conversationChanges;
  const toolbar=document.createElement('div');toolbar.className='changes-review-toolbar';aside.append(toolbar);
  const files=document.createElement('wa-select');files.size='s';files.pill=true;files.className='changes-file-select';files.setAttribute('aria-label','当前会话变更文件');
  const all=document.createElement('wa-option');all.value='__all__';all.textContent='全部文件';files.append(all);
  for(const f of change?.files||[]){const o=document.createElement('wa-option');o.value=f.path;o.textContent=f.path.split('/').pop();o.title=f.path;files.append(o);}
  const selected=change?.files.some(f=>f.path===preferences.reviewFile)?preferences.reviewFile:'__all__';
  files.value=selected;files.addEventListener('change',()=>{preferences.reviewFile=files.value==='__all__'?null:files.value;if(preferences.reviewFile)(preferences.reviewExpanded||={})[change.id+':'+files.value]=true;save();render();});toolbar.append(files);
  if(!change?.files.length){files.disabled=true;const empty=document.createElement('div');empty.className='app-empty-state insights-empty';const icon=document.createElement('wa-icon');icon.src='assets/icons/file-text.svg';empty.append(icon,text('p','当前会话暂无已确认的文件变更。'));aside.append(empty);return;}
  const menu=document.createElement('wa-dropdown');menu.className='review-more-menu';menu.placement='bottom-end';
  const more=button('','ellipsis',()=>{});more.slot='trigger';more.className='icon-button';more.setAttribute('appearance','plain');more.setAttribute('icon-only','');more.setAttribute('aria-label','变更更多选项');menu.append(more);
  const item=(label,icon,run,checked=false,disabled=false)=>{const e=document.createElement('wa-dropdown-item');const i=document.createElement('wa-icon');i.slot='icon';i.src='assets/icons/'+icon+'.svg';e.append(i,document.createTextNode(label));if(checked){const mark=document.createElement('wa-icon');mark.slot='details';mark.src='assets/icons/check.svg';e.append(mark);}e.disabled=disabled;e.addEventListener('click',()=>{if(disabled)return;menu.open=false;run();});menu.append(e);return e;};
  const toggle=key=>{preferences[key]=!preferences[key];save();render();};
  item('刷新','rotate-cw',()=>void refresh(true));
  item('自动换行','file-text',()=>toggle('reviewWrap'),preferences.reviewWrap);
  item(preferences.diffMode==='split'?'改用统一差异视图':'改用左右差异视图','panel-left',()=>{preferences.diffMode=preferences.diffMode==='split'?'unified':'split';save();render();});
  item('折叠全部差异','chevron-up',()=>{for(const f of change.files)(preferences.reviewExpanded||={})[change.id+':'+f.path]=false;save();render();});
  const separator=document.createElement('div');separator.className='tab-menu-divider';separator.setAttribute('role','separator');menu.append(separator);
  item('显示完整文件上下文','file-text',()=>toggle('reviewFullContext'),preferences.reviewFullContext);
  for(const [label,icon] of [['渲染预览','image'],['词级差异','file-text'],['隐藏空白字符','file-text'],['隐藏导入内容','boxes'],['复制 git apply 命令','copy']]){const e=item(label,icon,()=>{},false,true);e.title='当前差异查看器尚不支持此选项';}
  toolbar.append(menu);aside.classList.toggle('review-wrap',Boolean(preferences.reviewWrap));
  const list=document.createElement('div');list.className='review-files';aside.append(list);
  for(const [index,file] of change.files.entries()){
   if(selected!=='__all__'&&file.path!==selected)continue;
   const row=document.createElement('section');row.className='review-file';row.dataset.path=file.path;const id=change.id+':'+file.path;let open=preferences.reviewExpanded?.[id]??index===0;
   const title=document.createElement('app-button');title.className='review-file-toggle';title.setAttribute('layout','custom');title.title=file.path;
   const ext=file.path.split('.').pop().toLowerCase();const badge=text('span',({js:'JS',mjs:'JS',ts:'TS',css:'CSS',md:'M↓',html:'HTML',json:'{}'})[ext]||'TXT');badge.className='review-file-badge type-'+ext;badge.slot='start';
   const name=document.createElement('span');name.className='review-file-path';const slash=file.path.lastIndexOf('/');name.append(text('span',file.path.slice(0,slash+1)),text('strong',file.path.slice(slash+1)));const counts=text('span','');counts.className='review-file-counts';appendCounts(counts,file);title.append(badge,name,counts);
   const host=document.createElement('div');host.className='changes-review-diff';host.hidden=!open;title.setAttribute('aria-expanded',String(open));title.onclick=()=>{open=!open;host.hidden=!open;title.setAttribute('aria-expanded',String(open));(preferences.reviewExpanded||={})[id]=open;save();};
   if(preferences.diffMode==='split'){renderFileDiffs(host,{changes:[file.change],diffExpanded:{[file.path]:true},diffMode:'split'});}else renderReviewDiff(host,file.change,{expanded:preferences.contextExpanded?.[id]||{},expandAll:preferences.reviewFullContext,onToggle:(key,value)=>{((preferences.contextExpanded||={})[id]||={})[key]=value;save();}});
   row.append(title,host);list.append(row);
  }
 }
 function render(){aside.classList.remove('changes-review');aside.replaceChildren();usage.replaceChildren(text('h2','用量与上下文'));const header=document.createElement('div');header.className='insights-heading';header.classList.add('insights-tabs');header.setAttribute('role','tablist');header.setAttribute('aria-label','侧栏内容');
  for(const [view,label,icon] of [['artifacts','产物','folder'],['changes','变更','file-text']].filter(([view])=>tabs().includes(view))){const selected=(preferences.view||'changes')===view;const tab=button(label,icon,()=>{preferences.view=view;save();render();aside.querySelector('[aria-selected=true]')?.focus();});tab.className='insights-tab';tab.setAttribute('role','tab');tab.id='insights-tab-'+view;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;tab.setAttribute('aria-controls','insights-tab-content');tab.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const open=tabs();preferences.view=e.key==='Home'?open[0]:e.key==='End'?open.at(-1):open[(open.indexOf(view)+1)%open.length];save();render();aside.querySelector('[aria-selected=true]')?.focus();});const item=document.createElement('div');item.className='insights-tab-item';item.dataset.selected=String(selected);item.append(tab);
   if(selected){const close=button('','x',()=>{preferences.openTabs=tabs().filter(v=>v!==view);preferences.view=preferences.openTabs[0]||null;save();render();});close.className='icon-button insights-tab-close';close.setAttribute('appearance','plain');close.setAttribute('icon-only','');close.setAttribute('aria-label','关闭'+label+'标签');item.append(close);}header.append(item);}
const add=document.createElement('wa-dropdown');add.placement='bottom-start';const plus=button('','plus',()=>{});plus.slot='trigger';plus.className='icon-button';plus.setAttribute('appearance','plain');plus.setAttribute('aria-label','打开侧栏标签');add.append(plus);for(const [view,label] of [['changes','变更'],['artifacts','产物']]){const option=document.createElement('wa-dropdown-item');option.textContent=label;option.addEventListener('click',()=>{add.open=false;addTab(view);save();render();});add.append(option);}header.append(add);
aside.append(header);aside.id='insights-tab-content';aside.setAttribute('role','tabpanel');aside.setAttribute('aria-labelledby','insights-tab-'+(preferences.view||'changes'));renderTurnChanges();
  if(!data){const message=scope().chatId?'正在读取真实运行时数据…':'选择对话后查看';const empty=document.createElement('div');empty.className='app-empty-state insights-empty';const icon=document.createElement('wa-icon');icon.src='assets/icons/folder.svg';empty.append(icon,text('h2',scope().chatId?'正在读取产物':'选择一个对话'),text('p',scope().chatId?'正在读取当前环境的真实记录。':'该对话生成的文件与预览会显示在这里。'));aside.append(empty);usage.append(text('p',message));return;}
  const d={...data.usage?.details};if(data.compression?.status==='completed'&&data.compression.at>data.usage?.at)d.contextTokens=null;
  const facts=document.createElement('dl');for(const [label,value] of [['会话累计消耗',fmt(data.totalTokens)+' Token'],['最近回复消耗',fmt(data.usage?.totalTokens)+' Token'],['输入 / 输出',fmt(d?.input)+' / '+fmt(d?.output)],['缓存命中',fmt(d?.cacheRead)],['最近请求输入',fmt(d?.contextTokens)+' Token'],['模型上下文容量',fmt(d?.contextLimit)+' Token']])facts.append(text('dt',label),text('dd',value));usage.append(text('p','累计消耗不代表当前上下文占用。最近请求输入为运行时实测；未提供的数据显示未知。'),facts);
  if(d?.contextLimit&&Number.isFinite(d.contextTokens)){const p=document.createElement('progress');p.max=d.contextLimit;p.value=d.contextTokens;p.setAttribute('aria-label','最近请求输入占模型容量');usage.append(p,text('p','最近输入占容量 '+Math.round(d.contextTokens/d.contextLimit*100)+'%'));}
  if(!tabs().length){const empty=document.createElement('div');empty.className='app-empty-state insights-empty';const icon=document.createElement('wa-icon');icon.src='assets/icons/panel-right.svg';empty.append(icon,text('h2','没有打开的标签'),text('p','点击上方加号打开变更或产物。'));aside.append(empty);return;}
  if((preferences.view||'changes')==='changes'){renderChanges();return;}
  if(!data.artifacts.length){const empty=document.createElement('div');empty.className='app-empty-state insights-empty';empty.append(text('h2','暂无产物'),text('p','运行时成功写入文件后会出现在这里。'));const icon=document.createElement('wa-icon');icon.src='assets/icons/folder.svg';empty.prepend(icon);aside.append(empty);return;}const artifacts=section('真实产物 · '+data.artifacts.length,'artifacts');
  for(const a of [...data.artifacts].reverse()){const entry=document.createElement('details');entry.open=preferences['artifact:'+a.id]??false;entry.append(text('summary',a.path.split('/').pop()+' · v'+a.version));entry.addEventListener('toggle',()=>{if(!entry.isConnected)return;preferences['artifact:'+a.id]=entry.open;save();});const meta=text('p',a.path);entry.append(meta);const body=document.createElement('div');body.className='artifact-preview';entry.append(button('预览版本','file-text',()=>{activeArtifact=a.id;void preview(a,body);}),button('读取当前文件','rotate-cw',()=>preview(a,body,true)),button('定位来源','messages-square',()=>{const nodes=[...document.querySelector('#chat').children];const node=nodes.find(n=>n.messageReasoning?.activities?.some(v=>v.id===a.activityId));if(node){document.querySelector('#chat').dispatchEvent(new WheelEvent('wheel'));node.scrollIntoView({block:'center'});}else error(new Error('原始消息不在当前视图'));}),body);const diffState={...a,changes:[a],diffExpanded:preferences.diffExpanded||{},diffMode:preferences.diffMode};renderFileDiffs(entry,diffState);entry.addEventListener('reasoning-toggle',()=>{preferences.diffExpanded=diffState.diffExpanded;preferences.diffMode=diffState.diffMode;save();});artifacts.append(entry);if(activeArtifact===a.id&&entry.open)void preview(a,body);}
 }
 async function refresh(force=false){const next=key();if(next!==current){if(current){setFullView(null);onScopeChange?.();}current=next;version++;activeArtifact=null;data=null;try{preferences=JSON.parse(localStorage.getItem('chat-insights:'+current)||'{}');}catch{preferences={};}preferences.openTabs=['changes'];preferences.view='changes';dock.style.setProperty('--insights-width',preferences.width||'380px');setOpen(preferences.open);render();}else if(!force)return;
  if(!scope().chatId)return;const requestVersion=++version,requestKey=current;try{const result=await api.chatInsights(scope());if(requestVersion===version&&current===requestKey&&key()===requestKey){if(JSON.stringify(data)!==JSON.stringify(result)){data=result;render();}}}catch(e){if(current===requestKey){error(e);usage.replaceChildren(text('h2','用量与上下文'),text('p','读取失败：'+e.message));}}}
 let start;divider.addEventListener('pointerdown',e=>{start={x:e.clientX,width:aside.getBoundingClientRect().width};divider.setPointerCapture(e.pointerId);dock.classList.add('resizing');});divider.addEventListener('pointermove',e=>{if(!start)return;const width=Math.max(300,Math.min(document.body.clientWidth-600,start.width+start.x-e.clientX));dock.style.setProperty('--insights-width',width+'px');});const end=()=>{start=null;dock.classList.remove('resizing');preferences.width=dock.style.getPropertyValue('--insights-width');save();};divider.addEventListener('pointerup',end);divider.addEventListener('pointercancel',end);divider.addEventListener('dblclick',()=>{dock.style.setProperty('--insights-width','380px');end();});divider.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();dock.style.setProperty('--insights-width',Math.max(300,Math.min(document.body.clientWidth-600,aside.clientWidth+(e.key==='ArrowLeft'?20:-20)))+'px');end();});
 setOpen(false);return {refresh,setFullView,scopeKey:key,clearTurn:()=>{version++;if(data)data={...data,turnChanges:null};render();},maintaining:()=>false};
}
