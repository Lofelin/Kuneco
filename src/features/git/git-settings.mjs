export function mountGitSettings({host,api,getScope=()=>null}){
 let loadedScope;
 const get=id=>host.querySelector('#'+id);let generation=0,current=null,busy=false,identityTimer,credentialTimer,testTimer,testRevision=0;const identityQueue=new Map();
 let removeTimer,generateTimer,copyTimer,copying=false,copyRevision=0;
 const copyFeedback=(state='')=>{const button=get('gitCopy'),label=state==='success'?'已复制':state==='error'?'复制失败，点击重试':state==='loading'?'正在复制…':'复制公钥';button.dataset.state=state;button.title=label;button.setAttribute('aria-label',label);get('gitCopyIcon').setAttribute('src','assets/icons/'+(state==='success'?'check':state==='error'?'x':'copy')+'.svg');};
 const resetCopy=()=>{clearTimeout(copyTimer);copyFeedback();};
 const hintTimers=new Map();
 function inlineStatus(el,state='',text=''){
  clearTimeout(hintTimers.get(el));hintTimers.delete(el);
 el.dataset.state=state;el.replaceChildren();el.setAttribute('aria-busy',String(state==='loading'));
  if(state==='loading'){const spinner=document.createElement('wa-spinner');spinner.setAttribute('aria-hidden','true');el.append(spinner);}
  if(text){const copy=document.createElement('span');copy.textContent=text;el.append(copy);}
  if(state==='success'&&(el.dataset.description||el.id==='gitTestResult'))hintTimers.set(el,setTimeout(()=>inlineStatus(el,'',el.dataset.description||''),3000));
 }
 const testStatus=(state='',text='')=>inlineStatus(get('gitTestResult'),state,text);
 const identityFields=['gitUserName','gitUserEmail'],credentialFields=['gitCredentialHost','gitCredentialUser','gitCredentialToken'];
 let identityStatusField='gitUserEmail',credentialStatusField='gitCredentialToken';
 const resetHints=fields=>{for(const id of fields){const el=get(id+'Status');inlineStatus(el,'',el.dataset.description);}};
 const identityStatus=(text,state='')=>{if(!text)resetHints(identityFields);else inlineStatus(get(identityStatusField+'Status'),state,text);};
 const credentialStatus=(text,state='')=>{if(!text)resetHints(credentialFields);else inlineStatus(get(credentialStatusField+'Status'),state,text);};
 const identityDrafts=new Map();
 const controls=()=>host.querySelectorAll('app-button:not(#gitPublicKeyClose):not(#gitKeyDialogClose),wa-input,wa-select,wa-checkbox,wa-switch');
 const keySelectStatus=(text,state='')=>{get('gitKeySelect').setAttribute('aria-busy',String(state==='loading'));inlineStatus(get('gitKeySelectStatus'),state==='success'?'':state,state==='success'?'':text);};
 const keyStatus=(text,state='')=>{clearTimeout(generateTimer);get('gitKeyDialogStatus').textContent='';const button=get('gitGenerate');button.dataset.state=state;button.classList.toggle('primary',state!=='error');button.setAttribute('variant',state==='error'?'neutral':'brand');get('gitGenerateLabel').textContent=state==='success'?'已创建':state==='error'?'创建失败':'新建密钥';if(state==='success')generateTimer=setTimeout(()=>keyStatus(''),3000);};
 const syncRemove=()=>{get('gitCredentialRemove').hidden=!current?.credentials.some(c=>c.host===get('gitCredentialSelect').value)&&get('gitCredentialRemove').dataset.state!=='success';};
 const removeStatus=(text,state='')=>{clearTimeout(removeTimer);get('gitStatus').textContent='';get('gitCredentialRemove').dataset.state=state;get('gitCredentialRemoveLabel').textContent=state==='success'?'已移除':state==='error'?'移除失败':'移除凭据';syncRemove();if(state==='success')removeTimer=setTimeout(()=>removeStatus(''),3000);};
 const status=text=>{get('gitStatus').textContent=text;get('gitKeyDialogStatus').textContent=text;};
 const lock=value=>{busy=value;for(const el of controls())el.disabled=value;get('gitCopy').disabled=value||copying||!current?.publicKey;get('gitViewKey').disabled=value||!current?.publicKey;get('gitKeySelect').disabled=value||!current?.keys?.some(k=>k.hasPrivate);get('gitCredentialRemove').disabled=value||get('gitCredentialSelect').value==='new';syncRemove();};
 const clear=()=>{get('gitPublicKeyDialog').hide?.();keySelectStatus('');get('gitCredentialRemove').loading=false;removeStatus('');get('gitGenerate').loading=false;keyStatus('');copyRevision++;copying=false;get('gitCopy').loading=false;resetCopy();clearTimeout(testTimer);testRevision++;get('gitTestResult').removeAttribute('aria-busy');clearTimeout(credentialTimer);credentialTimer=undefined;clearTimeout(identityTimer);identityQueue.clear();identityDrafts.clear();identityStatus('');credentialStatus('');current=null;get('gitPublicKey').textContent='尚无公钥';get('gitFingerprint').textContent='尚无指纹';get('gitUserName').value='';get('gitUserEmail').value='';get('gitCredentialToken').value='';get('gitCredentialHost').value='';get('gitCredentialUser').value='';get('gitKeySelect').replaceChildren();get('gitCredentialSelect').replaceChildren();syncRemove();testStatus();get('gitNetworkRoute').textContent='';};
 function option(value,label,disabled=false){const item=document.createElement('wa-option');item.value=value;item.textContent=label;item.disabled=disabled;return item;}
 function render(result){
  current=result;inlineStatus(get('gitKeyDescription'),'',get('gitKeyDescription').dataset.description);get('gitRepositoryScope').disabled=!result.repositoryAvailable;get('gitRepositoryScope').textContent=result.repositoryAvailable?'当前项目':'当前项目（未选择 Git 仓库）';if(!result.repositoryAvailable)get('gitIdentityScope').value='environment';get('gitPublicKey').textContent=result.publicKey||'尚无公钥';get('gitFingerprint').textContent=result.fingerprint||'尚无指纹';get('gitUserName').value=get('gitIdentityScope').value==='repository'?result.repositoryName:result.name;get('gitUserEmail').value=get('gitIdentityScope').value==='repository'?result.repositoryEmail:result.email;
  get('gitKeySelect').replaceChildren(...result.keys.map(k=>option(k.id,k.id+(k.hasPrivate?'':'（缺少私钥）'),!k.hasPrivate)));get('gitKeySelect').value=result.activeKey;
  const selectedHost=get('gitCredentialSelect').value;
  get('gitCredentialSelect').replaceChildren(option('new','添加平台'),...result.credentials.map(c=>option(c.host,c.host+' · '+c.username)));
  get('gitCredentialSelect').value=result.credentials.some(c=>c.host===selectedHost)?selectedHost:'new';
  get('gitCredentialToken').value='';get('gitNetworkRoute').textContent=({managed:'使用当前容器代理网络',local:'使用本机环境当前代理网络',external:'使用已有容器的原网络及其代理配置'})[result.route];
  if(result.test)testStatus(result.test.ok?'success':'error',(result.test.ok?'检测成功：':'检测失败：')+result.test.reason);
 }
 async function run(action='read',data={}){
  if(busy)return;
  if(credentialTimer && !['read','credentialSave','credentialRemove'].includes(action)){await saveCredentials();if(busy)return;}
  if(identityQueue.size){await saveIdentity();if(busy)return;}
  const request=++generation,scope=current;const notify=action==='credentialSave'?credentialStatus:action==='keyCreate'?keyStatus:action==='keySelect'?keySelectStatus:action==='credentialRemove'?removeStatus:status;lock(true);notify(action==='keySelect'?'正在切换密钥…':action==='keyCreate'?'正在创建密钥…':action==='test'?'正在通过当前环境检测连接…':action==='read'?'':'正在保存…','loading');get('gitGenerate').loading=action==='keyCreate';get('gitCredentialRemove').loading=action==='credentialRemove';
  if(action==='read'){if(!current)clear();inlineStatus(get('gitKeyDescription'),'loading','正在读取公钥…');}
  try{
   const result=await api.dockerEnvironments('gitManage',{action,data,owner:scope?.owner,environmentId:scope?.environmentId});if(request!==generation)return;if(action==='credentialSave')get('gitCredentialSelect').value=data.host.trim().toLowerCase();render(result);notify(action==='keyCreate'?'已创建并切换使用新密钥':action==='read'?'':action==='test'?result.test.reason:action==='credentialSave'?'已自动保存':'已保存到当前环境','success');
  }catch(error){if(request===generation){if(action==='keySelect'){get('gitKeySelect').value=scope.activeKey;keySelectStatus('切换失败，请重试：'+error.message.replace(/^Error invoking remote method '[^']+': Error: /,''),'error');}else if(action==='read'){inlineStatus(get('gitKeyDescription'),'error','读取失败，请重新打开 Git 管理重试');}else notify((action==='keyCreate'?'创建失败，请重试：':'保存失败：')+error.message.replace(/^Error invoking remote method '[^']+': Error: /,''),'error');}}
  finally{if(request===generation){get('gitGenerate').loading=false;get('gitCredentialRemove').loading=false;if(action==='credentialSave')get('gitCredentialToken').value='';lock(false);if(!current){for(const el of controls())el.disabled=true;}}}
 }
 async function saveIdentity(){
  clearTimeout(identityTimer);if(!identityQueue.size||!current)return;
  if(busy){identityTimer=setTimeout(saveIdentity,100);return;}
  const [scope,data]=identityQueue.entries().next().value;identityQueue.delete(scope);
  const request=generation,owner=current.owner,environmentId=current.environmentId;
  busy=true;identityStatus('正在自动保存…','loading');
  try{const result=await api.dockerEnvironments('gitManage',{action:'identity',data,owner,environmentId});
   if(request!==generation)return;
   current={...current,name:result.name,email:result.email,repositoryName:result.repositoryName,repositoryEmail:result.repositoryEmail};
   if(scope===get('gitIdentityScope').value)identityStatus(identityQueue.size?'等待自动保存…':'已自动保存',identityQueue.size?'pending':'success');
  }catch(error){if(request===generation)if(scope===get('gitIdentityScope').value)identityStatus('自动保存失败：'+error.message.replace(/^Error invoking remote method '[^']+': Error: /,''),'error');}
  finally{if(request===generation){busy=false;if(identityQueue.size)identityTimer=setTimeout(saveIdentity,0);}}
 }
 function queueIdentity(delay=500,field=identityStatusField){
  resetHints(identityFields);identityStatusField=field;
  if(!current)return;const scope=get('gitIdentityScope').value,data={name:get('gitUserName').value,email:get('gitUserEmail').value,scope};
  identityDrafts.set(scope,data);clearTimeout(identityTimer);
  if(!data.name.trim()||!data.email.trim()||!get('gitUserName').checkValidity()||!get('gitUserEmail').checkValidity()){
   identityQueue.delete(scope);identityStatus('填写完整有效的姓名和邮箱后自动保存');if(identityQueue.size)identityTimer=setTimeout(saveIdentity,delay);return;
  }
  identityQueue.set(scope,data);identityStatus('等待自动保存…');identityTimer=setTimeout(saveIdentity,delay);
 }
 get('gitIdentityScope').addEventListener('change',()=>{if(!current)return;const scope=get('gitIdentityScope').value,draft=identityDrafts.get(scope);get('gitUserName').value=draft?.name??(scope==='repository'?current.repositoryName:current.name);get('gitUserEmail').value=draft?.email??(scope==='repository'?current.repositoryEmail:current.email);identityStatus('');});
 for(const id of ['gitUserName','gitUserEmail']){get(id).addEventListener('input',event=>{if(!event.isComposing)queueIdentity(500,id);});get(id).addEventListener('compositionend',()=>queueIdentity(500,id));get(id).addEventListener('change',()=>queueIdentity(0,id));}
 get('gitViewKey').onclick=()=>{if(current?.publicKey)get('gitPublicKeyDialog').show();};
 get('gitPublicKeyClose').onclick=()=>get('gitPublicKeyDialog').hide();
 get('gitConfigure').onclick=()=>{keyStatus('');get('gitKeyDialog').show();};
 get('gitKeyDialogClose').onclick=()=>get('gitKeyDialog').hide();
 get('gitGenerate').onclick=()=>void run('keyCreate');
 get('gitKeySelect').addEventListener('change',()=>{if(!busy&&current&&get('gitKeySelect').value!==current.activeKey)void run('keySelect',{key:get('gitKeySelect').value});});
 get('gitCopy').onclick=async()=>{if(busy||copying||!current?.publicKey)return;const key=current.publicKey,request=generation,revision=++copyRevision;const button=get('gitCopy');resetCopy();copying=true;copyFeedback('loading');button.loading=true;button.disabled=true;try{await navigator.clipboard.writeText(key);if(request===generation){resetCopy();copyFeedback('success');status('');copyTimer=setTimeout(resetCopy,3000);}}catch{if(request===generation){resetCopy();copyFeedback('error');status('');}}finally{if(revision===copyRevision){copying=false;button.loading=false;button.disabled=busy||!current?.publicKey;}}};
 function queueTest(delay=700){
  clearTimeout(testTimer);const revision=++testRevision;testStatus();
  if(!current)return;const target=(get('gitTestTarget').value||'').trim();if(!target)return;
  let url;try{url=new URL(target);}catch{testStatus('error','请输入完整的 SSH 或 HTTPS 地址');return;}
  if(!['ssh:','https:'].includes(url.protocol)||!url.hostname||url.password||url.search||url.hash||(url.protocol==='https:'&&url.username)){testStatus('error','请输入不含凭据的 SSH 或 HTTPS 地址');return;}
  const request=generation,owner=current.owner,environmentId=current.environmentId,trustFirstUse=get('gitTrustHost').checked;
  const detect=async()=>{
   if(request!==generation||revision!==testRevision||!current)return;
   if(busy){testTimer=setTimeout(detect,100);return;}
   busy=true;testStatus('loading','检测中：正在通过当前环境连接…');
   try{const result=await api.dockerEnvironments('gitManage',{action:'test',data:{target,trustFirstUse},owner,environmentId});
    if(request===generation&&revision===testRevision)testStatus(result.test.ok?'success':'error',(result.test.ok?'检测成功：':'检测失败：')+result.test.reason);
   }catch(error){if(request===generation&&revision===testRevision)testStatus('error','检测失败：'+error.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}
   finally{if(request===generation){busy=false;get('gitTestResult').removeAttribute('aria-busy');}}
  };
  testStatus('pending','等待自动检测…');testTimer=setTimeout(detect,delay);
 }
 get('gitTestTarget').addEventListener('input',event=>{if(event.isComposing){clearTimeout(testTimer);testRevision++;testStatus();}else queueTest();});
 get('gitTestTarget').addEventListener('compositionend',()=>queueTest());
 get('gitTestTarget').addEventListener('change',()=>queueTest(0));
 get('gitTrustHost').addEventListener('change',()=>queueTest(0));
 get('gitCredentialSelect').addEventListener('change',()=>{removeStatus('');clearTimeout(credentialTimer);credentialTimer=undefined;credentialStatus('');const entry=current?.credentials.find(c=>c.host===get('gitCredentialSelect').value);get('gitCredentialHost').value=entry?.host||'';get('gitCredentialUser').value=entry?.username||'';get('gitCredentialToken').value='';lock(busy);});
 async function saveCredentials(){
  clearTimeout(credentialTimer);credentialTimer=undefined;if(!current)return;
  if(busy){credentialTimer=setTimeout(saveCredentials,100);return;}
  const ids=['gitCredentialHost','gitCredentialUser','gitCredentialToken'];
  if(!ids.every(id=>get(id).value?.trim()&&get(id).checkValidity()))return;
  await run('credentialSave',{host:get('gitCredentialHost').value,username:get('gitCredentialUser').value,token:get('gitCredentialToken').value});
 }
 function queueCredentials(delay=500,field=credentialStatusField){
  resetHints(credentialFields);credentialStatusField=field;
  clearTimeout(credentialTimer);credentialTimer=undefined;if(!current)return;
  if(!['gitCredentialHost','gitCredentialUser','gitCredentialToken'].every(id=>get(id).value?.trim()&&get(id).checkValidity()))return;
  credentialStatus('等待自动保存…','pending');credentialTimer=setTimeout(saveCredentials,delay);
 }
 for(const id of ['gitCredentialHost','gitCredentialUser','gitCredentialToken']){get(id).addEventListener('input',event=>{if(!event.isComposing)queueCredentials(500,id);});get(id).addEventListener('compositionend',()=>queueCredentials(500,id));get(id).addEventListener('change',()=>queueCredentials(0,id));}
 get('gitCredentialRemove').onclick=()=>{clearTimeout(credentialTimer);credentialTimer=undefined;if(get('gitCredentialSelect').value!=='new')void run('credentialRemove',{host:get('gitCredentialSelect').value});};
 return {refresh:()=>run(),ensureLoaded(){const scope=JSON.stringify(getScope());if(loadedScope!==scope){this.invalidate(false);loadedScope=scope;}return current?Promise.resolve():run();},invalidate(refreshVisible=true){get('gitKeyDialog').hide?.();generation++;clear();lock(true);get('gitIdentityScope').value='environment';get('gitTestTarget').value='';get('gitTrustHost').checked=false;status('');busy=false;if(refreshVisible&&!host.classList.contains('hidden'))void run();}};
}
