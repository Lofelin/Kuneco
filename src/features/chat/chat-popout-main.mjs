import path from 'node:path';
import {pathToFileURL} from 'node:url';
const key=value=>JSON.stringify([value?.owner,value?.environmentId??null,value?.chatId]);
export function createChatPopouts({BrowserWindow,ipcMain,parent,scope,basePath,preferences=()=>({})}){
 const windows=new Map();const page=path.join(basePath,'features/chat/chat-popout.html'),url=pathToFileURL(page).href;
 const current=value=>Boolean(value?.owner && value.owner===scope()?.owner && (value.environmentId??null)===(scope()?.environmentId??null));
 const channel='kuneco:chat-popout-action';
 ipcMain.handle(channel,async(event,value)=>{
  const entry=[...windows.values()].find(item=>item.window.webContents===event.sender);
  if(!entry || event.senderFrame!==event.sender.mainFrame || event.senderFrame.url!==url || !current(entry.scope))throw Error('独立窗口所属账号或环境已变化');
  if(!['updateDraft','send','stop','focus'].includes(value?.action))throw Error('未知对话操作');
  if(['updateDraft','send'].includes(value.action) && (typeof value.text!=='string'||value.text.length>50000))throw Error('草稿内容无效');
  if(!entry.snapshot || value.revision!==entry.snapshot.revision)throw Error('对话已更新，请等待同步后重试');
  const ownerWindow=parent();if(!ownerWindow || ownerWindow.isDestroyed())throw Error('主窗口已关闭');
  ownerWindow.webContents.send('workspace:event',{type:'chatPopoutAction',data:{scope:{...entry.scope},action:value.action,text:value.text,revision:value.revision}});
  return {queued:true};
 });
 function open(value){
  if(!current(value)||typeof value.chatId!=='string'||!value.chatId)throw Error('对话所属账号或环境已变化');
  const id=key(value),existing=windows.get(id);if(existing&&!existing.window.isDestroyed()){existing.window.show();existing.window.focus();return {opened:true};}
  const child=new BrowserWindow({width:780,height:820,minWidth:480,minHeight:480,show:false,title:'Kuneco · 对话',webPreferences:{preload:path.join(basePath,'features/chat/chat-popout-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const entry={window:child,scope:{owner:value.owner,environmentId:value.environmentId??null,chatId:value.chatId},snapshot:null};windows.set(id,entry);
  child.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  child.webContents.on('will-navigate',event=>event.preventDefault());child.webContents.on('will-frame-navigate',event=>event.preventDefault());child.webContents.on('will-attach-webview',event=>event.preventDefault());
  child.webContents.on('did-finish-load',()=>{child.webContents.send('kuneco:preferences',preferences());if(entry.snapshot)child.webContents.send('kuneco:chat-popout-snapshot',entry.snapshot);});
  child.once('ready-to-show',()=>child.show());child.on('closed',()=>windows.delete(id));
  const ownerWindow=parent();const close=()=>{if(!child.isDestroyed())child.close();};ownerWindow?.once('closed',close);child.once('closed',()=>ownerWindow?.removeListener('closed',close));
  void child.loadFile(page);return {opened:true};
 }
 function publish(snapshot){const entry=windows.get(key(snapshot?.scope));if(!entry||entry.window.isDestroyed()||!current(entry.scope))return;
  // Only the primary renderer supplies this snapshot; the child has no runtime or persistence API.
  entry.snapshot=structuredClone(snapshot);entry.window.webContents.send('kuneco:chat-popout-snapshot',entry.snapshot);
 }
 function closeInvalid(){for(const entry of windows.values())if(!current(entry.scope)&&!entry.window.isDestroyed())entry.window.close();}
 return {open,publish,closeInvalid,preferencesChanged(value){for(const entry of windows.values())if(!entry.window.isDestroyed())entry.window.webContents.send('kuneco:preferences',value);},closeAll(){for(const entry of windows.values())if(!entry.window.isDestroyed())entry.window.close();},dispose(){for(const entry of windows.values())if(!entry.window.isDestroyed())entry.window.close();ipcMain.removeHandler(channel);}};
}
