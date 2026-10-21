const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('containerBrowser',{input:value=>ipcRenderer.send('container-browser:input',value),onFrame:callback=>ipcRenderer.on('container-browser:frame',(_event,data)=>callback(data))});
