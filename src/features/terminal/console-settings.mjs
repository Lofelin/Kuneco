import {consoleFonts} from '../../shared/console-preferences.mjs';
export function mountConsoleSettings({host,getPreferences,save,api}){
 const doc=host.ownerDocument,controls=new Map();let ready=false,scope=null,version=0;
 const el=(tag,text,cls)=>{const e=doc.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 const status=el('p',null,'muted');status.setAttribute('role','status');
 function group(title,description){const section=el('section'),card=el('div',null,'preference-group');section.append(el('h2',title,'preference-heading'),el('p',description,'settings-section-description muted'),card);host.append(section);return card;}
 function row(card,key,title,description,options,{segmented=false,number=false}={}){
  const row=el('div',null,'notification-setting-row'),copy=el('div',null,'notification-setting-copy'),label=el('strong',title),hint=el('p',description);
  label.id=key+'-label';hint.id=key+'-hint';copy.append(label,hint);
  const control=el(options?(segmented?'wa-radio-group':'wa-select'):'wa-switch');control.id=key;control.size='s';control.setAttribute('aria-labelledby',label.id);control.setAttribute('aria-describedby',hint.id);
  if(segmented){control.className='app-segmented';control.orientation='horizontal';}
  for(const [value,text] of options||[]){const option=el(segmented?'wa-radio':'wa-option',text);option.value=String(value);if(segmented)option.appearance='button';if(key==='consoleFont'){option.className='font-preview-option';option.style.setProperty('--option-font-family',consoleFonts[value]);}control.append(option);}
  controls.set(key,control);row.append(copy,control);card.append(row);
  control.addEventListener('change',async()=>{if(!ready||control.disabled)return;const value=options?(number?Number(control.value):control.value):control.checked;render(false);status.textContent='正在保存…';try{await save({[key]:value});status.textContent='已保存到本设备';}catch(error){status.textContent='保存失败：'+error.message;}finally{render(true);}});
 }
 const display=group('显示','调整终端显示，立即应用到当前终端。');
 row(display,'consoleTheme','配色','选择终端配色，或跟随应用主题。',[['system','跟随应用'],['light','浅色'],['dark','深色']],{segmented:true});
 row(display,'consoleFont','终端字体','使用等宽字体；未安装的字体由系统等宽字体替代。',[['default','默认等宽'],['menlo','Menlo'],['monaco','Monaco'],['consolas','Consolas'],['system','系统等宽']]);
 row(display,'consoleFontSize','字号','调整终端文字大小。',Array.from({length:15},(_,i)=>[i+10,(i+10)+' px']),{number:true});
 row(display,'consoleLineHeight','行高','调整终端行间距离。',[[1,'紧凑'],[1.2,'标准'],[1.4,'宽松']],{segmented:true,number:true});
 const cursor=group('光标','调整终端输入光标。');
 row(cursor,'consoleCursor','光标形状','选择聚焦终端时的光标样式。',[['block','方块'],['bar','竖线'],['underline','下划线']],{segmented:true});
 row(cursor,'consoleCursorBlink','光标闪烁','输入光标周期闪烁。');
 const scroll=group('滚动与粘贴','控制输出保留和输入行为。');
 row(scroll,'consoleScrollback','回滚缓冲行数','减少行数会丢弃超出范围的历史输出，不影响正在执行的命令。',[1000,5000,10000,20000].map(n=>[n,n.toLocaleString()+' 行']),{number:true});
 row(scroll,'consoleScrollOnInput','输入时回到底部','输入文字时自动显示最新输出。');
 row(scroll,'consoleConfirmPaste','多行粘贴前确认','粘贴包含换行的内容前显示预览，确认后才发送到终端。');
 const connection=group('连接','连接行为与当前环境的启动目录。');
 row(connection,'consoleAutoConnect','进入控制台时自动连接','关闭后需点击“连接终端”；不会断开已有会话。');
 const directoryRow=el('div',null,'notification-setting-row'),directoryCopy=el('div',null,'notification-setting-copy'),directoryLabel=el('strong','默认工作目录'),directoryHint=el('p','正在读取当前环境…');directoryLabel.id='consoleDirectory-label';directoryHint.id='consoleDirectory-hint';directoryCopy.append(directoryLabel,directoryHint);
 const directory=el('wa-input');directory.id='consoleDirectory';directory.size='s';directory.placeholder='使用环境默认目录';directory.setAttribute('aria-labelledby',directoryLabel.id);directory.setAttribute('aria-describedby',directoryHint.id);directory.disabled=true;directoryRow.append(directoryCopy,directory);connection.append(directoryRow);host.append(status);
 directory.addEventListener('change',async()=>{if(!scope||directory.disabled)return;const current=scope,revision=version;directory.disabled=true;status.textContent='正在保存目录…';try{const result=await api.console('directory-save',{scope:current.scope,path:directory.value});if(revision===version){scope=result;directory.value=result.path;status.textContent='已保存，下次连接生效';}}catch(error){if(revision===version){directory.value=current.path;status.textContent='保存失败：'+error.message;}}finally{if(revision===version)directory.disabled=!scope;}});
 function render(enabled=ready){ready=enabled;for(const [key,control] of controls){control.disabled=!ready;const value=getPreferences()[key];if(control.tagName==='WA-SWITCH')control.checked=value;else control.value=String(value);}}
 async function refresh(){const revision=++version;scope=null;directory.disabled=true;directory.value='';directoryHint.textContent='正在读取当前环境…';try{const value=await api.console('directory');if(revision!==version)return;scope=value.available?value:null;directory.disabled=!scope;directory.value=value.path||'';directory.placeholder=value.defaultPath||'使用环境默认目录';directoryHint.textContent=scope?'当前环境：'+value.name+'。填写容器内绝对路径，留空使用 '+value.defaultPath+'；下次连接生效。':value.message;}catch(error){if(revision===version)directoryHint.textContent=error.message;}}
 api.onEvent(({type})=>{if(['chatAccountChanged','account'].includes(type))void refresh();});
 render(false);return {render,refresh,error(message){status.textContent=message;render(false);}};
}
