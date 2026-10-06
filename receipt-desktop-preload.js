const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('FisDesktop',{
 request:q=>ipcRenderer.invoke('fis:request',q),
 importFiles:()=>ipcRenderer.invoke('fis:import'),
 readImage:q=>ipcRenderer.invoke('fis:ocr-blob',q),
 saveFile:q=>ipcRenderer.invoke('fis:save-file',q),
 exportExcel:q=>ipcRenderer.invoke('fis:export',q)
});
