const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('chatPopout',{
 action:value=>ipcRenderer.invoke('kuneco:chat-popout-action',value),
 onSnapshot:listener=>{const handler=(_event,value)=>listener(value);ipcRenderer.on('kuneco:chat-popout-snapshot',handler);return()=>ipcRenderer.removeListener('kuneco:chat-popout-snapshot',handler);}
});
