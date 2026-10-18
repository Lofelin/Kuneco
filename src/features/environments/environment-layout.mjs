// Preserve the environment's existing content and controls while organizing detail panels.
const activePanels=new Map();
export function mountEnvironmentLayout({header,details,metadata,local,scope}){
 const doc=details.ownerDocument;
 const el=(tag,text,className)=>{const node=doc.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;};
 const facts=details.querySelector('.environment-inline-facts'),network=details.querySelector('.environment-network'),reliability=details.querySelector('.environment-reliability:not(.environment-network)'),runtimes=details.querySelector('.environment-inline-runtimes');
 const overview=el('div',null,'environment-overview-grid'),main=el('section',null,'environment-overview-main'),aside=el('aside',null,'environment-overview-aside');
 main.append(el('h3',local?'本机环境':'镜像与容器','preference-heading'));
 if(metadata.children.length)main.append(metadata);else main.append(el('p','使用本机运行时与工作文件。','settings-section-description muted'));
 aside.append(el('h3','环境信息','preference-heading'),facts);overview.append(main,aside);
 if(!local){const subtitle=el('p','Docker 容器环境','environment-container-name');header.querySelector('.environment-identity').append(subtitle);}
 const tabs=el('wa-tab-group',null,'app-section-tabs environment-detail-tabs');tabs.setAttribute('aria-label','环境详情');tabs.activation='auto';
 const panels=[['overview','概览',overview],...network?[['network','网络与防火墙',network]]:[],...reliability?[['status','容器状态',reliability]]:[],['runtimes','运行时',runtimes]];
 const selected=activePanels.get(scope);tabs.active=panels.some(([name])=>name===selected)?selected:'overview';
 for(const [name,label,content] of panels){const tab=el('wa-tab',label),panel=el('wa-tab-panel');tab.panel=name;tab.slot='nav';panel.name=name;tab.active=panel.active=name===tabs.active;panel.append(content);tabs.append(tab,panel);}
 tabs.addEventListener('wa-tab-show',event=>{activePanels.set(scope,event.detail.name);});
 details.classList.add('environment-tabbed-details');details.replaceChildren(tabs);
 return tabs;
}
