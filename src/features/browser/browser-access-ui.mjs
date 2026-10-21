import {browserAccessMode} from './browser-agent.mjs';
const choices=[['ask','请求批准','浏览网页、下载和读取历史前询问。','hand'],['auto','帮我批准','自动允许浏览网页，下载和历史读取仍询问。','shield-check'],['full','完全访问','允许本对话浏览网页、下载和读取当前环境历史。','shield-alert']];
export function mountBrowserAccessControl({anchor,api,getSession,getScope,isBusy,onError}){
 const doc=anchor.ownerDocument,menu=doc.createElement('wa-dropdown');menu.id='browserAccessMenu';menu.placement='top-start';
 const trigger=doc.createElement('app-button');trigger.id='browserAccessTrigger';trigger.slot='trigger';trigger.className='content-action';trigger.setAttribute('appearance','plain');trigger.setAttribute('aria-label','浏览器访问权限');
 const icon=doc.createElement('wa-icon');icon.slot='start';const label=doc.createElement('span');trigger.append(icon,label);menu.append(trigger);
 for(const [value,title,description,image] of choices){const item=doc.createElement('wa-dropdown-item');item.value=value;item.setAttribute('value',value);item.type='checkbox';const symbol=doc.createElement('wa-icon');symbol.slot='icon';symbol.src='assets/icons/'+image+'.svg';const copy=doc.createElement('span');copy.className='browser-access-choice';const heading=doc.createElement('span'),hint=doc.createElement('span');heading.textContent=title;hint.textContent=description;hint.className='browser-access-hint';copy.append(heading,hint);item.append(symbol,copy);item.addEventListener('click',()=>{void select(value);});menu.append(item);}
 anchor.after(menu);let saving=false;
 async function select(mode){const session=getSession();if(!session||saving||isBusy())return;const scope={...getScope(),chatId:session.id};saving=true;menu.open=false;render();try{const result=await api.sessionBrowserAccess({...scope,mode});if(getSession()?.id===scope.chatId&&getScope().owner===scope.owner&&getScope().environmentId===scope.environmentId)session.browserAccessMode=result.mode;}catch(error){onError(error);}finally{saving=false;render();}}
 function render(){const session=getSession(),mode=browserAccessMode(session?.browserAccessMode),choice=choices.find(row=>row[0]===mode);label.textContent=choice[1];icon.src='assets/icons/'+choice[3]+'.svg';trigger.dataset.access=mode;trigger.disabled=!session||saving||isBusy();for(const item of menu.querySelectorAll('wa-dropdown-item')){item.checked=item.value===mode;item.disabled=trigger.disabled;}}
 render();return {render};
}
