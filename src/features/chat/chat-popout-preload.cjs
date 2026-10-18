const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('chatPopout',{
 platform:process.platform,
 onPreferences:listener=>{const handler=(_event,value)=>listener(value);ipcRenderer.on('kuneco:preferences',handler);return()=>ipcRenderer.removeListener('kuneco:preferences',handler);},
 action:value=>ipcRenderer.invoke('kuneco:chat-popout-action',value),
 onSnapshot:listener=>{const handler=(_event,value)=>listener(value);ipcRenderer.on('kuneco:chat-popout-snapshot',handler);return()=>ipcRenderer.removeListener('kuneco:chat-popout-snapshot',handler);}
});
