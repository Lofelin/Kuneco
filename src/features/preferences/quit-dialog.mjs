export function mountQuitDialog({document,api}){
 const dialog=document.createElement('app-dialog');dialog.id='quitConfirmationDialog';dialog.label='退出 Kuneco？';
 const description=document.createElement('p');description.className='settings-section-description';description.textContent='以下任务仍在运行，退出将中断任务。取消后继续运行。';
 const list=document.createElement('ul'),status=document.createElement('p'),footer=document.createElement('div');status.setAttribute('role','status');status.className='muted';footer.slot='footer';dialog.append(description,list,status,footer);document.body.append(dialog);
 let requestId=null,pending=false;
 const button=(label,icon,primary)=>{const button=document.createElement('app-button');button.className='content-action'+(primary?' primary':'');if(primary)button.variant='brand';const image=document.createElement('wa-icon');image.slot='start';image.src='assets/icons/'+icon+'.svg';button.append(image,label);footer.append(button);return button;};
 const cancel=button('取消','x'),confirm=button('确认退出','check',true);
 async function answer(allow){if(!requestId||pending)return;pending=true;cancel.disabled=confirm.disabled=true;status.textContent='';try{await api.quitConfirmation({requestId,allow});requestId=null;dialog.open=false;}catch(error){status.textContent=error.message;}finally{pending=false;cancel.disabled=confirm.disabled=false;}}
 cancel.onclick=()=>void answer(false);confirm.onclick=()=>void answer(true);
 dialog.addEventListener('wa-hide',event=>{if(requestId){event.preventDefault();if(!pending)void answer(false);}});
 api.onEvent(async({type,data})=>{if(type!=='quitConfirmation')return;
  const existing=[...document.querySelectorAll('app-dialog[open]')].find(other=>other!==dialog);
  if(existing){await api.quitConfirmation({requestId:data.requestId,allow:false});existing.focus();document.dispatchEvent(new CustomEvent('quit-blocked'));return;}
  requestId=data.requestId;list.replaceChildren(...data.tasks.map(text=>{const item=document.createElement('li');item.textContent=text;return item;}));status.textContent='';dialog.open=true;
 });
 return dialog;
}
