import {formatDisplayDate} from '../../shared/date-format.mjs';
export function mountPreferenceSettings({host,getPreferences,save}){
 const doc=host.ownerDocument,controls=new Map();
 const element=(tag,text,cls)=>{const el=doc.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;};
 function section(title,description){const section=element('section'),heading=element('h2',title,'preference-heading'),badge=element('wa-badge','仅本设备','small-tag'),icon=element('wa-icon');icon.src='assets/icons/monitor.svg';icon.setAttribute('aria-hidden','true');badge.prepend(icon);heading.append(' ',badge);const group=element('div',null,'preference-group');section.append(heading,element('p',description,'settings-section-description muted'),group);host.append(section);return group;}
 function row(group,key,title,description,options){
  const row=element('div',null,'notification-setting-row'),copy=element('div',null,'notification-setting-copy'),label=element('strong',title),hint=element('p',description);
  label.id='preference-'+key+'-label';hint.id='preference-'+key+'-hint';copy.append(label,hint);
  const control=element(options?'wa-select':'wa-switch');control.id='preference-'+key;control.setAttribute('aria-labelledby',label.id);control.setAttribute('aria-describedby',hint.id);control.size='s';
  if(options)for(const [value,text] of options){const option=element('wa-option',text);option.value=String(value);control.append(option);}
  row.append(copy,control);group.append(row);controls.set(key,control);
  control.addEventListener('change',async()=>{if(control.disabled)return;const value=options?(key.endsWith('FontSize')?Number(control.value):control.value):control.checked;render(false);status.textContent='正在保存…';try{await save({[key]:value});status.textContent='已保存到本设备';}catch(error){status.textContent='保存失败：'+error.message;}finally{render();}});
 }
 const reading=section('阅读','调整聊天正文和代码字号，不影响侧栏、按钮与页面缩放。');
 row(reading,'chatFontSize','聊天字号','同时应用到主窗口与独立聊天窗口。',Array.from({length:9},(_,i)=>[i+12,(i+12)+' px']));
 row(reading,'codeFontSize','代码字号','独立调整行内代码与代码块。',Array.from({length:9},(_,i)=>[i+12,(i+12)+' px']));
 const preview=element('div',null,'preference-reading-preview');preview.setAttribute('aria-label','阅读预览');preview.append(element('p','这是一段聊天预览。调整字号后立即生效。'),element('code','const message = "Hello, Kuneco";'));reading.append(preview);
 const motion=section('动态效果','减少装饰动画与面板过渡，保留清晰的加载状态。');
 row(motion,'motion','减少动态效果','跟随操作系统设置，或始终减少动画。',[['system','跟随系统'],['reduce','始终减少']]);
 const time=section('时间显示','仅改变显示格式，不改变系统时区或自动化的执行时间。');
 row(time,'hourCycle','小时制','完整时间使用所选小时制。',[['system','跟随语言'],['12','12 小时'],['24','24 小时']]);
 row(time,'timeDisplay','时间格式','相对时间会自动更新；悬停时间可查看完整时间。',[['absolute','完整时间'],['relative','相对时间']]);
 const timePreview=element('div',null,'preference-time-preview');timePreview.setAttribute('aria-live','polite');time.append(timePreview);
 const lifecycle=section('退出应用','关闭主窗口或退出 Kuneco 时，保护正在执行的任务。');
 row(lifecycle,'confirmQuit','退出前提醒运行任务','有聊天或自动化正在运行时，列出任务并等待确认。');
 const status=element('p',null,'muted');status.setAttribute('role','status');host.append(status);
 function render(ready=true){const p=getPreferences();for(const [key,control] of controls){control.disabled=!ready;if(control.tagName==='WA-SWITCH')control.checked=p[key];else control.value=String(p[key]);}timePreview.textContent='预览：'+formatDisplayDate(Date.now()-300000,doc.documentElement.lang,'datetime',p);timePreview.title=formatDisplayDate(Date.now()-300000,doc.documentElement.lang,'datetime',{...p,timeDisplay:'absolute'});}
 render(false);return {render,error(message){status.textContent=message;render(false);}};
}
