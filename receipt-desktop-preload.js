const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('FisDesktop',{
 onOfficeReady:callback=>{const listener=()=>callback();ipcRenderer.on('fis:office-ready',listener);return ()=>ipcRenderer.removeListener('fis:office-ready',listener);},
 onApproveProgress:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('fis:approve-progress',listener);return ()=>ipcRenderer.removeListener('fis:approve-progress',listener);},
 request:q=>ipcRenderer.invoke('fis:request',q),
 importFiles:()=>ipcRenderer.invoke('fis:import'),
 cancelImport:()=>ipcRenderer.invoke('fis:cancel-import'),
 onImportProgress:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('fis:import-progress',listener);return ()=>ipcRenderer.removeListener('fis:import-progress',listener);},
 importImage:ref=>ipcRenderer.invoke('fis:import-image',ref),
 readImage:q=>ipcRenderer.invoke('fis:ocr-blob',q),
 saveFile:q=>ipcRenderer.invoke('fis:save-file',q),
 exportExcel:q=>ipcRenderer.invoke('fis:export',q)
});
