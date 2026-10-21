import {consoleShortcutAction} from '../../shared/console-shortcuts.mjs';
import {consoleOptions,consoleDefaults} from '../../shared/console-preferences.mjs';
import {mountConsolePaste} from './console-paste.mjs';
import {Terminal} from '@xterm/xterm';
import {WebLinksAddon} from '@xterm/addon-web-links';
import {FitAddon} from '@xterm/addon-fit';

export function mountConsole(api,{openBrowser,getPreferences=()=>consoleDefaults}={}){
 const host=document.getElementById('containerTerminal'),status=document.getElementById('consoleStatus'),button=document.getElementById('consoleConnect');
 const buttonLabel=document.getElementById('consoleConnectLabel');
 let terminal,fit,token=null,opening=false,generation=0,environmentId=null,pending=[];
 const paste=mountConsolePaste({host,getPreferences,getSession:()=>token,onPaste:text=>terminal?.paste(text)});
 const visible=()=>!document.getElementById('page-console').classList.contains('hidden');
 function create(){
  if(terminal)return;
  terminal=new Terminal({...consoleOptions(getPreferences(),document.body.classList.contains('dark')),convertEol:false,allowProposedApi:false});
  host.style.background=terminal.options.theme.background;
  fit=new FitAddon();terminal.loadAddon(fit);
  const openLink=url=>{try{const parsed=new URL(url);if(['http:','https:'].includes(parsed.protocol))openBrowser?.(parsed.href);}catch{}};
  terminal.loadAddon(new WebLinksAddon((_event,url)=>openLink(url)));
  terminal.parser.registerOscHandler(777,data=>{if(!data.startsWith('dingtu-open-url;'))return false;openLink(data.slice(16));return true;});
  // Handle Space on keydown: do not depend on Chromium's legacy keypress.
  terminal.attachCustomKeyEventHandler(event=>{
   const shortcut=consoleShortcutAction(event,getPreferences().consoleShortcuts,api.platform);
   if(shortcut){
    if(event.type==='keydown'){
     event.preventDefault();
     if(!event.repeat){
      if(shortcut==='copy'&&terminal.hasSelection())void navigator.clipboard.writeText(terminal.getSelection()).catch(error=>{status.textContent='复制失败：'+error.message;});
      if(shortcut==='paste'){const session=token;void navigator.clipboard.readText().then(text=>{if(token===session&&session)paste.request(text);}).catch(error=>{status.textContent='粘贴失败：'+error.message;});}
      if(shortcut==='selectAll')terminal.selectAll();
      if(shortcut==='clear')terminal.clear();
      if(shortcut==='scrollTop')terminal.scrollToTop();
      if(shortcut==='scrollBottom')terminal.scrollToBottom();
      if(shortcut==='interrupt')terminal.input('\x03',true);
     }
    }
    return false;
   }
   if(event.key!==' ' || event.ctrlKey || event.altKey || event.metaKey || event.isComposing)return true;
   if(event.type==='keydown'){event.preventDefault();terminal.input(' ',true);}
   return false;
  });
  terminal.open(host);
  terminal.onData(data=>{if(token)void api.console('input',{token,data}).catch(()=>disconnected('终端已断开，请重新连接。'));});
  terminal.onResize(({cols,rows})=>{if(token)void api.console('resize',{token,cols,rows}).catch(()=>{});});
 }
 function disconnected(message){paste.cancel();token=null;status.textContent=message;buttonLabel.textContent='重新连接';}
 function output(event){
  if(event.type==='data')terminal?.write(event.text,()=>{if(token===event.token)void api.console('ack',{token,bytes:new TextEncoder().encode(event.text).length}).catch(()=>{});});
  else if(event.type==='exit'){terminal?.write('\r\n\x1b[90m终端会话已结束。\x1b[0m\r\n');disconnected('终端已断开，可重新连接当前环境。');}
  else if(event.type==='login-result'){status.textContent=event.text;terminal?.write('\r\n\x1b['+(event.ok?'32':'31')+'m'+event.text+'\x1b[0m\r\n');}
  else if(event.type==='notice')status.textContent=event.text;
  else if(event.type==='open-url')openBrowser?.(event.url);
 }
 function reset(){
  paste.cancel();
  generation++;const previous=token;token=null;pending=[];environmentId=null;opening=false;button.disabled=false;button.loading=false;
  if(previous)void api.console('close',{token:previous}).catch(()=>{});
  terminal?.dispose();terminal=null;fit=null;host.replaceChildren();status.textContent='';buttonLabel.textContent='连接终端';
 }
 async function connect(loginEngine){
  if(opening || token)return;
  const version=generation;opening=true;pending=[];button.disabled=true;button.loading=true;
  try{
   const info=await api.console('status');if(version!==generation)return;
   if(!info.available){status.textContent=info.message;return;}
   environmentId=info.id;
   create();fit.fit();status.textContent='正在连接终端…';
   const result=await api.console('open',{cols:terminal.cols,rows:terminal.rows,loginEngine});
   if(version!==generation){void api.console('close',{token:result.token});return;}
   token=result.token;for(const event of pending)if(event.token===token)output(event);pending=[];
   if(token){status.textContent='';buttonLabel.textContent='重新连接';terminal.focus();fit.fit();}
  }catch(error){if(version===generation)status.textContent='连接失败：'+error.message+'。请检查当前环境后重试。';}
  finally{if(version===generation){opening=false;button.disabled=false;button.loading=false;}}
 }
 button.onclick=async()=>{
  if(opening)return;
  paste.cancel();const version=generation,previous=token;token=null;opening=true;button.disabled=true;button.loading=true;
  try{if(previous)await api.console('close',{token:previous});if(version!==generation)return;terminal?.dispose();terminal=null;fit=null;host.replaceChildren();status.textContent='';opening=false;await connect();}
  catch(error){if(version===generation)status.textContent='连接失败：'+error.message;}
  finally{if(version===generation){opening=false;button.disabled=false;button.loading=false;}}
 };
 api.onEvent(({type,data})=>{
  if(type==='console'){if(data.token===token)output(data);else if(opening && pending.length<1024)pending.push(data);}
  if(type==='chatAccountChanged' || type==='account' && !data.user){reset();if(visible())void show();}
 });
 function applySettings(){if(!terminal)return;terminal.options=consoleOptions(getPreferences(),document.body.classList.contains('dark'));host.style.background=terminal.options.theme.background;if(visible())fit.fit();}
 document.addEventListener('preferences-changed',applySettings);
 new MutationObserver(applySettings).observe(document.body,{attributes:true,attributeFilter:['class']});
 const resize=()=>{if(visible() && terminal)fit.fit();};
 new ResizeObserver(resize).observe(host);window.addEventListener('resize',resize);
 async function show(){
  const version=generation;try{const info=await api.console('status');if(version!==generation || !visible())return;if(environmentId && environmentId!==info.id)reset();if(!info.available){reset();status.textContent=info.message;return;}if(!token){if(getPreferences().consoleAutoConnect)await connect();else{create();fit.fit();status.textContent='点击“连接终端”连接当前环境。';buttonLabel.textContent='连接终端';}}else{fit.fit();terminal.focus();}}catch(error){status.textContent=error.message;}
 }
 async function login(engine){
  if(opening)throw new Error('终端正在连接，请稍后重试登录');
  reset();await connect(engine);
 }
 function authChanged(message){status.textContent=message;terminal?.write('\r\n\x1b[90m'+message+'\x1b[0m\r\n');}
 return {show,reset,login,authChanged};
}
