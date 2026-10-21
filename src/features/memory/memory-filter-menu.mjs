import {preferLeftSubmenus} from '../../shared/ui/dropdown-submenu-placement.mjs';
const groups=[
 {key:'type',label:'类型',options:[['all','全部类型'],['preference','偏好'],['decision','决策'],['fact','事实'],['procedure','经验'],['note','笔记']]},
 {key:'enabled',label:'状态',options:[['all','全部状态'],['enabled','已启用'],['disabled','已停用']]},
 {key:'source',label:'来源',options:[['all','全部来源'],['automatic','自动提取'],['manual','手动维护']]}
];
const match=(item,key,value)=>value==='all'||(key==='type'?item.type===value:key==='enabled'?item.enabled===(value==='enabled'):value==='manual'?item.manualProtected||item.origin==='manual':item.origin==='automatic'&&!item.manualProtected);
export function mountMemoryFilterMenu(menu,{onChange=()=>{},summary=null}={}){
 preferLeftSubmenus(menu);
 const parents=new Map();
 const values={type:'all',enabled:'all',source:'all'},entries=[];let candidates=[];const doc=menu.ownerDocument,trigger=menu.querySelector('app-button'),label=trigger.querySelector('span');
 for(const group of groups){const parent=doc.createElement('wa-dropdown-item');parent.textContent=group.label;parent.dataset.filterGroup=group.key;const selected=doc.createElement('span');selected.slot='details';selected.dataset.filterSelected=group.key;parent.append(selected);parents.set(group.key,{parent,selected});
  for(const [value,text] of group.options){const item=doc.createElement('wa-dropdown-item'),count=doc.createElement('span');item.slot='submenu';item.type='checkbox';item.value=group.key+':'+value;item.dataset.memoryFilter=item.value;item.textContent=text;count.slot='details';item.append(count);parent.append(item);entries.push({item,count,key:group.key,value});}menu.append(parent);
 }
 const reset=doc.createElement('wa-dropdown-item');reset.value='reset';reset.dataset.memoryFilterReset='';reset.textContent='清除筛选';const icon=doc.createElement('wa-icon');icon.slot='icon';icon.src='assets/icons/rotate-cw.svg';reset.prepend(icon);menu.append(reset);
 function matches(item,omit){return groups.every(g=>g.key===omit||match(item,g.key,values[g.key]));}
 function update(items=candidates,{disabled=false}={}){candidates=items;trigger.disabled=disabled;const active=Object.values(values).filter(v=>v!=='all').length;label.textContent=active?'筛选 · '+active:'筛选';trigger.setAttribute('aria-label',active?'筛选记忆：已应用 '+active+' 项':'筛选记忆');for(const entry of entries){entry.item.checked=values[entry.key]===entry.value;entry.count.textContent=candidates.filter(i=>matches(i,entry.key)&&match(i,entry.key,entry.value)).length;}reset.disabled=!active;
  for(const group of groups){const {parent,selected}=parents.get(group.key),value=values[group.key];selected.textContent=value==='all'?'未筛选':group.options.find(o=>o[0]===value)[1];parent.toggleAttribute('data-filter-active',value!=='all');parent.setAttribute('aria-label',group.label+'：'+selected.textContent);}
  if(summary){summary.hidden=!active;summary.replaceChildren();for(const group of groups){if(values[group.key]==='all')continue;const button=doc.createElement('app-button'),icon=doc.createElement('wa-icon');button.size='s';button.className='content-action';button.dataset.clearMemoryFilter=group.key;const text=group.label+'：'+group.options.find(o=>o[0]===values[group.key])[1];button.textContent=text;button.setAttribute('aria-label','清除筛选：'+text);icon.slot='end';icon.src='assets/icons/x.svg';button.append(icon);button.onclick=()=>{values[group.key]='all';update();onChange();};summary.append(button);}}
 }
 function clear(){for(const key of Object.keys(values))values[key]='all';menu.open=false;update();}
 menu.addEventListener('wa-select',event=>{const item=event.detail?.item;if(!item)return;if(item.value==='reset'){event.preventDefault();clear();onChange();return;}const entry=entries.find(e=>e.item===item);if(!entry)return;event.preventDefault();values[entry.key]=entry.value==='all'||values[entry.key]===entry.value?'all':entry.value;update();onChange();});
 update();return {matches,update,reset:clear,get active(){return Object.values(values).some(v=>v!=='all');}};
}
