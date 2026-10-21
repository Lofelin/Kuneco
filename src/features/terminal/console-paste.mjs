export function mountConsolePaste({host,getPreferences,getSession,onPaste}){
 const doc=host.ownerDocument,dialog=doc.createElement('app-dialog');dialog.id='consolePasteDialog';dialog.label='粘贴多行内容？';
 const description=doc.createElement('p');description.className='settings-section-description';description.textContent='这些内容包含换行，可能立即执行命令。确认后粘贴到当前终端。';description.id='consolePasteDescription';
 const preview=doc.createElement('wa-textarea');preview.label='粘贴内容';preview.readOnly=true;preview.rows=6;preview.resize='auto';preview.setAttribute('aria-describedby',description.id);
 const footer=doc.createElement('div');footer.slot='footer';
 function button(label,icon,primary){const button=doc.createElement('app-button');button.className='content-action'+(primary?' primary':'');const image=doc.createElement('wa-icon');image.slot='start';image.src='assets/icons/'+icon+'.svg';button.append(image,label);footer.append(button);return button;}
 const cancelButton=button('取消','x'),confirm=button('确认粘贴','check',true);dialog.append(description,preview,footer);doc.body.append(dialog);
 let pending=null;
 function cancel(){pending=null;preview.value='';dialog.open=false;}
 cancelButton.onclick=cancel;dialog.addEventListener('wa-hide',()=>{pending=null;preview.value='';});
 confirm.onclick=()=>{const request=pending;cancel();if(request&&request.session===getSession())onPaste(request.text);};
 function request(text){
  const session=getSession();if(!session||pending)return;
  if(!getPreferences().consoleConfirmPaste||!/[\r\n]/.test(text)){onPaste(text);return;}
  if(doc.querySelector('app-dialog[open]'))return;
  pending={session,text};preview.value=text;dialog.open=true;
 }
 host.addEventListener('paste',event=>{const text=event.clipboardData?.getData('text/plain');if(text===undefined)return;event.preventDefault();event.stopImmediatePropagation();request(text);},true);
 return {cancel,request};
}
