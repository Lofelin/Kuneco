import {formatDisplayDate} from '../../shared/date-format.mjs';
// Preserve the environment's existing content and controls while organizing detail panels.
const activePanels=new Map();
export function mountEnvironmentLayout({header,details,metadata,local,scope,detail={}}){
 const doc=details.ownerDocument;
 const el=(tag,text,className)=>{const node=doc.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;};
 const facts=details.querySelector('.environment-inline-facts'),network=details.querySelector('.environment-network'),reliability=details.querySelector('.environment-reliability:not(.environment-network)'),runtimes=details.querySelector('.environment-inline-runtimes');
 const main=el('section',null,'environment-information');
 main.setAttribute('aria-label','环境信息');
 metadata.classList.add('settings-facts');
 for(const pair of [...facts.children])metadata.append(...pair.childNodes);
 for(const value of metadata.querySelectorAll('dd'))value.title=value.textContent;
 facts.remove();main.append(metadata);
 const tabs=el('wa-tab-group',null,'app-section-tabs environment-detail-tabs');tabs.setAttribute('aria-label','环境详情');tabs.activation='auto';
 const panels=[...reliability?[['status','容器状态',reliability]]:[],...network?[['network','网络与防火墙',network]]:[],['runtimes','运行时',runtimes]];
 const selected=activePanels.get(scope);tabs.active=panels.some(([name])=>name===selected)?selected:panels[0][0];
 for(const [name,label,content] of panels){const tab=el('wa-tab',label),panel=el('wa-tab-panel');tab.panel=name;tab.slot='nav';panel.name=name;tab.active=panel.active=name===tabs.active;panel.append(content);tabs.append(tab,panel);}
 tabs.addEventListener('wa-tab-show',event=>{activePanels.set(scope,event.detail.name);});
 details.classList.add('environment-tabbed-details');details.replaceChildren(tabs);
 if(detail){
  const summary=el('div',null,'environment-header-summary');
  const icon=name=>{const node=el('wa-icon');node.setAttribute('src',`assets/icons/${name}.svg`);node.setAttribute('aria-hidden','true');return node;};
  const add=(name,text)=>{const item=el('span',null,'environment-header-fact');item.append(icon(name),el('span',text));summary.append(item);return item;};
  const system=String(detail.baseSystem?.os || '').replace('GNU/Linux ','').replace(/\s*\([^)]*\)/g,'').trim();
  const systemText=[system,detail.baseSystem?.node?`Node.js ${detail.baseSystem.node}`:''].filter(Boolean).join(' · ') || (local?'本机系统':'系统版本未知');
  const information=el('wa-dropdown',null,'environment-information-menu');information.setAttribute('placement','bottom-start');
  const trigger=el('app-button',systemText,'environment-summary-runtime environment-summary-system');trigger.slot='trigger';trigger.setAttribute('appearance','plain');trigger.setAttribute('size','s');trigger.setAttribute('aria-label',`${systemText}，查看环境信息`);
  const systemIcon=icon('monitor');systemIcon.slot='start';trigger.prepend(systemIcon);information.append(trigger,main);summary.append(information);
  const runtime=el('app-button',`${detail.runtimes?.length || 0} 个运行时`,'environment-summary-runtime');runtime.setAttribute('appearance','plain');runtime.setAttribute('size','s');
  const runtimeIcon=icon('server');runtimeIcon.slot='start';runtime.prepend(runtimeIcon);runtime.addEventListener('click',()=>{tabs.active='runtimes';[...tabs.querySelectorAll('wa-tab')].find(tab=>tab.panel==='runtimes').focus();});summary.append(runtime);
  const checked=add('clock',detail.checkedAt?`${formatDisplayDate(detail.checkedAt,'zh-CN','datetime',{timeDisplay:'relative'})}检测`:'尚未检测');
  if(detail.checkedAt)checked.title=formatDisplayDate(detail.checkedAt,'zh-CN','datetime',{timeDisplay:'absolute'});
  header.querySelector('.environment-identity').append(summary);
 }
 return tabs;
}
