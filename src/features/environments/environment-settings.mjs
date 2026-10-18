export function mountEnvironmentSettings({host,getPreferences,save,api}){
 const doc=host.ownerDocument,controls=new Map();let ready=false;
 const el=(tag,text,cls)=>{const node=doc.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
 const status=el('p','','muted');status.setAttribute('role','status');
 function group(title,description){const section=el('section'),card=el('div','','preference-group');section.append(el('h2',title,'preference-heading'),el('p',description,'settings-section-description muted'),card);host.append(section);return card;}
 function row(card,key,title,description,options){
  const row=el('div','','notification-setting-row'),copy=el('div','','notification-setting-copy'),label=el('strong',title),hint=el('p',description),control=el(options?'wa-select':'wa-switch');
  label.id=key+'-label';hint.id=key+'-hint';copy.append(label,hint);control.id=key;control.size='s';control.setAttribute('aria-labelledby',label.id);control.setAttribute('aria-describedby',hint.id);
  for(const [value,text] of options||[]){const option=el('wa-option',text);option.value=String(value);control.append(option);}controls.set(key,control);row.append(copy,control);card.append(row);
  control.addEventListener('change',async()=>{if(!ready||control.disabled)return;const value=options?Number(control.value):control.checked;render(false);status.textContent='正在保存…';try{await save({[key]:value});status.textContent='';}catch(error){status.textContent='保存失败：'+error.message;}finally{render(true);}});
 }
 const retention=group('日志保留','管理本设备所有账号与环境的应用诊断日志；容器原始输出由容器引擎独立轮转。');
 row(retention,'environmentLogAutoClean','自动清理过期日志','启动时、修改保留规则后及每小时清理一次；关闭后不自动删除历史日志。');
 row(retention,'environmentLogRetentionDays','保留期限','超过期限的应用诊断日志将被自动清理；手动清理同样采用此期限。',[1,7,30,90].map(n=>[n,n+' 天']));
 const cleanupRow=el('div','','notification-setting-row'),copy=el('div','','notification-setting-copy');copy.append(el('strong','清理过期日志'),el('p','立即按保留期限清理应用诊断日志，不删除容器或工作文件。'));
 const clean=el('app-button','清理过期日志','content-action');clean.variant='danger';clean.size='s';const icon=el('wa-icon');icon.slot='start';icon.src='assets/icons/trash-2.svg';clean.prepend(icon);cleanupRow.append(copy,clean);retention.append(cleanupRow);
 clean.addEventListener('click',async()=>{clean.disabled=true;status.textContent='正在清理…';try{const result=await api.dockerEnvironments('logsCleanup');status.textContent='已清理 '+result.removed+' 条过期记录；重新打开日志弹窗可查看保留结果。';}catch(error){status.textContent='清理失败：'+error.message;}finally{clean.disabled=!ready;}});
 const health=group('健康检查','读取容器引擎实际执行的检查结果，状态异常仍会记录告警。');
 row(health,'environmentHealthDebug','记录健康检查 DEBUG 日志','关闭后不再保存每次检查结果，保留服务健康状态变化和异常日志。');
 row(health,'environmentHealthInterval','检查结果采集间隔','只影响读取已完成检查的频率，不改变容器自身健康检查周期；下个采集周期生效。',[3,10,30].map(n=>[n,n+' 秒']));
 host.append(status);
 function render(enabled=ready){ready=enabled;for(const [key,control] of controls){control.disabled=!ready;const value=getPreferences()[key];if(control.tagName==='WA-SWITCH')control.checked=value;else control.value=String(value);}clean.disabled=!ready;}
 render(false);return {render,error(message){status.textContent=message;render(false);}};
}
